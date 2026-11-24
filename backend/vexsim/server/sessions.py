"""One Session per browser WebSocket: owns a worker (subprocess or sandbox container) and relays
messages. All traffic is JSON lines over the worker's stdin/stdout - no files are shared, which is
what lets the worker run in a container with no mounts and no network (see sandbox.py)."""

from __future__ import annotations

import asyncio
import contextlib
import json
import sys
from collections.abc import Awaitable, Callable

from vexsim.server.sandbox import SandboxConfig, setup_problem

# Everything except "reset" (new scene = new worker process) goes to the persistent worker.
LOCAL = {"reset"}
DEFAULT_SCENARIO = {"cte": "cte_tile", "iq2": "blank"}


class Session:
    def __init__(self, send: Callable[[str], Awaitable[None]], platform: str = "cte",
                 sandbox: SandboxConfig | None = None):
        self.send = send
        self.platform = platform
        self.sandbox = sandbox or SandboxConfig.from_env()
        self.proc: asyncio.subprocess.Process | None = None
        self.container: str | None = None
        self._tasks: list[asyncio.Task] = []
        self.speed = 1.0
        self.scenario = DEFAULT_SCENARIO.get(platform, "cte_tile")

    async def start(self, scenario: str, code: str | None = None, tool: str | None = None,
                    marker: float | None = None) -> None:
        await self.kill()
        worker_args = ["--platform", self.platform, "--scenario", scenario, "--speed", str(self.speed)]
        if tool in ("magnet", "pen"):
            worker_args += ["--mounted-tool", tool]
        if marker is not None:
            worker_args += ["--marker", str(float(marker))]
        args, self.container = self.sandbox.worker_command(worker_args)
        self.proc = await asyncio.create_subprocess_exec(
            *args,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            limit=16 * 1024 * 1024,
        )
        self._tasks = [
            asyncio.create_task(self._pump_stdout(self.proc)),
            asyncio.create_task(self._pump_stderr(self.proc)),
        ]
        if code is not None:
            await self._to_worker({"type": "run", "code": code})

    async def _pump_stdout(self, proc) -> None:
        assert proc.stdout is not None
        while line := await proc.stdout.readline():
            with contextlib.suppress(Exception):
                await self.send(line.decode().rstrip("\n"))

    async def _pump_stderr(self, proc) -> None:
        assert proc.stderr is not None
        told = False
        while line := await proc.stderr.readline():
            text = line.decode().rstrip()
            if not text:
                continue
            why = setup_problem(text) if self.container else None
            if why:
                # the sandbox itself failed to start: details go to the server log, the student
                # sees one plain message
                print(f"vexsim: sandbox failed to start ({why}): {text}", file=sys.stderr, flush=True)
                if told:
                    continue
                told = True
                text = ("The simulator couldn't start its sandbox on the server. Ask whoever runs "
                        "this server to check its log (docs/sandbox.md, Troubleshooting).")
                with contextlib.suppress(Exception):
                    await self.send(json.dumps({"type": "warning", "text": text}))
                continue
            with contextlib.suppress(Exception):
                await self.send(json.dumps({"type": "warning", "text": f"[worker] {text}"}))

    async def command(self, msg: dict) -> None:
        kind = msg.get("type")
        if kind == "reset":
            self.scenario = msg.get("scenario", DEFAULT_SCENARIO.get(self.platform, "cte_tile"))
            # keep the physically mounted tool across map changes / resets
            await self.start(self.scenario, None, msg.get("mounted_tool"), msg.get("marker_protrusion"))
            return
        if kind == "speed":
            self.speed = float(msg.get("value", 1.0))
        if self.proc is None or self.proc.returncode is not None:
            # (re)start the scene; a run keeps using the same live scene afterwards
            await self.start(msg.get("scenario", self.scenario), None)
        await self._to_worker(msg)

    async def _to_worker(self, msg: dict) -> None:
        if self.proc and self.proc.stdin and self.proc.returncode is None:
            with contextlib.suppress(BrokenPipeError, ConnectionResetError):
                self.proc.stdin.write((json.dumps(msg) + "\n").encode())
                await self.proc.stdin.drain()

    async def kill(self) -> None:
        proc, self.proc = self.proc, None
        container, self.container = self.container, None
        # remove the container first: killing the `docker run` client alone may leave it running
        await self.sandbox.stop(container)
        if proc and proc.returncode is None:
            proc.kill()
            with contextlib.suppress(Exception):
                await asyncio.wait_for(proc.wait(), 2)
        if proc and proc.stdin:
            with contextlib.suppress(Exception):
                proc.stdin.close()
        transport = getattr(proc, "_transport", None)
        if transport is not None:
            transport.close()  # release pipes now, not at GC time (after the loop is gone)
        for t in self._tasks:
            t.cancel()
        self._tasks = []
