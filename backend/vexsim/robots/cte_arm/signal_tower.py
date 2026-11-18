"""Signal Tower model: 5 LEDs (ON/OFF/BLINK) + bumper switch."""

from __future__ import annotations

from collections.abc import Callable

from vexsim.core.entity import Entity

COLORS = ("red", "yellow", "green", "blue", "white")  # set_colors(r, y, g, b, w) order
OFF, ON, BLINK = "off", "on", "blink"
BLINK_PERIOD = 0.5  # s  (ESTIMATE: 2 Hz, 50 % duty)


class SignalTowerModel(Entity):
    kind = "signal_tower"

    def __init__(self, name: str = "signal_tower", position=(150.0, 225.0)):
        super().__init__(name)
        self.position = tuple(position)
        self.leds: dict[str, str] = {c: OFF for c in COLORS}
        self.bumper = False
        self._pressed_cbs: list[tuple[Callable, tuple]] = []
        self._released_cbs: list[tuple[Callable, tuple]] = []
        self._t = 0.0

    def set_led(self, color: str, state: str) -> None:
        targets = COLORS if color == "all" else (color,)
        for c in targets:
            self.leds[c] = state

    def lit(self, t: float | None = None) -> dict[str, bool]:
        t = self._t if t is None else t
        phase_on = (t % BLINK_PERIOD) < BLINK_PERIOD / 2
        return {c: s == ON or (s == BLINK and phase_on) for c, s in self.leds.items()}

    def on_pressed(self, fn: Callable, args: tuple = ()) -> None:
        self._pressed_cbs.append((fn, args))

    def on_released(self, fn: Callable, args: tuple = ()) -> None:
        self._released_cbs.append((fn, args))

    def reset_for_program(self) -> None:
        """New project: forget the previous project's bumper callbacks (LEDs keep their state)."""
        self._pressed_cbs.clear()
        self._released_cbs.clear()

    def set_bumper(self, pressed: bool) -> None:
        """Called (under engine lock) by UI input."""
        if pressed == self.bumper:
            return
        self.bumper = pressed
        cbs = self._pressed_cbs if pressed else self._released_cbs
        for fn, args in cbs:
            self.engine.spawn_callback(fn, args)

    def step(self, t: float, dt: float) -> None:
        self._t = t + dt

    def snapshot(self) -> dict:
        return {"leds": dict(self.leds), "lit": self.lit(), "bumper": self.bumper}

    def describe(self) -> dict:
        return {"name": self.name, "kind": self.kind, "position": list(self.position),
                "colors": list(COLORS)}
