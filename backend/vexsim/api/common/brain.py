"""Brain, wait(), timers, Thread and Event - the VEXcode runtime surface."""

from __future__ import annotations

import builtins

from vexsim.api.common.constants import MSEC, SECONDS, to_seconds
from vexsim.api.common.runtime import runtime


def wait(time: float, units=MSEC) -> None:
    rt = runtime()
    rt.check_stop()
    rt.engine.sleep(to_seconds(time, units))


def sim_print(*args, sep: str = " ", end: str = "\n", **_kw) -> None:
    """Replacement for builtin print inside student code -> Print Console."""
    runtime().print(sep.join(str(a) for a in args) + end)


class Timer:
    def __init__(self) -> None:
        self._t0 = runtime().engine.t

    def time(self, units=MSEC):
        runtime().poll()
        dt = runtime().engine.t - self._t0
        return round(dt, 3) if units == SECONDS else int(round(dt * 1000))

    def clear(self) -> None:
        self._t0 = runtime().engine.t

    reset = clear

    def value(self) -> float:
        return self.time(SECONDS)

    def event(self, callback, delay, arg=()) -> None:
        timer_event(callback, delay, arg)


def timer_event(callback, delay, arg=()) -> None:
    """Call ``callback(*arg)`` once after ``delay`` ms (sim time)."""
    rt = runtime()
    rt.callbacks_registered += 1

    def fire():
        rt.callbacks_registered -= 1
        rt.spawn_callback(callback, tuple(arg))

    rt.engine.schedule(float(delay) / 1000.0, fire)


class _Screen:
    """Minimal brain screen: routes text to the console (CTE has no brain screen)."""

    def __init__(self) -> None:
        self._row = ""

    def print(self, *args, sep: str = " ", precision: int | None = None) -> None:
        self._row += sep.join(_fmt(a, precision) for a in args)

    def next_row(self) -> None:
        runtime().print(self._row + "\n")
        self._row = ""

    new_line = next_row

    def clear_screen(self, *_a) -> None:
        self._row = ""

    def set_cursor(self, *_a) -> None:
        pass


def _fmt(v, precision):
    if precision is not None and isinstance(v, float):
        return f"{v:.{precision}f}"
    return str(v)


class Brain:
    def __init__(self) -> None:
        self.timer = Timer()
        self.screen = _Screen()

    # console
    def print(self, *args, precision: int | None = None, sep: str = "") -> None:
        runtime().print(sep.join(_fmt(a, precision) for a in args))

    def next_row(self) -> None:
        runtime().print("\n")

    new_line = next_row

    def clear(self) -> None:
        runtime().print("\x0c")  # form feed -> frontend clears console

    # CTE-style timer helpers
    def timer_time(self, units=MSEC):
        return self.timer.time(units)

    def timer_reset(self) -> None:
        self.timer.clear()

    def program_stop(self) -> None:
        rt = runtime()
        rt.stop_all()
        rt.check_stop()


class Event:
    """Generic VEX Event: ``e = Event(cb); e.broadcast()``; also returned by callback APIs."""

    def __init__(self, callback=None, arg=()):
        self._handlers = []
        if callback is not None:
            self(callback, arg)

    def __call__(self, callback, arg=()):
        self._handlers.append((callback, tuple(arg)))
        runtime().callbacks_registered += 1
        return self

    def set(self, callback, arg=()):
        return self(callback, arg)

    def broadcast(self) -> None:
        for fn, arg in self._handlers:
            runtime().spawn_callback(fn, arg)

    def broadcast_and_wait(self) -> None:
        self.broadcast()


class Thread:
    """VEXcode Thread: starts immediately; ``stop()`` ends it (cannot be restarted)."""

    def __init__(self, func, args=()):
        self._t = runtime().start_thread(func, tuple(args), name=f"thread:{func.__name__}")

    def stop(self) -> None:
        self._t.request_stop()

    @staticmethod
    def sleep_for(duration, units=MSEC) -> None:
        wait(duration, units)


builtins_print = builtins.print
