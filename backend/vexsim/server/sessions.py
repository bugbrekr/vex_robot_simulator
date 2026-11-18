"""One Session per browser WebSocket: owns a worker subprocess and relays messages."""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import sys
import tempfile
from collections.abc import Awaitable, Callable

# Everything except "reset" (new scene = new worker process) goes to the persistent worker.
LOCAL = {"reset"}


class Session:
    def __init__(self, send: Callable[[str], Awaitable[None]], platform: str = "cte"):
        self.send = send
        self.platform = platform
        self.proc: asyncio.subprocess.Process | None = None
        self._tasks: list[asyncio.Task] = []
        self._code_file: str | None = None
        self.speed = 1.0
        self.scenario = "cte_tile"

    async def start(self, scenario: str, code: str | None = None, tool: str | None = None,
                    marker: float | None = None) -> None:
        await self.kill()
        args = [sys.executable, "-u", "-m", "vexsim.runner.worker", "--platform", self.platform,
                "--scenario", scenario, "--speed", str(self.speed)]
        if tool in ("magnet", "pen"):
            args += ["--mounted-tool", tool]
        if marker is not None:
            args += ["--marker", str(float(marker))]
        if code is not None:
            fd, path = tempfile.mkstemp(prefix="vexsim_", suffix=".py")
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(code)
            self._code_file = path
            args += ["--code-file", path]
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

    async def _pump_stdout(self, proc) -> None:
        assert proc.stdout is not None
        while line := await proc.stdout.readline():
            with contextlib.suppress(Exception):
                await self.send(line.decode().rstrip("\n"))

    async def _pump_stderr(self, proc) -> None:
        assert proc.stderr is not None
        while line := await proc.stderr.readline():
            text = line.decode().rstrip()
            if text:
                with contextlib.suppress(Exception):
                    await self.send(json.dumps({"type": "warning", "text": f"[worker] {text}"}))

    async def command(self, msg: dict) -> None:
        kind = msg.get("type")
        if kind == "reset":
            self.scenario = msg.get("scenario", "cte_tile")
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
        if self._code_file:
            with contextlib.suppress(OSError):
                os.unlink(self._code_file)
            self._code_file = None
