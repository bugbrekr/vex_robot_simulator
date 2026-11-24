"""Where simulation workers (and therefore the users' Python code) run.

``VEXSIM_SANDBOX=none``   (default) - a plain subprocess of the server. Fine for development.
``VEXSIM_SANDBOX=docker`` - one throw-away container per session, started with
``docker run --rm -i``. The worker only talks JSON lines over stdin/stdout, so the container
gets **no network, no mounts, a read-only filesystem, no capabilities, an unprivileged user and
memory / CPU / process limits**. Works with rootless Docker and with Podman
(``VEXSIM_DOCKER=podman``). See docs/sandbox.md.

Environment (all optional):
  VEXSIM_SANDBOX          none | docker
  VEXSIM_DOCKER           container CLI (default "docker"; e.g. "podman")
  VEXSIM_SANDBOX_IMAGE    worker image (default "vexsim-worker:latest")
  VEXSIM_SANDBOX_MEMORY   memory limit, e.g. "512m" ("" = no limit)
  VEXSIM_SANDBOX_CPUS     CPU limit, e.g. "1"        ("" = no limit)
  VEXSIM_SANDBOX_PIDS     max processes/threads, e.g. "128" ("" = no limit)
  VEXSIM_SANDBOX_ARGS     extra `docker run` arguments (shell-quoted)
  VEXSIM_FRAME_HZ         UI frame rate, passed into the container (default 30)
"""

from __future__ import annotations

import asyncio
import contextlib
import os
import shlex
import sys
import uuid
from dataclasses import dataclass, field

LABEL = "vexsim.worker=1"

# Container-engine errors that mean the sandbox itself can't start (not a problem in user code).
_SETUP_ERRORS = {
    "rootless namespace (newuidmap/newgidmap) - remove NoNewPrivileges=yes from the systemd unit":
        ("newuidmap", "newgidmap", "cannot set up namespace"),
    "worker image not found - run `vexsim sandbox build` as the service user":
        ("image not known", "unable to find image", "no such image", "pull access denied"),
    "container engine not reachable":
        ("cannot connect to the docker daemon", "command not found"),
}


def setup_problem(text: str) -> str | None:
    """If a line of container-engine output means the sandbox can't start, say why."""
    low = text.lower()
    for why, needles in _SETUP_ERRORS.items():
        if any(n in low for n in needles):
            return why
    return None
WORKER_MODULE = ["-u", "-m", "vexsim.runner.worker"]


@dataclass
class SandboxConfig:
    mode: str = "none"
    docker: str = "docker"
    image: str = "vexsim-worker:latest"
    memory: str = "512m"
    cpus: str = "1"
    pids: str = "128"
    extra: list[str] = field(default_factory=list)

    @classmethod
    def from_env(cls) -> SandboxConfig:
        e = os.environ
        mode = e.get("VEXSIM_SANDBOX", "none").strip().lower() or "none"
        if mode not in ("none", "docker"):
            raise ValueError(f"VEXSIM_SANDBOX must be 'none' or 'docker', not {mode!r}")
        return cls(
            mode=mode,
            docker=e.get("VEXSIM_DOCKER", "docker"),
            image=e.get("VEXSIM_SANDBOX_IMAGE", "vexsim-worker:latest"),
            memory=e.get("VEXSIM_SANDBOX_MEMORY", "512m"),
            cpus=e.get("VEXSIM_SANDBOX_CPUS", "1"),
            pids=e.get("VEXSIM_SANDBOX_PIDS", "128"),
            extra=shlex.split(e.get("VEXSIM_SANDBOX_ARGS", "")),
        )

    # ------------------------------------------------------------------ commands
    def docker_run_args(self, name: str) -> list[str]:
        """`docker run` options for an isolated worker container."""
        args = [
            self.docker, "run", "--rm", "-i",
            "--name", name, "--label", LABEL,
            "--init",                                   # reap / forward signals properly
            "--network", "none",                        # no LAN / internet
            "--read-only",                              # immutable root filesystem
            "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=16m",
            "--cap-drop", "ALL",
            "--security-opt", "no-new-privileges",
            "--user", "65534:65534",                    # nobody
            "--ipc", "private",
            "--log-driver", "none",                     # stdio is the protocol, don't log it
        ]
        if self.memory:
            args += ["--memory", self.memory, "--memory-swap", self.memory]
        if self.cpus:
            args += ["--cpus", self.cpus]
        if self.pids:
            args += ["--pids-limit", self.pids]
        if os.environ.get("VEXSIM_FRAME_HZ"):
            args += ["--env", f"VEXSIM_FRAME_HZ={os.environ['VEXSIM_FRAME_HZ']}"]
        return args + self.extra + [self.image]

    def worker_command(self, worker_args: list[str]) -> tuple[list[str], str | None]:
        """argv to start a worker, and the container name (None when not sandboxed)."""
        if self.mode == "docker":
            name = f"vexsim-{uuid.uuid4().hex[:12]}"
            return self.docker_run_args(name) + ["python", *WORKER_MODULE, *worker_args], name
        return [sys.executable, *WORKER_MODULE, *worker_args], None

    # ------------------------------------------------------------------ lifecycle
    async def _docker(self, *args: str, timeout: float = 15.0) -> tuple[int, str]:
        try:
            proc = await asyncio.create_subprocess_exec(
                self.docker, *args, stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
        except FileNotFoundError:
            return 127, f"{self.docker}: command not found"
        try:
            out, _ = await asyncio.wait_for(proc.communicate(), timeout)
        except TimeoutError:
            with contextlib.suppress(ProcessLookupError):
                proc.kill()
            return 124, "timeout"
        return proc.returncode or 0, out.decode(errors="replace")

    async def self_check(self) -> tuple[bool, str]:
        """Start one throw-away locked-down container running `true` (same flags as a session)."""
        name = f"vexsim-check-{uuid.uuid4().hex[:8]}"
        args = [a for a in self.docker_run_args(name)[1:] if a != "-i"] + ["true"]
        code, out = await self._docker(*args, timeout=60.0)
        if code == 0:
            return True, "sandbox OK"
        out = out.strip()
        why = setup_problem(out)
        return False, (f"{why}. " if why else "") + f"`{self.docker} run` failed ({code}): {out[-400:]}"

    async def stop(self, name: str | None) -> None:
        """Force-remove a worker container (killing the `docker run` client alone may not)."""
        if name:
            await self._docker("rm", "-f", name)

    async def cleanup_leftovers(self) -> int:
        """Remove worker containers left behind by a previous (crashed) server."""
        if self.mode != "docker":
            return 0
        code, out = await self._docker("ps", "-aq", "--filter", f"label={LABEL}")
        ids = out.split() if code == 0 else []
        if ids:
            await self._docker("rm", "-f", *ids)
        return len(ids)
