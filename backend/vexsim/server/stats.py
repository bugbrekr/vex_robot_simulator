"""Server statistics for the public /stats page: aggregate counts and host load only.

Nothing here identifies a client: browsers send a random id (kept in their localStorage) that is
only used to count distinct browsers and is never returned. The endpoint reports numbers, not
which browser has which tabs, programs or platform.
"""

from __future__ import annotations

import asyncio
import contextlib
import os
import time
from collections import deque
from dataclasses import dataclass, field

SAMPLE_EVERY = 2.0  # s
HISTORY = 150  # samples kept (5 minutes at 2 s)


@dataclass
class _Conn:
    platform: str
    client: str
    running: bool = False
    has_worker: bool = False


@dataclass
class Stats:
    started: float = field(default_factory=time.time)
    conns: dict[int, _Conn] = field(default_factory=dict)
    total_connections: int = 0
    total_runs: int = 0
    history: deque = field(default_factory=lambda: deque(maxlen=HISTORY))
    _cpu_prev: tuple[int, int] | None = None
    _task: asyncio.Task | None = None

    # ------------------------------------------------------------ session bookkeeping
    def open(self, key: int, platform: str, client: str) -> None:
        self.conns[key] = _Conn(platform, client[:64] or f"anon-{key}")
        self.total_connections += 1

    def close(self, key: int) -> None:
        self.conns.pop(key, None)

    def set_running(self, key: int, running: bool) -> None:
        c = self.conns.get(key)
        if c is not None:
            c.running = running

    def set_worker(self, key: int, alive: bool) -> None:
        c = self.conns.get(key)
        if c is not None:
            c.has_worker = alive

    def run_started(self) -> None:
        self.total_runs += 1

    # ------------------------------------------------------------ host load (Linux /proc)
    def _cpu_percent(self) -> float | None:
        try:
            with open("/proc/stat", encoding="ascii") as f:
                parts = [int(v) for v in f.readline().split()[1:]]
        except (OSError, ValueError):
            return None
        idle = parts[3] + (parts[4] if len(parts) > 4 else 0)
        total = sum(parts)
        prev, self._cpu_prev = self._cpu_prev, (idle, total)
        if prev is None or total == prev[1]:
            return None
        return round(100.0 * (1 - (idle - prev[0]) / (total - prev[1])), 1)

    @staticmethod
    def _memory() -> dict:
        info = {}
        try:
            with open("/proc/meminfo", encoding="ascii") as f:
                for line in f:
                    k, v = line.split(":", 1)
                    info[k] = int(v.split()[0]) * 1024
        except (OSError, ValueError):
            return {}
        total = info.get("MemTotal", 0)
        avail = info.get("MemAvailable", info.get("MemFree", 0))
        return {"total": total, "used": total - avail}

    @staticmethod
    def _server_rss() -> int | None:
        try:
            with open("/proc/self/status", encoding="ascii") as f:
                for line in f:
                    if line.startswith("VmRSS:"):
                        return int(line.split()[1]) * 1024
        except (OSError, ValueError):
            pass
        return None

    def sample(self) -> dict:
        mem = self._memory()
        try:
            load = list(os.getloadavg())
        except OSError:
            load = None
        s = {
            "t": round(time.time(), 1),
            "cpu": self._cpu_percent(),
            "mem_used": mem.get("used"),
            "tabs": len(self.conns),
            "running": sum(c.running for c in self.conns.values()),
        }
        self.history.append(s)
        return {**s, "mem_total": mem.get("total"), "load": load}

    async def _loop(self) -> None:
        while True:
            with contextlib.suppress(Exception):
                self.sample()
            await asyncio.sleep(SAMPLE_EVERY)

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None

    # ------------------------------------------------------------ public snapshot (counts only)
    def snapshot(self, sandbox_mode: str) -> dict:
        conns = list(self.conns.values())
        last = self.history[-1] if self.history else self.sample()
        mem = self._memory()
        try:
            load = [round(v, 2) for v in os.getloadavg()]
        except OSError:
            load = None
        return {
            "uptime": round(time.time() - self.started),
            "cpu": {"percent": last.get("cpu"), "cores": os.cpu_count(), "load": load},
            "memory": {"used": mem.get("used"), "total": mem.get("total"), "server_rss": self._server_rss()},
            "clients": {
                "browsers": len({c.client for c in conns}),
                "tabs": len(conns),
                "tabs_cte": sum(c.platform == "cte" for c in conns),
                "tabs_iq2": sum(c.platform == "iq2" for c in conns),
            },
            "simulations": {
                "workers": sum(c.has_worker for c in conns),
                "running_programs": sum(c.running for c in conns),
                "sandbox": sandbox_mode,
            },
            "totals": {"connections": self.total_connections, "program_runs": self.total_runs},
            "history": [{k: h[k] for k in ("t", "cpu", "mem_used", "tabs", "running")} for h in self.history],
        }


STATS = Stats()
