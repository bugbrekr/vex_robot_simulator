"""The ``vex`` namespace for the CTE platform: ``from vex import *`` in student code."""

from vexsim.api.common.brain import Brain, Event, Thread, Timer, timer_event, wait
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
    Ports,
    TimeUnits,
)
from vexsim.api.cte.arm import Arm
from vexsim.api.cte.cte_thread import cte_thread
from vexsim.api.cte.signal_tower import SignalTower

__all__ = [
    "DEGREES",
    "INCHES",
    "MM",
    "MSEC",
    "PERCENT",
    "SEC",
    "SECONDS",
    "TURNS",
    "Arm",
    "Brain",
    "DistanceUnits",
    "Event",
    "Ports",
    "SignalTower",
    "Thread",
    "TimeUnits",
    "Timer",
    "cte_thread",
    "timer_event",
    "wait",
]
