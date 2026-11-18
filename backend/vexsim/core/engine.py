"""Fixed-step simulation engine with a sim clock that student threads can block on.

Threading model
---------------
* The engine loop runs on one thread (the worker's main thread) and calls ``step()``.
* Student code runs on other threads. Any blocking API call waits on ``engine.cond`` until a
  predicate on sim state is true. ``engine.lock`` (shared with the condition) guards all model
  state, so models may be mutated from either side while holding it.
* ``blocked_waiters`` counts student threads currently waiting on sim time; when every student
  thread is blocked the loop can advance without real-time pacing (fast-forward / headless).
"""

from __future__ import annotations

import heapq
import itertools
import threading
import time
from collections.abc import Callable
from typing import Any

from vexsim.core.entity import Entity
from vexsim.core.events import EventBus


class ProgramStopped(BaseException):
    """Raised inside student threads when the program (or that thread) is stopped."""


class SimEngine:
    def __init__(self, dt: float = 0.01):
        self.dt = dt
        self.t = 0.0
        self.step_count = 0
        self.lock = threading.RLock()
        self.cond = threading.Condition(self.lock)
        self.entities: list[Entity] = []
        self.by_name: dict[str, Entity] = {}
        self.bus = EventBus()
        self._timers: list[tuple[float, int, Callable[[], None]]] = []
        self._seq = itertools.count()
        self.blocked_waiters = 0
        self._waiters: dict[int, tuple[Callable[[], bool], float | None]] = {}
        self.polls = 0  # incremented by API getters so busy-poll loops still advance time
        # Hook used to run student callbacks on their own thread (set by the runtime).
        self.spawn_callback: Callable[[Callable[..., Any], tuple], None] = (
            lambda fn, args: fn(*args)
        )
        # Hook: called every step for code that needs to check stop flags etc.
        self.stop_check: Callable[[], None] = lambda: None
        self.console: list[str] = []

    # ------------------------------------------------------------ entities
    def add(self, entity: Entity) -> Entity:
        with self.lock:
            entity.attach(self)
            self.entities.append(entity)
            self.by_name[entity.name] = entity
        return entity

    def find(self, kind: str) -> list[Entity]:
        return [e for e in self.entities if e.kind == kind]

    # ------------------------------------------------------------ timers
    def schedule(self, delay: float, fn: Callable[[], None]) -> None:
        """Run ``fn`` on the engine thread after ``delay`` sim seconds."""
        with self.lock:
            heapq.heappush(self._timers, (self.t + delay, next(self._seq), fn))

    def clear_timers(self) -> None:
        with self.lock:
            self._timers.clear()

    def has_timers(self) -> bool:
        return bool(self._timers)

    # ------------------------------------------------------------ stepping
    def step(self) -> None:
        with self.cond:
            t = self.t
            for e in self.entities:
                e.step(t, self.dt)
            self.t = round(t + self.dt, 9)
            self.step_count += 1
            while self._timers and self._timers[0][0] <= self.t + 1e-9:
                _, _, fn = heapq.heappop(self._timers)
                fn()
            self.cond.notify_all()

    def run_for(self, seconds: float) -> None:
        for _ in range(int(round(seconds / self.dt))):
            self.step()

    # ------------------------------------------------------------ student side waits
    def wait_until(self, predicate: Callable[[], bool], timeout: float | None = None) -> bool:
        """Block a student thread until predicate() (evaluated under lock) or sim timeout.

        Returns predicate's final value. Raises ProgramStopped if the program is stopped.
        """
        with self.cond:
            deadline = None if timeout is None else self.t + timeout
            key = threading.get_ident()
            self.blocked_waiters += 1
            self._waiters[key] = (predicate, deadline)
            self.cond.notify_all()  # lets a fast-forwarding loop notice we are blocked
            try:
                while True:
                    self.stop_check()
                    if predicate():
                        return True
                    if deadline is not None and self.t >= deadline - 1e-9:
                        return False
                    self.cond.wait(0.05)
            finally:
                self.blocked_waiters -= 1
                self._waiters.pop(key, None)
                self.cond.notify_all()

    def waiter_ready(self) -> bool:
        """True if some blocked student thread is about to wake (call with lock held)."""
        for pred, deadline in list(self._waiters.values()):
            if (deadline is not None and self.t >= deadline - 1e-9) or pred():
                return True
        return False

    def note_poll(self) -> None:
        self.polls += 1

    def sleep(self, seconds: float) -> None:
        end = self.t + seconds
        self.wait_until(lambda: self.t >= end - 1e-9)

    # ------------------------------------------------------------ main loop
    def run_loop(
        self,
        should_continue: Callable[[], bool],
        speed: Callable[[], float],
        all_blocked: Callable[[], bool],
        on_step: Callable[[], None] | None = None,
        paused: Callable[[], bool] = lambda: False,
    ) -> None:
        """Advance the sim, paced to real time * speed(). speed() <= 0 means 'as fast as possible'
        (still yields briefly so student threads doing pure-Python work get CPU)."""
        wall0 = time.perf_counter()
        sim0 = self.t
        last_speed = speed()
        last_polls = self.polls
        while should_continue():
            if paused():
                time.sleep(0.02)
                wall0, sim0 = time.perf_counter(), self.t
                continue
            s = speed()
            if s != last_speed:
                wall0, sim0, last_speed = time.perf_counter(), self.t, s
            if s > 0:
                target_wall = wall0 + (self.t - sim0) / s
                delay = target_wall - time.perf_counter()
                if delay > 0:
                    time.sleep(delay)
                elif delay < -0.25:  # fell behind (e.g. heavy load): don't try to catch up
                    wall0, sim0 = time.perf_counter(), self.t
            else:
                # Lockstep fast-forward: only advance once every student thread is blocked on
                # sim time (or is busy-polling a getter), so results are deterministic.
                limit = time.perf_counter() + 0.05
                with self.cond:
                    while (not all_blocked() and self.polls == last_polls
                           and time.perf_counter() < limit and should_continue()):
                        self.cond.wait(0.002)
                    last_polls = self.polls
            self.step()
            if on_step:
                on_step()
