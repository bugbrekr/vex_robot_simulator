"""Docker sandbox plumbing, tested with a fake `docker` CLI (no Docker needed)."""

import json
import os
import stat
import sys
import textwrap
import time

import pytest
from fastapi.testclient import TestClient

from vexsim.server.sandbox import SandboxConfig

FAKE = textwrap.dedent('''\
    #!{python}
    """Fake docker: `run` execs the in-container command locally, `rm -f` kills it."""
    import json, os, signal, sys
    d = os.environ["FAKE_DOCKER_DIR"]
    a = sys.argv[1:]
    with open(os.path.join(d, "calls.jsonl"), "a") as f:
        f.write(json.dumps(a) + "\\n")
    if a[0] == "run" and os.environ.get("FAKE_DOCKER_FAIL"):
        for _ in range(2):
            print('level=error msg="running `/usr/bin/newuidmap 9737 0 1006 1 1 493216 65536`: '
                  'newuidmap: write to uid_map failed: Operation not permitted"', file=sys.stderr)
            print('Error: cannot set up namespace using "/usr/bin/newuidmap": exit status 1', file=sys.stderr)
        sys.exit(125)
    if a[0] == "run":
        valued = {{"--name", "--label", "--network", "--tmpfs", "--cap-drop", "--security-opt", "--user",
                  "--ipc", "--log-driver", "--memory", "--memory-swap", "--cpus", "--pids-limit"}}
        i, name = 1, None
        while a[i].startswith("-"):
            if a[i] == "--name":
                name = a[i + 1]
            i += 2 if a[i] in valued else 1
        cmd = a[i + 1:]  # after the image
        if cmd[0] == "python":
            cmd[0] = sys.executable
        open(os.path.join(d, name + ".pid"), "w").write(str(os.getpid()))
        os.execvp(cmd[0], cmd)
    if a[0] == "rm":
        for n in a[2:]:
            p = os.path.join(d, n + ".pid")
            if os.path.exists(p):
                try:
                    os.kill(int(open(p).read()), signal.SIGKILL)
                except ProcessLookupError:
                    pass
                os.remove(p)
''')


@pytest.fixture
def fake_docker(tmp_path, monkeypatch):
    script = tmp_path / "docker"
    script.write_text(FAKE.format(python=sys.executable))
    script.chmod(script.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setenv("FAKE_DOCKER_DIR", str(tmp_path))
    return tmp_path, SandboxConfig(mode="docker", docker=str(script))


def calls(d):
    p = d / "calls.jsonl"
    return [json.loads(line) for line in p.read_text().splitlines()] if p.exists() else []


def test_docker_run_is_locked_down():
    argv, name = SandboxConfig(mode="docker").worker_command(["--scenario", "cte_tile"])
    joined = " ".join(argv)
    assert argv[:4] == ["docker", "run", "--rm", "-i"] and name and name.startswith("vexsim-")
    for flag in ("--network none", "--read-only", "--cap-drop ALL", "--security-opt no-new-privileges",
                 "--user 65534:65534", "--memory 512m", "--memory-swap 512m", "--cpus 1",
                 "--pids-limit 128", "--init", "--log-driver none"):
        assert flag in joined, flag
    assert "-v" not in argv and "--volume" not in joined and "--mount" not in joined  # nothing shared
    assert argv[argv.index("vexsim-worker:latest") + 1:] == [
        "python", "-u", "-m", "vexsim.runner.worker", "--scenario", "cte_tile"]


def test_limits_can_be_disabled_for_hosts_without_cgroup_delegation(monkeypatch):
    for k in ("VEXSIM_SANDBOX_MEMORY", "VEXSIM_SANDBOX_CPUS", "VEXSIM_SANDBOX_PIDS"):
        monkeypatch.setenv(k, "")
    monkeypatch.setenv("VEXSIM_SANDBOX", "docker")
    monkeypatch.setenv("VEXSIM_DOCKER", "podman")
    argv, _ = SandboxConfig.from_env().worker_command([])
    assert argv[0] == "podman" and "--memory" not in argv and "--cpus" not in argv


def test_no_sandbox_is_a_plain_subprocess():
    argv, name = SandboxConfig(mode="none").worker_command(["--x"])
    assert name is None and argv[0] == sys.executable


def test_session_runs_program_in_container_and_removes_it(fake_docker, monkeypatch):
    d, cfg = fake_docker
    import vexsim.server.app as appmod

    monkeypatch.setattr(appmod, "SANDBOX", cfg)
    c = TestClient(appmod.app)
    code = "from vex import *\narm = Arm()\narm.move_inc(20, 0, 0)\nprint('in box', arm.get_x())\n"
    console = ""
    with c.websocket_connect("/vex_cte/ws/cte") as ws:
        ws.send_text(json.dumps({"type": "speed", "value": 0}))
        ws.send_text(json.dumps({"type": "run", "scenario": "cte_tile", "code": code}))
        deadline = time.time() + 20
        while "in box" not in console and time.time() < deadline:
            msg = json.loads(ws.receive_text())
            if msg["type"] == "console":
                console += msg["text"]
        names = [a[a.index("--name") + 1] for a in calls(d) if a[0] == "run"]
        assert names, "worker was not started through docker"
        assert "in box 140.0" in console
        # a reset replaces the scene: the old container must be force-removed
        ws.send_text(json.dumps({"type": "reset", "scenario": "whiteboard"}))
        deadline = time.time() + 20
        while time.time() < deadline:
            if json.loads(ws.receive_text())["type"] == "hello":
                break
    assert ["rm", "-f", names[0]] in calls(d)
    assert not os.path.exists(d / f"{names[0]}.pid")  # process gone
    runs = [a for a in calls(d) if a[0] == "run"]
    assert len(runs) == 2 and "whiteboard" in runs[1]


def test_namespace_failure_shows_one_plain_message(fake_docker, monkeypatch):
    """Rootless Podman under NoNewPrivileges: raw engine errors stay in the server log."""
    _, cfg = fake_docker
    import vexsim.server.app as appmod

    monkeypatch.setattr(appmod, "SANDBOX", cfg)
    monkeypatch.setenv("FAKE_DOCKER_FAIL", "1")
    c = TestClient(appmod.app)
    warnings = []
    with c.websocket_connect("/vex_cte/ws/cte") as ws:
        ws.send_text(json.dumps({"type": "run", "scenario": "cte_tile", "code": "print(1)\n"}))
        deadline = time.time() + 5
        while time.time() < deadline and not warnings:
            msg = json.loads(ws.receive_text())
            if msg["type"] == "warning":
                warnings.append(msg["text"])
        time.sleep(0.3)
    assert len(warnings) == 1 and "couldn't start its sandbox" in warnings[0]
    assert "newuidmap" not in warnings[0]


def test_self_check_reports_namespace_problem(fake_docker, monkeypatch):
    import asyncio

    _, cfg = fake_docker
    monkeypatch.setenv("FAKE_DOCKER_FAIL", "1")
    ok, msg = asyncio.run(cfg.self_check())
    assert not ok and "NoNewPrivileges" in msg
    monkeypatch.delenv("FAKE_DOCKER_FAIL")
    assert asyncio.run(cfg.self_check()) == (True, "sandbox OK")
