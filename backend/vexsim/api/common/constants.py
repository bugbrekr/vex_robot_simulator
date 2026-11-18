"""VEXcode-style enums and constants shared by every platform."""

from __future__ import annotations


class _Const:
    """A named constant that prints like VEXcode's (e.g. ``MSEC``)."""

    __slots__ = ("name", "value")

    def __init__(self, name: str, value=None):
        self.name = name
        self.value = name.lower() if value is None else value

    def __repr__(self) -> str:
        return self.name

    def __eq__(self, other) -> bool:
        if isinstance(other, _Const):
            return self.value == other.value
        return self.value == other

    def __hash__(self) -> int:
        return hash(self.value)


class TimeUnits:
    MSEC = _Const("MSEC", "msec")
    SECONDS = _Const("SECONDS", "sec")
    SEC = SECONDS


class DistanceUnits:
    MM = _Const("MM", "mm")
    INCHES = _Const("INCHES", "inches")
    CM = _Const("CM", "cm")


class RotationUnits:
    DEG = _Const("DEGREES", "deg")
    REV = _Const("TURNS", "rev")


class PercentUnits:
    PERCENT = _Const("PERCENT", "pct")


MSEC = TimeUnits.MSEC
SECONDS = TimeUnits.SECONDS
SEC = TimeUnits.SEC
MM = DistanceUnits.MM
INCHES = DistanceUnits.INCHES
DEGREES = RotationUnits.DEG
TURNS = RotationUnits.REV
PERCENT = PercentUnits.PERCENT


class _Port:
    def __init__(self, index: int):
        self.index = index

    def __repr__(self) -> str:
        return f"Ports.PORT{self.index}"


class Ports:
    pass


for _i in range(1, 13):
    setattr(Ports, f"PORT{_i}", _Port(_i))


def to_seconds(value: float, units) -> float:
    if units == SECONDS:
        return float(value)
    if units == MSEC or units is None:
        return float(value) / 1000.0
    raise ValueError(f"unsupported time unit {units!r}")
