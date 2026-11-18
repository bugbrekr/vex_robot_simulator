import inspect

import pytest

import vexsim.api.cte as vex
from tests.conftest import HEADER

ARM_SIGNATURES = {
    "move_to": ["x", "y", "z", "wait"],
    "move_inc": ["x", "y", "z", "wait"],
    "move_end_effector_to": ["yaw", "roll", "pitch", "wait"],
    "move_end_effector_inc": ["yaw", "roll", "pitch", "wait"],
    "set_speed": ["speed"],
    "set_end_effector_type": ["type"],
    "set_end_effector_magnet": ["state"],
    "set_pen_offset": ["zOffset"],
    "set_control_stop": ["state"],
    "set_timeout": ["timeout", "units"],
    "is_done": [],
    "get_x": [], "get_y": [], "get_z": [],
    "get_pitch": [], "get_roll": [], "get_yaw": [],
    "get_timeout": [], "is_connected": [], "is_crashed": [],
    "can_arm_reach_to": ["x", "y", "z"],
    "can_arm_reach_inc": ["x", "y", "z"],
    "can_end_effector_reach_to": ["yaw", "roll", "pitch"],
    "can_end_effector_reach_inc": ["yaw", "roll", "pitch"],
    "control_stopped": ["callback", "arg"],
    "crashed": ["callback", "arg"],
}


@pytest.mark.parametrize("name,params", ARM_SIGNATURES.items())
def test_arm_signatures(name, params):
    sig = inspect.signature(getattr(vex.Arm, name))
    assert list(sig.parameters)[1:] == params


def test_constants_exist():
    for n in ("MAGNET", "PEN"):
        assert hasattr(vex.Arm, n)
    for n in ("RED", "GREEN", "BLUE", "YELLOW", "WHITE", "ALL", "ON", "OFF", "BLINK"):
        assert hasattr(vex.SignalTower, n)
    for n in ("MSEC", "SECONDS", "SEC", "MM", "INCHES", "Ports", "wait", "Thread", "Event",
              "Brain", "timer_event"):
        assert hasattr(vex, n)
    assert repr(vex.Ports.PORT12) == "Ports.PORT12"


def test_move_and_getters(run):
    s = run(HEADER + "print(arm.move_to(200, 0, 50))\nprint(arm.get_x(), arm.get_y(), arm.get_z())\n"
            "print(arm.is_done(), arm.get_yaw(), arm.get_roll(), arm.get_pitch())")
    assert s["console"].splitlines() == ["True", "200.0 0.0 50.0", "True 0.0 0.0 0.0"]
    assert not s["errors"]


def test_unreachable_returns_false(run):
    s = run(HEADER + "print(arm.can_arm_reach_to(500, 0, 0))\nprint(arm.move_to(500, 0, 0))\n"
            "print(arm.get_x())")
    assert s["console"].splitlines() == ["False", "False", "120.0"]
    assert any("unreachable" in w for w in s["warnings"])


def test_move_inc_and_wait_false(run):
    s = run(HEADER + "arm.move_inc(50, 0, 0, wait=False)\nprint(arm.is_done())\n"
            "while not arm.is_done():\n    wait(10)\nprint(arm.get_x())")
    assert s["console"].splitlines() == ["False", "170.0"]


def test_speed_affects_duration(run):
    slow = run(HEADER + "arm.set_speed(20)\narm.move_inc(100, 0, 0)")["t"]
    fast = run(HEADER + "arm.set_speed(100)\narm.move_inc(100, 0, 0)")["t"]
    assert slow > 2 * fast


def test_end_effector_orientation(run):
    s = run(HEADER + "print(arm.move_end_effector_to(30, 0, 0))\nprint(round(arm.get_yaw()))\n"
            "print(arm.can_end_effector_reach_to(0, 0, 179))")
    lines = s["console"].splitlines()
    assert lines[0] == "True" and lines[1] == "30"


def test_control_stop_latches_and_fires_callback(run):
    s = run(HEADER + "def cb():\n    print('stopped!')\narm.control_stopped(cb)\n"
            "arm.move_to(250, 0, 50, wait=False)\nwait(300)\narm.set_control_stop()\nwait(100)\n"
            "print(arm.move_to(150, 0, 50))")
    assert "stopped!" in s["console"]
    assert s["console"].strip().endswith("False")


def test_timeout(run):
    s = run(HEADER + "arm.set_speed(10)\narm.set_timeout(200, MSEC)\nprint(arm.get_timeout())\n"
            "print(arm.move_inc(100, 0, 0))\nprint(arm.is_done())")
    assert s["console"].splitlines() == ["200", "False", "True"]


def test_timer_wait_and_threads(run):
    s = run(HEADER + "def blink():\n    while True:\n        tower.set_color(SignalTower.RED, "
            "SignalTower.ON)\n        wait(100)\nt = Thread(blink)\nwait(1, SECONDS)\nt.stop()\n"
            "print(brain.timer_time(MSEC))\nhits = []\ntimer_event(lambda: hits.append(1), 200)\n"
            "wait(300)\nprint(len(hits))")
    assert s["console"].splitlines() == ["1000", "1"]


def test_signal_tower_set_colors(run):
    s = run(HEADER + "tower.set_colors(SignalTower.ON, SignalTower.BLINK, SignalTower.OFF, "
            "SignalTower.OFF, SignalTower.ON)")
    assert s["signal_tower"]["leds"] == {"red": "on", "yellow": "blink", "green": "off",
                                         "blue": "off", "white": "on"}


def test_student_error_reports_line(run):
    s = run(HEADER + "x = 1\nundefined_name\n")
    assert s["errors"] and s["errors"][0]["line"] == 6
    assert "NameError" in s["errors"][0]["message"]


def test_syntax_error_reported(run):
    s = run("from vex import *\nif True\n")
    assert s["errors"] and s["errors"][0]["line"] == 2


def test_program_stop(run):
    s = run(HEADER + "print('a')\nbrain.program_stop()\nprint('b')")
    assert s["console"] == "a\n"


def test_busy_poll_loop_advances_time(run):
    s = run(HEADER + "arm.move_inc(100, 0, 0, False)\nwhile not arm.is_done():\n    pass\n"
            "print(arm.get_x())")
    assert s["console"].splitlines() == ["220.0"]


def test_deterministic_timing(run):
    code = HEADER + "arm.move_to(200, 100, 40)\narm.move_inc(0, -150, 30)\nprint(brain.timer_time())"
    assert len({run(code)["console"] for _ in range(3)}) == 1


def test_cte_thread_runs_main_without_warning(run):
    s = run(HEADER + "def main():\n    arm.move_inc(20, 0, 0)\n    print('x', arm.get_x())\n\ncte_thread(main)\n")
    assert s["console"].startswith("x 140")
    assert not any("cte_thread" in w for w in s["warnings"])


def test_cte_thread_passes_args(run):
    s = run(HEADER + "def main(a, b):\n    print('sum', a + b)\n\ncte_thread(main, (2, 3))\n")
    assert "sum 5" in s["console"]


def test_missing_cte_thread_warns_but_still_runs(run):
    s = run(HEADER + "arm.move_inc(20, 0, 0)\nprint('x', arm.get_x())\n")
    assert s["console"].startswith("x 140")
    assert any("cte_thread(main)" in w for w in s["warnings"])


CODEEXP_TEMPLATE = '''#region VEXcode Generated Robot Configuration
from cte import *
import math
import random

# Brain should be defined by default
brain = Brain()

# Robot configuration code
arm = Arm()
signal_tower = arm.signal_tower


# Wait for sensor(s) to fully initialize
wait(100, MSEC)

#endregion VEXcode Generated Robot Configuration

# Library imports
from cte import *

# Add project code in "main"
def main():
    signal_tower.set_color(SignalTower.BLUE, SignalTower.BLINK)
    arm.move_to(180, 0, 180)
    print("\\033[2J")
    print(round(arm.get_z()))

# CTE threads — Do not delete
cte_thread(main)
'''


def test_codeexp_template_runs(run):
    """The boilerplate of a new CTE Python project on codeexp.vex.com."""
    s = run(CODEEXP_TEMPLATE)
    assert not s["errors"] and not s["warnings"]
    assert s["console"].endswith("180\n")
    assert s["signal_tower"]["leds"]["blue"] == "blink"
    assert s["arm"]["tcp"] == [180.0, 0.0, 180.0]
