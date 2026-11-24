"""IQ (2nd gen) enums, units and the ``Color`` class."""

from __future__ import annotations

import colorsys

from vexsim.api.common.constants import (
    DEGREES,
    INCHES,
    MM,
    MSEC,
    PERCENT,
    SEC,
    SECONDS,
    TURNS,
    DistanceUnits,
    PercentUnits,
    Ports,
    RotationUnits,
    TimeUnits,
    _Const,
)

__all__ = [
    "DEGREES", "INCHES", "MM", "MSEC", "PERCENT", "SEC", "SECONDS", "TURNS",
    "DistanceUnits", "PercentUnits", "Ports", "RotationUnits", "TimeUnits",
]


def _enum(cls_name: str, **members):
    cls = type(cls_name, (), {})
    for k, v in members.items():
        setattr(cls, k, _Const(k, v))
    return cls


DirectionType = _enum("DirectionType", FORWARD="fwd", REVERSE="rev", UNDEFINED="undef")
TurnType = _enum("TurnType", LEFT="left", RIGHT="right", UNDEFINED="undef")
BrakeType = _enum("BrakeType", BRAKE="brake", COAST="coast", HOLD="hold")
VelocityUnits = _enum("VelocityUnits", PERCENT="pct", RPM="rpm", DPS="dps")
VelocityUnits.PERCENT = PERCENT
TorqueUnits = _enum("TorqueUnits", NM="nm", INLB="inlb")
CurrentUnits = _enum("CurrentUnits", AMP="amp")
TemperatureUnits = _enum("TemperatureUnits", CELSIUS="celsius", FAHRENHEIT="fahrenheit")
VoltageUnits = _enum("VoltageUnits", MV="mv", VOLT="volt")
GearSetting = _enum("GearSetting", RATIO_1_1="1:1", RATIO_2_1="2:1", RATIO_3_1="3:1")
FontType = _enum("FontType", MONO12="mono12", MONO15="mono15", MONO20="mono20", MONO30="mono30",
                 MONO40="mono40", MONO60="mono60", PROP20="prop20", PROP30="prop30",
                 PROP40="prop40", PROP60="prop60")
LedStateType = _enum("LedStateType", ON="on", OFF="off")
FadeType = _enum("FadeType", OFF="fade_off", SLOW="slow", FAST="fast")
ObjectSizeType = _enum("ObjectSizeType", NONE="none", SMALL="small", MEDIUM="medium", LARGE="large")
AxisType = _enum("AxisType", XAXIS="x", YAXIS="y", ZAXIS="z")
OrientationType = _enum("OrientationType", ROLL="roll", PITCH="pitch", YAW="yaw")
SoundType = _enum("SoundType", SIREN="siren", WRONG_WAY="wrong_way", WRONG_WAY_SLOW="wrong_way_slow",
                  ALARM="alarm", RATCHET="ratchet", POWER_DOWN="power_down", POWER_UP="power_up",
                  DOOR_CLOSE="door_close", HEADLIGHTS_ON="headlights_on", TADA="tada", FILLUP="fillup")
GestureType = _enum("GestureType", NONE="none", UP="up", DOWN="down", LEFT="g_left", RIGHT="g_right")

FORWARD, REVERSE = DirectionType.FORWARD, DirectionType.REVERSE
LEFT, RIGHT = TurnType.LEFT, TurnType.RIGHT
BRAKE, COAST, HOLD = BrakeType.BRAKE, BrakeType.COAST, BrakeType.HOLD
RPM, DPS = VelocityUnits.RPM, VelocityUnits.DPS
CM = DistanceUnits.CM
MV, VOLT = VoltageUnits.MV, VoltageUnits.VOLT
XAXIS, YAXIS, ZAXIS = AxisType.XAXIS, AxisType.YAXIS, AxisType.ZAXIS
ROLL, PITCH, YAW = OrientationType.ROLL, OrientationType.PITCH, OrientationType.YAW
ON, OFF = LedStateType.ON, LedStateType.OFF
AMP = CurrentUnits.AMP

for _i in range(1, 13):  # bare PORT1 ... PORT12 also appear in the VEX docs
    globals()[f"PORT{_i}"] = getattr(Ports, f"PORT{_i}")


class Color:
    """VEX colour: ``Color(0xFF0000)``, ``Color("#FF0000")``, ``Color(r, g, b)`` or ``Color.RED``."""

    def __init__(self, *args):
        self._transparent = False
        self.value = 0
        if len(args) == 1:
            a = args[0]
            if isinstance(a, Color):
                self.value, self._transparent = a.value, a._transparent
            elif isinstance(a, str):
                self.web(a)
            else:
                self.value = int(a) & 0xFFFFFF
        elif len(args) == 3:
            self.rgb(*args)

    # mutators
    def rgb(self, *args):
        if not args:
            return self.value
        if len(args) == 1:
            self.value = int(args[0]) & 0xFFFFFF
        else:
            r, g, b = (max(0, min(255, int(v))) for v in args[:3])
            self.value = (r << 16) | (g << 8) | b
        self._transparent = False
        return self.value

    def hsv(self, h, s, v):
        r, g, b = colorsys.hsv_to_rgb((float(h) % 360) / 360.0, float(s), float(v))
        return self.rgb(round(r * 255), round(g * 255), round(b * 255))

    def web(self, value: str):
        c = value.strip().lstrip("#")
        if len(c) == 3:
            c = "".join(ch * 2 for ch in c)
        self.value = int(c[:6], 16)
        self._transparent = False
        return self.value

    def is_transparent(self) -> bool:
        return self._transparent

    def hex(self) -> str:
        return f"#{self.value:06x}"

    def __eq__(self, other) -> bool:
        if isinstance(other, Color):
            return self.value == other.value and self._transparent == other._transparent
        if isinstance(other, int):
            return self.value == other and not self._transparent
        return NotImplemented

    def __hash__(self) -> int:
        return hash((self.value, self._transparent))

    def __repr__(self) -> str:
        for name in _NAMED:
            if getattr(Color, name) == self:
                return f"Color.{name}"
        return f"Color({self.hex()})"


_NAMED = {
    "BLACK": 0x000000, "WHITE": 0xFFFFFF, "RED": 0xFF0000, "GREEN": 0x00FF00, "BLUE": 0x0000FF,
    "YELLOW": 0xFFFF00, "ORANGE": 0xFF8000, "PURPLE": 0xFF00FF, "CYAN": 0x00FFFF,
    "RED_VIOLET": 0xFF0080, "VIOLET": 0x8000FF, "BLUE_VIOLET": 0x4000FF, "BLUE_GREEN": 0x00FF80,
    "YELLOW_GREEN": 0x80FF00, "YELLOW_ORANGE": 0xFFC000, "RED_ORANGE": 0xFF4000,
}
for _n, _v in _NAMED.items():
    setattr(Color, _n, Color(_v))
Color.TRANSPARENT = Color(0)
Color.TRANSPARENT._transparent = True


def color_hex(c, default: str | None = None) -> str | None:
    """Accept Color, hex int, '#rrggbb' or None."""
    if c is None:
        return default
    if isinstance(c, Color):
        return None if c.is_transparent() else c.hex()
    if isinstance(c, str):
        return Color(c).hex()
    if isinstance(c, (int, float)):
        return f"#{int(c) & 0xFFFFFF:06x}"
    raise TypeError(f"not a colour: {c!r}")


# ---------------------------------------------------------------------- unit conversions
MOTOR_MAX_DPS = 720.0  # 120 rpm


def vel_dps(value, units, default_units=RPM) -> float:
    units = default_units if units is None else units
    v = float(value)
    if units == PERCENT:
        return v / 100.0 * MOTOR_MAX_DPS
    if units == RPM:
        return v * 6.0
    if units == DPS:
        return v
    raise ValueError(f"unsupported velocity units {units!r}")


def dps_to(value_dps: float, units) -> float:
    if units == PERCENT:
        return value_dps / MOTOR_MAX_DPS * 100.0
    if units == RPM:
        return value_dps / 6.0
    if units == DPS:
        return value_dps
    raise ValueError(f"unsupported velocity units {units!r}")


def rot_deg(value, units) -> float:
    if units is None or units == DEGREES:
        return float(value)
    if units == TURNS:
        return float(value) * 360.0
    raise ValueError(f"unsupported rotation units {units!r} (use DEGREES or TURNS)")


def deg_to(value_deg: float, units) -> float:
    if units is None or units == DEGREES:
        return value_deg
    if units == TURNS:
        return value_deg / 360.0
    raise ValueError(f"unsupported rotation units {units!r}")


def dist_mm(value, units) -> float:
    if units is None or units == MM:
        return float(value)
    if units == INCHES:
        return float(value) * 25.4
    if units == CM:
        return float(value) * 10.0
    raise ValueError(f"unsupported distance units {units!r}")


def mm_to(value_mm: float, units) -> float:
    if units is None or units == MM:
        return value_mm
    if units == INCHES:
        return value_mm / 25.4
    if units == CM:
        return value_mm / 10.0
    raise ValueError(f"unsupported distance units {units!r}")
