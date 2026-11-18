"""Command line entry point: ``vexsim run`` (headless) and ``vexsim serve`` (web UI)."""

from __future__ import annotations

import argparse
import json
import os
import sys


def _run(args) -> int:
    from vexsim.runner.worker import Worker

    with open(args.script, encoding="utf-8") as f:
        code = f.read()

    def emit(msg):
        if msg["type"] == "warning":
            print(f"[sim t={msg.get('t', 0):.2f}s] {msg['text']}", file=sys.stderr)
        elif msg["type"] == "error":
            line = f" (line {msg['line']})" if msg.get("line") else ""
            print(f"[error]{line} {msg['message']}", file=sys.stderr)

    w = Worker(args.platform, args.scenario, code, emit=emit, max_time=args.max_time)
    summary = w.run_headless()
    if args.json:
        summary.pop("arm", None) if not args.verbose else None
        print(json.dumps(summary, indent=2))
    else:
        sys.stdout.write(summary["console"])
        print(f"--- {summary['state']} at t={summary['t']:.2f}s (sim time)")
        arm = summary.get("arm")
        if arm:
            print(f"arm tcp={arm['tcp']} rpy={arm['rpy']} tool={arm['tool']} holding={arm['holding']}")
        for o in summary["objects"]:
            print(f"{o['id']}: pos={o['pos']}")
    return 1 if summary["errors"] else 0


def _serve(args) -> int:
    import uvicorn

    os.environ["VEXSIM_BASE_PATH"] = args.base_path
    if args.sandbox:
        os.environ["VEXSIM_SANDBOX"] = args.sandbox
    print(f"VEX Simulator sandbox: {os.environ.get('VEXSIM_SANDBOX', 'none')}")
    print(f"VEX Simulator: http://{args.host}:{args.port}/{args.base_path.strip('/')}/")
    uvicorn.run("vexsim.server.app:app", host=args.host, port=args.port, reload=args.reload,
                proxy_headers=True, forwarded_allow_ips=args.forwarded_allow_ips)
    return 0


# Runs inside a sandbox container: each line is "name<TAB>ok<TAB>detail".
_PROBE = r"""
import os, socket
def rep(name, ok, detail=""): print(f"{name}\t{int(bool(ok))}\t{detail}", flush=True)
rep("unprivileged user", os.getuid() != 0, f"uid={os.getuid()}")
try:
    socket.create_connection(("1.1.1.1", 53), timeout=2); rep("no network", False, "connected out!")
except OSError as e:
    rep("no network", True, type(e).__name__)
try:
    open("/opt/vexsim/x", "w"); rep("read-only filesystem", False, "/opt writable")
except OSError:
    rep("read-only filesystem", True)
try:
    open("/tmp/x", "w").write("ok"); rep("scratch /tmp", True)
except OSError as e:
    rep("scratch /tmp", False, str(e))
def cg(path):
    try: return open(path).read().strip()
    except OSError: return "?"
rep("memory limit", cg("/sys/fs/cgroup/memory.max") not in ("max", "?"), cg("/sys/fs/cgroup/memory.max"))
rep("process limit", cg("/sys/fs/cgroup/pids.max") not in ("max", "?"), cg("/sys/fs/cgroup/pids.max"))
from vexsim.runner.worker import Worker
code = "from vex import *\narm = Arm()\narm.move_inc(50, 0, 0)\nprint(arm.get_x())\n"
s = Worker("cte", "cte_tile", code).run_headless()
out = s["console"].strip()
rep("simulation runs", out == "170.0" and not s["errors"], out or s["errors"])
"""


def _sandbox(args) -> int:
    import subprocess

    from vexsim.server.sandbox import SandboxConfig

    os.environ["VEXSIM_SANDBOX"] = "docker"
    cfg = SandboxConfig.from_env()
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    if args.action == "build":
        cmd = [cfg.docker, "build", "-f", os.path.join(root, "deploy", "worker.Dockerfile"),
               "-t", cfg.image, root]
        print("$", " ".join(cmd))
        return subprocess.call(cmd)
    # check
    cmd = cfg.docker_run_args("vexsim-check") + ["python", "-c", _PROBE]
    print("$", " ".join(cmd[:-1]), "<probe>")
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    except FileNotFoundError:
        print(f"{cfg.docker}: not found - install Docker/Podman or set VEXSIM_DOCKER")
        return 2
    rows = [line.split("\t") for line in res.stdout.splitlines() if line.count("\t") == 2]
    for name, ok, detail in rows:
        print(f"  [{'ok' if ok == '1' else 'FAIL'}] {name}  {detail}")
    if res.returncode != 0 or not rows:
        print(res.stderr.strip() or f"exit code {res.returncode}")
        if "cgroup" in res.stderr or "memory" in res.stderr.lower():
            print("hint: rootless Docker needs cgroup v2 controller delegation for --memory/--cpus/"
                  "--pids-limit (see docs/sandbox.md), or set VEXSIM_SANDBOX_MEMORY= "
                  "VEXSIM_SANDBOX_CPUS= VEXSIM_SANDBOX_PIDS= to run without limits.")
        return 1
    return 0 if all(ok == "1" for _, ok, _ in rows) else 1


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="vexsim")
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run", help="run a student program headless")
    r.add_argument("script")
    r.add_argument("--platform", default="cte")
    r.add_argument("--scenario", default="cte_tile")
    r.add_argument("--max-time", type=float, default=300.0, help="sim-time limit (s)")
    r.add_argument("--json", action="store_true")
    r.add_argument("--verbose", action="store_true")
    r.add_argument("--headless", action="store_true", help="(default; accepted for clarity)")
    s = sub.add_parser("serve", help="start the web simulator")
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=8000)
    s.add_argument("--reload", action="store_true")
    s.add_argument("--base-path", default=os.environ.get("VEXSIM_BASE_PATH", "/vex_cte"),
                   help="URL path the app is served under (default /vex_cte)")
    s.add_argument("--forwarded-allow-ips", default="127.0.0.1",
                   help="proxies trusted for X-Forwarded-* headers (your nginx)")
    s.add_argument("--sandbox", choices=["none", "docker"],
                   help="run user code in throw-away containers (default: $VEXSIM_SANDBOX or none)")
    sb = sub.add_parser("sandbox", help="build / verify the Docker sandbox for user code")
    sb.add_argument("action", choices=["build", "check"])
    args = ap.parse_args(argv)
    sys.exit({"run": _run, "serve": _serve, "sandbox": _sandbox}[args.cmd](args))


if __name__ == "__main__":
    main()
