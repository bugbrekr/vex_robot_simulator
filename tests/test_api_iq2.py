"""VEX IQ (2nd gen) API against the simulated robot (ideal sensors: exact, repeatable)."""

import math

import pytest

from vexsim.robots.iq2.robot import default_config, preset_config
from vexsim.runner.worker import Worker

HEAD = """from vex import *
brain = Brain()
brain_inertial = Inertial()
left = Motor(Ports.PORT6, False)
right = Motor(Ports.PORT1, True)
"""
SMART = HEAD + "dt = SmartDrive(left, right, brain_inertial, 200, 173, 76, MM, 1)\n"
PLAIN = HEAD + "dt = DriveTrain(left, right, 200, 173, 76, MM, 1)\n"


def run(code, scenario="blank", config=None, max_time=60.0, realistic=False, before=None):
    msgs = []
    w = Worker("iq2", scenario, code, max_time=max_time, robot_config=config, realistic=realistic,
               emit=lambda m: msgs.append(m))
    if before:
        before(w)
    s = w.run_headless()
    s["warnings"] = [m["text"] for m in msgs if m["type"] == "warning"]
    s["worker"] = w
    return s


def pose(s):
    return s["robot"]["pose"]


def test_drive_for_distance_and_encoders():
    s = run(SMART + "dt.drive_for(FORWARD, 500, MM)\nprint(left.position(DEGREES), right.position(DEGREES))\n")
    assert s["state"] == "finished" and not s["errors"]
    x, y, _ = pose(s)
    assert y == pytest.approx(-100, abs=1.5)  # blank map starts at (0, -600) facing +y
    assert x == pytest.approx(0, abs=1)
    l_deg, r_deg = map(float, s["console"].split())
    assert l_deg == pytest.approx(900, abs=2) and r_deg == pytest.approx(900, abs=2)


def test_default_units_are_inches():
    s = run(PLAIN + "dt.drive_for(FORWARD, 10)\n")
    assert pose(s)[1] == pytest.approx(-600 + 254, abs=2)


def test_gyro_turn_is_accurate():
    s = run(SMART + "dt.turn_for(RIGHT, 90, DEGREES)\nprint(brain_inertial.heading())\n")
    assert float(s["console"]) == pytest.approx(90, abs=0.2)
    assert pose(s)[2] == pytest.approx(0, abs=0.3)  # facing +x after a right turn from +y


def test_encoder_turn_uses_configured_track_width():
    # DriveTrain with the true 173 mm track turns 90; a wrong track width turns by the ratio
    s = run(PLAIN + "dt.turn_for(LEFT, 90, DEGREES)\n")
    assert pose(s)[2] == pytest.approx(180, abs=0.5)
    s = run(HEAD + "dt = DriveTrain(left, right, 200, 346, 76, MM, 1)\ndt.turn_for(LEFT, 90, DEGREES)\n")
    assert pose(s)[2] == pytest.approx(270, abs=1)


def test_unreversed_right_motor_spins_in_place():
    code = HEAD.replace("Motor(Ports.PORT1, True)", "Motor(Ports.PORT1, False)")
    s = run(code + "left.spin(FORWARD, 50, PERCENT)\nright.spin(FORWARD, 50, PERCENT)\nwait(1, SECONDS)\n")
    x, y, _ = pose(s)
    assert math.hypot(x, y + 600) < 5  # turned on the spot instead of driving
    assert s["robot"]["heading"] > 100


def test_spin_for_and_stop_modes():
    s = run(HEAD + "left.spin_for(FORWARD, 2, TURNS, 100, PERCENT)\nprint(left.position(TURNS))\n"
                   "left.set_position(0, DEGREES)\nleft.spin_to_position(-90, DEGREES)\n"
                   "print(left.position(DEGREES), left.is_done())\n")
    first, second = s["console"].strip().splitlines()
    assert float(first) == pytest.approx(2.0, abs=0.01)
    deg, done = second.split()
    assert float(deg) == pytest.approx(-90, abs=1) and done == "True"


def test_motor_on_empty_port_warns_and_does_nothing():
    s = run("from vex import *\nm = Motor(Ports.PORT9)\nm.spin(FORWARD)\nwait(200, MSEC)\nprint(m.installed())\n")
    assert s["console"].strip() == "False"
    assert any("PORT9" in w for w in s["warnings"])


def test_port_config_rebinds_devices():
    cfg = default_config()
    cfg["left_motor"]["port"] = 2
    s = run("from vex import *\nm = Motor(Ports.PORT2)\nm.spin_for(FORWARD, 360, DEGREES)\n", config=cfg)
    assert s["robot"]["motors"]["left_motor"]["pos"] == pytest.approx(360, abs=1)


def test_distance_sensor_sees_obstacle():
    code = SMART + "d = Distance(Ports.PORT5)\nprint(d.object_distance(MM), d.is_object_detected(), d.object_size())\n"
    s = run(code, scenario="five_laps")  # starts 1424 mm short of the top obstacle's face
    dist, detected, size = s["console"].split()
    assert float(dist) == pytest.approx(824 - (-550) - 74, abs=2)
    assert detected == "False"  # "found" only within ~1000 mm
    assert size == "NONE"


def test_distance_sees_the_wall_and_units():
    code = "from vex import *\nd = Distance(Ports.PORT5)\nprint(d.object_distance(MM), d.object_distance(INCHES))\n"
    mm, inch = map(float, run(code)["console"].split())
    assert mm == pytest.approx(1200 - (-600) - 74, abs=1)  # the blank map's north wall
    assert inch == pytest.approx(mm / 25.4, abs=0.01)
    # without walls nothing is in range: 9999 mm
    open_floor = {"name": "open", "floor": {"size": [2400, 2400]}, "walls": False, "start": {"x": 0, "y": 0, "yaw": 90}}
    s = run(code, scenario=open_floor)
    assert float(s["console"].split()[0]) == 9999


def test_optical_brightness_white_black_and_led():
    code = ("from vex import *\no = Optical(Ports.PORT3)\nprint(o.brightness())\n"
            "o.set_light(LedStateType.ON)\no.set_light_power(100, PERCENT)\nwait(20, MSEC)\nprint(o.brightness(), o.color())\n")
    s = run(code)
    off, rest = s["console"].strip().splitlines()
    on, color = rest.split()
    assert float(off) < 40  # white floor needs the LED for the manual's thresholds
    assert float(on) > 80
    assert color == "Color.WHITE"
    # on a black line
    s = run(code, scenario="sensor_bed", before=lambda w: w.devices["robot"].place(0, -50, math.pi / 2))
    on_line = float(s["console"].strip().splitlines()[1].split()[0])
    assert on_line < 40


def test_bumper_and_touchled_presses_and_events():
    code = ("from vex import *\nb = Bumper(Ports.PORT11)\nt = Touchled(Ports.PORT4)\n"
            "def hit():\n    print('pressed')\n"
            "t.pressed(hit)\n"
            "wait(300, MSEC)\nprint(b.pressing(), t.pressing())\n"
            "t.set_color(Color.RED)\n")

    def schedule(w):
        r = w.devices["robot"]

        def press():
            r.bumper_ui = True
            r.touchled.ui_pressed = True
        w.engine.schedule(0.1, press)

    w = Worker("iq2", "blank", code, max_time=2, realistic=False)
    orig = w.start_program

    def start(code=None):
        orig(code)
        schedule(w)
    w.start_program = start
    s = w.run_headless()
    assert "pressed" in s["console"] and "1 1" in s["console"]
    assert s["robot"]["touchled"]["color"] == "#ff0000"


def test_bumper_presses_on_contact():
    code = SMART + "b = Bumper(Ports.PORT11)\ndt.drive(FORWARD)\nwhile not b.pressing():\n    wait(10, MSEC)\ndt.stop()\nprint('bump')\n"
    s = run(code, scenario="five_laps", max_time=20)
    assert "bump" in s["console"]
    assert s["robot"]["contacts"] == ["obstacle_top"]


def test_screen_print_cursor_and_clear():
    code = ("from vex import *\nbrain = Brain()\nbrain.screen.print('Hello', 3.14159)\nbrain.screen.next_row()\n"
            "brain.screen.print(42)\nbrain.screen.clear_screen()\nbrain.screen.print('X')\n")
    s = run(code)
    # clear_screen keeps the cursor (row 2, after "42"): text continues there
    assert s["screen"] == ["", "  X"]


def test_screen_set_cursor_rows():
    code = "from vex import *\nbrain = Brain()\nbrain.screen.set_cursor(3, 2)\nbrain.screen.print('ok')\n"
    assert run(code)["screen"] == ["", "", " ok"]


def test_inertial_calibrate_and_rotation():
    code = (SMART + "brain_inertial.calibrate()\nprint(brain_inertial.is_calibrating())\n"
            "while brain_inertial.is_calibrating():\n    wait(25, MSEC)\n"
            "dt.turn_for(LEFT, 450, DEGREES)\nprint(brain_inertial.rotation(), brain_inertial.heading())\n")
    s = run(code)
    first, second = s["console"].strip().splitlines()
    assert first == "True"
    rot, head = map(float, second.split())
    assert rot == pytest.approx(-450, abs=0.3) and head == pytest.approx(270, abs=0.3)


def test_lab_style_constructors_and_urandom():
    code = ("from vex import *\nimport urandom\nbrain = Brain()\ni = Inertial()\n"
            "l = Motor(Ports.PORT6, 1.0, False)\nr = Motor(Ports.PORT1, GearSetting.RATIO_1_1, True)\n"
            "dt = SmartDrive(l, r, i, 200, MM)\n"
            "urandom.seed(int(i.acceleration(XAXIS) * 1000 + brain.timer.system() * 100))\n"
            "sleep(100, MSEC)\nprint(brain.timer.system() >= 100, urandom.randint(1, 1))\n")
    s = run(code)
    assert not s["errors"] and s["console"].strip() == "True 1"


def test_realistic_mode_is_seeded():
    code = SMART + "d = Distance(Ports.PORT5)\nprint(d.object_distance(MM))\n"
    a = Worker("iq2", "five_laps", code, realistic=True, seed=7).run_headless()["console"]
    b = Worker("iq2", "five_laps", code, realistic=True, seed=7).run_headless()["console"]
    assert a == b


def test_preset_config_turns_unlisted_devices_off():
    cfg = preset_config({"left_motor": {"port": 6}, "right_motor": {"port": 1}, "optical": {"port": 7}})
    assert cfg["optical"] == {"port": 7, "enabled": True}
    assert not cfg["distance"]["enabled"] and not cfg["bumper"]["enabled"]


def test_every_map_has_walls_that_stop_a_runaway_robot():
    s = run(PLAIN + "dt.drive(FORWARD, 100, PERCENT)\nwait(20, SECONDS)\n", max_time=25)
    assert s["robot"]["contacts"] == ["wall_n"]
    assert s["robot"]["pose"][1] == pytest.approx(1200 - 85, abs=3)  # bumper face against the wall
    assert not s["errors"]


def test_rwd_turns_about_the_rear_axle_and_keeps_the_chassis_on_the_start():
    from vexsim.robots.iq2.robot import load_geometry

    wb = load_geometry()["drive"]["wheel_base"]
    spin = (HEAD + "left.spin_for(FORWARD, 450, DEGREES, wait=False)\nright.spin_for(REVERSE, 450, DEGREES)\n")
    fwd = run(spin)
    cfg = default_config()
    cfg["drive"] = "rwd"
    rwd = run(spin, config=cfg)
    assert rwd["robot"]["config"]["drive"] == "rwd"
    # same chassis start: the RWD pose (rear axle) is one wheelbase behind the FWD one
    assert rwd["robot"]["pose"][1] == pytest.approx(fwd["robot"]["pose"][1] - wb, abs=0.5)
    # same wheel motion turns both robots by the same angle, each about its driven axle
    assert rwd["robot"]["pose"][2] == pytest.approx(fwd["robot"]["pose"][2], abs=0.5)
    w = rwd["worker"].devices["robot"]
    fx, fy = fwd["worker"].devices["robot"].chassis_to_world(50, 0)
    rx, ry = w.chassis_to_world(50, 0)
    assert math.hypot(rx - fx, ry - fy) > 100  # the optical spot swung on a wider arc


def test_switching_drive_layout_keeps_the_chassis_in_place():
    w = Worker("iq2", "blank", None, realistic=False)
    r = w.devices["robot"]
    before = r.footprint()
    cfg = default_config()
    cfg["drive"] = "rwd"
    r.set_config(cfg)
    assert r.drive == "rwd"
    for (ax, ay), (bx, by) in zip(before, r.footprint(), strict=True):
        assert ax == pytest.approx(bx, abs=1e-6) and ay == pytest.approx(by, abs=1e-6)
