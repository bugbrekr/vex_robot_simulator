"""IQ2 ``Brain``: screen, buttons, battery, timer (api.vex.com/iq2/home/python/Screen.html, Brain.html)."""

from __future__ import annotations

from vexsim.api.common.brain import Event, Timer
from vexsim.api.common.runtime import runtime
from vexsim.api.iq2.constants import MV, VOLT, FontType, color_hex


def _fmt(v, precision) -> str:
    if isinstance(v, bool):
        return str(v)
    if isinstance(v, float):
        return f"{v:.{2 if precision is None else int(precision)}f}"
    return str(v)


class Screen:
    def __init__(self, brain_model):
        self._b = brain_model
        self._rt = runtime()

    def _lock(self):
        return self._rt.engine.lock

    def print(self, *args, precision=2, opaque=False, sep=" ") -> None:
        self._rt.check_stop()
        text = sep.join(_fmt(a, precision) for a in args)
        with self._lock():
            self._b.print_text(text, bool(opaque))

    def print_at(self, *args, x=0, y=0, precision=2, opaque=False, sep=" ") -> None:
        self._rt.check_stop()
        text = sep.join(_fmt(a, precision) for a in args)
        with self._lock():
            self._b.print_at(text, float(x), float(y), bool(opaque))

    def set_cursor(self, row, column) -> None:
        with self._lock():
            self._b.set_cursor(row, column)

    def next_row(self) -> None:
        with self._lock():
            self._b.next_row()

    new_line = next_row

    def row(self) -> int:
        return self._b.row

    def column(self) -> int:
        return self._b.col

    def clear_screen(self, color=None) -> None:
        self._rt.check_stop()
        with self._lock():
            self._b.clear_screen(color_hex(color))

    def clear_row(self, row=None, color=None) -> None:
        with self._lock():
            self._b.clear_row(row, color_hex(color))

    def set_font(self, fontname) -> None:
        name = getattr(fontname, "value", None) or str(fontname).lower()
        with self._lock():
            self._b.font = name

    def set_pen_width(self, width) -> None:
        with self._lock():
            self._b.pen_width = max(0, min(32, int(width)))

    def set_pen_color(self, color=None) -> None:
        with self._lock():
            self._b.pen = color_hex(color, "#ffffff") or "transparent"

    def set_fill_color(self, color=None) -> None:
        with self._lock():
            self._b.fill = color_hex(color, "#000000") or "transparent"

    def set_origin(self, x, y) -> None:
        with self._lock():
            self._b.origin = (int(x), int(y))

    def set_clip_region(self, x, y, width, height) -> None:
        with self._lock():
            self._b.draw({"o": "clip", "x": float(x), "y": float(y), "w": float(width), "h": float(height)})

    def get_string_width(self, string) -> int:
        cw, _ = self._b.cell()
        return cw * len(str(string))

    def get_string_height(self, string) -> int:
        _, rh = self._b.cell()
        return rh

    def _style(self) -> dict:
        b = self._b
        return {"pc": b.pen, "fc": b.fill, "pw": b.pen_width}

    def draw_pixel(self, x, y) -> None:
        with self._lock():
            self._b.draw({"o": "p", "x": float(x), "y": float(y), "pc": self._b.pen})

    def draw_line(self, x1, y1, x2, y2) -> None:
        with self._lock():
            self._b.draw({"o": "l", "x": float(x1), "y": float(y1), "x2": float(x2), "y2": float(y2),
                          **self._style()})

    def draw_rectangle(self, x, y, width, height, color=None) -> None:
        with self._lock():
            st = self._style()
            if color is not None:
                st["fc"] = color_hex(color) or "transparent"
            self._b.draw({"o": "r", "x": float(x), "y": float(y), "w": float(width), "h": float(height), **st})

    def draw_circle(self, x, y, radius, color=None) -> None:
        with self._lock():
            st = self._style()
            if color is not None:
                st["fc"] = color_hex(color) or "transparent"
            self._b.draw({"o": "c", "x": float(x), "y": float(y), "r": float(radius), **st})

    def render(self) -> None:
        with self._lock():
            self._b.render()


class BrainButton:
    def __init__(self, brain_model, name: str):
        self._b = brain_model
        self._name = name
        self._rt = runtime()

    def pressing(self) -> bool:
        self._rt.poll()
        with self._rt.engine.lock:
            return bool(self._b.buttons[self._name])

    def pressed(self, callback, arg=()) -> Event:
        with self._rt.engine.lock:
            self._b.on_button(self._name, True, callback, tuple(arg))
        self._rt.callbacks_registered += 1
        return Event()

    def released(self, callback, arg=()) -> Event:
        with self._rt.engine.lock:
            self._b.on_button(self._name, False, callback, tuple(arg))
        self._rt.callbacks_registered += 1
        return Event()


class Battery:
    def __init__(self, brain_model):
        self._b = brain_model
        self._rt = runtime()

    def capacity(self, units=None) -> int:
        return round(self._b.battery_pct)

    def voltage(self, units=MV) -> float:
        v = 7.0 + 0.9 * self._b.battery_pct / 100.0  # REAL range 7.0-8.0 V
        return round(v, 2) if units == VOLT else round(v * 1000)

    def current(self, units=None) -> float:
        robot = self._rt.devices.get("robot")
        if robot is None:
            return 0.0
        return round(0.25 + sum(m.current() for m in robot.motors.values()), 2)


class _BrainTimer(Timer):
    def system(self) -> int:
        return round(runtime().engine.t * 1000)

    def system_high_res(self) -> int:
        return round(runtime().engine.t * 1_000_000)


class Brain:
    def __init__(self) -> None:
        rt = runtime()
        model = rt.devices["brain"]
        self._rt = rt
        self.screen = Screen(model)
        self.timer = _BrainTimer()
        self.battery = Battery(model)
        self.buttonCheck = BrainButton(model, "check")
        self.buttonLeft = BrainButton(model, "left")
        self.buttonRight = BrainButton(model, "right")

    def play_sound(self, sound, *args) -> None:
        self._rt.print(f"[brain sound: {getattr(sound, 'name', sound)}]\n")

    def play_note(self, *args) -> None:
        pass

    def set_sound_volume(self, *args) -> None:
        pass

    def program_stop(self) -> None:
        self._rt.stop_all()
        self._rt.check_stop()

    # console helpers (shared with the other platforms)
    def print(self, *args, precision=None, sep="") -> None:
        self._rt.print(sep.join(_fmt(a, precision) for a in args))

    def clear(self) -> None:
        self._rt.print("\x0c")

    def timer_time(self, units=None):
        return self.timer.time(units) if units is not None else self.timer.time()

    def timer_reset(self) -> None:
        self.timer.clear()


__all__ = ["Brain", "FontType"]
