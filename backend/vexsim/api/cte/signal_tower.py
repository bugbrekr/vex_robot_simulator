"""VEXcode ``SignalTower`` (see docs/specs/cte_signal_tower.md)."""

from __future__ import annotations

from vexsim.api.common.brain import Event
from vexsim.api.common.constants import _Const
from vexsim.api.common.runtime import runtime


class SignalTower:
    RED = _Const("RED", "red")
    GREEN = _Const("GREEN", "green")
    BLUE = _Const("BLUE", "blue")
    YELLOW = _Const("YELLOW", "yellow")
    WHITE = _Const("WHITE", "white")
    ALL = _Const("ALL", "all")
    ON = _Const("ON", "on")
    OFF = _Const("OFF", "off")
    BLINK = _Const("BLINK", "blink")

    _COLORS = ("red", "green", "blue", "yellow", "white", "all")
    _STATES = ("on", "off", "blink")

    def __init__(self, port=None):
        rt = runtime()
        towers = rt.engine.find("signal_tower")
        if not towers:
            raise RuntimeError("this scenario has no Signal Tower")
        self._m = towers[0]
        self._rt = rt

    def _state(self, s) -> str:
        v = s.value if isinstance(s, _Const) else s
        if v not in self._STATES:
            raise ValueError("state must be SignalTower.ON, OFF or BLINK")
        return v

    def set_color(self, value, state) -> None:
        self._rt.check_stop()
        c = value.value if isinstance(value, _Const) else value
        if c not in self._COLORS:
            raise ValueError("color must be SignalTower.RED/GREEN/BLUE/YELLOW/WHITE/ALL")
        with self._rt.engine.lock:
            self._m.set_led(c, self._state(state))

    def set_colors(self, r, y, g, b, w) -> None:
        self._rt.check_stop()
        with self._rt.engine.lock:
            for color, st in zip(("red", "yellow", "green", "blue", "white"), (r, y, g, b, w)):
                self._m.set_led(color, self._state(st))

    def pressing(self) -> bool:
        self._rt.poll()
        return self._m.bumper

    def pressed(self, callback, arg=()) -> Event:
        with self._rt.engine.lock:
            self._m.on_pressed(callback, tuple(arg))
        self._rt.callbacks_registered += 1
        return Event()

    def released(self, callback, arg=()) -> Event:
        with self._rt.engine.lock:
            self._m.on_released(callback, tuple(arg))
        self._rt.callbacks_registered += 1
        return Event()

    def installed(self) -> bool:
        return True
