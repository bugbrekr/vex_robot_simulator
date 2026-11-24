"""IQ (2nd gen) Brain model: 160x108 colour screen (as a display list), buttons, battery.

The screen is kept as a list of drawing ops since the last clear. New ops are sent to the
browser in each frame (``drain()``); the browser replays them onto a canvas. Text printed at the
cursor is also kept per row (``text_rows()``) so tests and headless runs can read the screen.
"""

from __future__ import annotations

from collections.abc import Callable

from vexsim.core.entity import Entity

WIDTH, HEIGHT = 160, 108  # REAL: the program area below the brain's 20 px status bar
MAX_OPS = 600  # ops kept since the last clear (older ones are dropped)
DEFAULT_FONT = "mono20"  # REAL
# The IQ (2nd gen) screen is light-themed (KB screen captures): programs draw black on white.
DEFAULT_PEN = "#000000"  # ESTIMATE
DEFAULT_FILL = "#ffffff"  # ESTIMATE
BACKGROUND = "#ffffff"  # ESTIMATE

# font -> (character cell width, row height) in px. Rows/columns per screen match the API page
# captions (MONO12 26x9, MONO15 20x7, MONO20 16x5, MONO30 x3, PROP20 26x5, PROP30 18x3, PROP40 14x2).
FONTS = {
    "mono12": (6, 12), "mono15": (8, 15), "mono20": (10, 20), "mono30": (15, 30),
    "mono40": (20, 40), "mono60": (30, 60),
    "prop20": (6, 20), "prop30": (9, 30), "prop40": (11, 40), "prop60": (16, 60),
}
BUTTONS = ("check", "left", "right")


class BrainModel(Entity):
    kind = "iq2_brain"

    def __init__(self, name: str = "brain"):
        super().__init__(name)
        self.buttons = {b: False for b in BUTTONS}
        self._cbs: dict[tuple[str, bool], list[tuple[Callable, tuple]]] = {}
        self.ops: list[dict] = []
        self._pending: list[dict] = []
        self._buffer: list[dict] | None = None  # render() double buffering
        self.battery_pct = 96.0
        self.reset_screen()

    # ------------------------------------------------------------------ screen state
    def reset_screen(self) -> None:
        self.row, self.col = 1, 1
        self.font = DEFAULT_FONT
        self.pen = DEFAULT_PEN
        self.fill = DEFAULT_FILL
        self.pen_width = 1
        self.origin = (0, 0)
        self.clip = None
        self.rows: dict[int, str] = {}
        self._buffer = None
        self.ops = []
        self._pending = [{"o": "clr", "c": BACKGROUND}]

    def reset_for_program(self) -> None:
        """A new project owns the screen: clear it and forget the old button callbacks."""
        self._cbs.clear()
        self.reset_screen()

    def _emit(self, op: dict) -> None:
        if self._buffer is not None:
            self._buffer.append(op)
            return
        self._push(op)

    def _push(self, op: dict) -> None:
        if op["o"] == "clr":
            self.ops = []
            self._pending = []
        self.ops.append(op)
        self._pending.append(op)
        if len(self.ops) > MAX_OPS:
            self.ops = [{"o": "clr", "c": BACKGROUND}] + self.ops[-(MAX_OPS - 1):]
            self._pending = [{"o": "full"}]  # tell the client to resync from the full list

    def drain(self) -> list[dict]:
        out, self._pending = self._pending, []
        if out and out[0].get("o") == "full":
            return [{"o": "clr", "c": BACKGROUND}, *self.ops]
        return out

    def cell(self) -> tuple[int, int]:
        return FONTS.get(self.font, FONTS[DEFAULT_FONT])

    # ------------------------------------------------------------------ screen API
    def print_text(self, text: str, opaque: bool = False) -> None:
        cw, rh = self.cell()
        x = self.origin[0] + (self.col - 1) * cw
        y = self.origin[1] + (self.row - 1) * rh
        self._emit({"o": "t", "x": x, "y": y, "s": text, "f": self.font, "c": self.pen,
                    "b": self.fill if opaque else None})
        line = self.rows.get(self.row, "")
        start = self.col - 1
        line = line.ljust(start) [:start] + text + line[start + len(text):]
        self.rows[self.row] = line
        self.col += len(text)

    def print_at(self, text: str, x: float, y: float, opaque: bool = False) -> None:
        self._emit({"o": "t", "x": self.origin[0] + x, "y": self.origin[1] + y, "s": text,
                    "f": self.font, "c": self.pen, "b": self.fill if opaque else None, "bl": 1})

    def set_cursor(self, row: int, col: int) -> None:
        self.row, self.col = max(1, int(row)), max(1, int(col))

    def next_row(self) -> None:
        self.row += 1
        self.col = 1

    def clear_screen(self, color: str | None = None) -> None:
        # The cursor is NOT moved (V5/IQ behaviour: use set_cursor(1, 1) after clearing).
        self.rows = {}
        self._emit({"o": "clr", "c": color or BACKGROUND})

    def clear_row(self, row: int | None = None, color: str | None = None) -> None:
        row = self.row if row is None else int(row)
        _, rh = self.cell()
        self.rows.pop(row, None)
        self._emit({"o": "r", "x": 0, "y": self.origin[1] + (row - 1) * rh, "w": WIDTH, "h": rh,
                    "pc": None, "fc": color or BACKGROUND, "pw": 0})

    def draw(self, op: dict) -> None:
        ox, oy = self.origin
        if "x" in op:
            op["x"] += ox
            op["y"] += oy
        if "x2" in op:
            op["x2"] += ox
            op["y2"] += oy
        self._emit(op)

    def render(self) -> None:
        if self._buffer is None:  # first call switches to double buffering
            self._buffer = []
            return
        for op in self._buffer:
            self._push(op)
        self._buffer = []

    def text_rows(self) -> list[str]:
        if not self.rows:
            return []
        return [self.rows.get(r, "").rstrip() for r in range(1, max(self.rows) + 1)]

    # ------------------------------------------------------------------ buttons
    def on_button(self, button: str, pressed: bool, fn: Callable, args: tuple = ()) -> None:
        self._cbs.setdefault((button, pressed), []).append((fn, args))

    def set_button(self, button: str, pressed: bool) -> None:
        if button not in self.buttons or self.buttons[button] == pressed:
            return
        self.buttons[button] = pressed
        for fn, args in self._cbs.get((button, pressed), []):
            self.engine.spawn_callback(fn, args)

    def snapshot(self) -> dict:
        return {"buttons": dict(self.buttons), "screen": self.drain(),
                "battery": round(self.battery_pct)}
