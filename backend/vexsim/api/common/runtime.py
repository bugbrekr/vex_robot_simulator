"""Runtime glue between student code (threads) and the SimEngine.

One Runtime exists per worker process; API classes look it up with ``runtime()``."""

from __future__ import annotations

import ctypes
import threading
import traceback
from collections.abc import Callable
from typing import Any

from vexsim.core.engine import ProgramStopped, SimEngine

_RUNTIME: Runtime | None = None
STUDENT_FILENAME = "main.py"


def runtime() -> Runtime:
    """The Runtime of the calling student thread (falls back to the current project's)."""
    th = threading.current_thread()
    if isinstance(th, StudentThread):
        return th.rt
    if _RUNTIME is None:
        raise RuntimeError("vex API used outside a simulator session")
    return _RUNTIME


def thread_stop_check() -> None:
    """Raise ProgramStopped in a student thread whose project (or itself) was stopped."""
    th = threading.current_thread()
    if isinstance(th, StudentThread) and (th.stop_requested or th.rt.stopped):
        raise ProgramStopped()


_time_patched = False


def install_time_patch() -> None:
    """Make ``time.sleep`` inside student threads wait in *simulated* time (and be stoppable)."""
    global _time_patched
    if _time_patched:
        return
    import time as _time

    real_sleep = _time.sleep

    def sleep(seconds):
        th = threading.current_thread()
        if isinstance(th, StudentThread):
            th.rt.check_stop()
            th.rt.engine.sleep(float(seconds))
        else:
            real_sleep(seconds)

    _time.sleep = sleep
    _time_patched = True


def install(rt: Runtime | None) -> None:
    global _RUNTIME
    _RUNTIME = rt


class StudentThread(threading.Thread):
    def __init__(self, rt: Runtime, fn: Callable, args: tuple = (), name: str = "student"):
        super().__init__(daemon=True, name=name)
        self.rt, self.fn, self.args = rt, fn, args
        self.stop_requested = False

    def run(self) -> None:
        try:
            self.fn(*self.args)
        except ProgramStopped:
            pass
        except SystemExit:
            pass
        except BaseException as exc:  # noqa: BLE001 - report every student error
            self.rt.report_error(exc)
        finally:
            self.rt._thread_done(self)

    def request_stop(self) -> None:
        self.stop_requested = True
        if self.is_alive() and self.ident is not None:
            ctypes.pythonapi.PyThreadState_SetAsyncExc(
                ctypes.c_ulong(self.ident), ctypes.py_object(ProgramStopped)
            )


class Runtime:
    def __init__(self, engine: SimEngine, devices: dict[str, Any], platform: str):
        self.engine = engine
        self.devices = devices
        self.platform = platform
        self.stopped = False
        self.threads: list[StudentThread] = []
        self._threads_lock = threading.Lock()
        self.callbacks_registered = 0
        self.console_out: Callable[[str], None] = lambda s: None
        self.warn_out: Callable[[str], None] = lambda s: None
        self.error_out: Callable[[dict], None] = lambda e: None
        self.errors: list[dict] = []
        engine.stop_check = thread_stop_check
        engine.spawn_callback = self.spawn_callback

    # ---------------------------------------------------------------- threads
    def start_thread(self, fn: Callable, args: tuple = (), name: str = "student") -> StudentThread:
        th = StudentThread(self, fn, args, name)
        with self._threads_lock:
            self.threads.append(th)
        th.start()
        return th

    def spawn_callback(self, fn: Callable, args: tuple = ()) -> None:
        if not self.stopped:
            self.start_thread(fn, tuple(args), name=f"cb:{getattr(fn, '__name__', 'fn')}")

    def _thread_done(self, th: StudentThread) -> None:
        with self._threads_lock:
            if th in self.threads:
                self.threads.remove(th)

    def live_threads(self) -> int:
        with self._threads_lock:
            return sum(1 for t in self.threads if t.is_alive())

    def all_blocked(self) -> bool:
        """Every live student thread is waiting on sim time and none is about to wake."""
        with self.engine.lock:
            return (self.engine.blocked_waiters >= self.live_threads()
                    and not self.engine.waiter_ready())

    def poll(self) -> None:
        """Called by API getters: stop check + lets busy-poll loops advance sim time."""
        self.check_stop()
        with self.engine.cond:
            self.engine.note_poll()
            self.engine.cond.notify_all()

    def check_stop(self) -> None:
        if self.stopped:
            raise ProgramStopped()
        thread_stop_check()

    def stop_all(self) -> None:
        self.stopped = True
        with self.engine.cond:
            self.engine.cond.notify_all()
        with self._threads_lock:
            threads = list(self.threads)
        for th in threads:
            if th is not threading.current_thread():
                th.request_stop()

    # ---------------------------------------------------------------- io
    def print(self, text: str) -> None:
        self.console_out(text)

    def warn(self, text: str) -> None:
        self.warn_out(text)

    def report_error(self, exc: BaseException) -> None:
        tb = traceback.extract_tb(exc.__traceback__)
        line = None
        frames = [f for f in tb if f.filename == STUDENT_FILENAME]
        if frames:
            line = frames[-1].lineno
        msg = "".join(traceback.format_exception_only(type(exc), exc)).strip()
        student_tb = "".join(traceback.format_list(frames)) if frames else ""
        err = {"message": msg, "line": line, "traceback": student_tb}
        self.errors.append(err)
        self.error_out(err)
