import pathlib

from tests.conftest import HEADER


def test_pick_and_stack(run):
    s = run(pathlib.Path("backend/vexsim/examples/cte/pick_place.py").read_text(), scenario="cte_tile")
    pos = {o["id"]: o["pos"] for o in s["objects"]}
    assert pos["cube_1"] == [200.0, 50.0, 12.5]
    assert pos["cube_2"] == [200.0, 50.0, 37.5]
    assert pos["cube_3"] == [200.0, 50.0, 62.5]
    assert s["signal_tower"]["leds"]["green"] == "on"


def test_magnet_needs_contact(run):
    s = run(HEADER + "arm.move_to(100, 50, 60)\narm.set_end_effector_magnet(True)\n"
            "arm.move_inc(0, 0, 20)", scenario="cte_tile")
    assert s["arm"]["holding"] is None


def test_magnet_off_drops_to_tile(run):
    s = run(HEADER + "arm.move_to(100, 50, 25)\narm.set_end_effector_magnet(True)\n"
            "arm.move_to(150, -50, 80)\narm.set_end_effector_magnet(False)",
            scenario="cte_tile")
    pos = {o["id"]: o["pos"] for o in s["objects"]}
    assert pos["cube_1"] == [150.0, -50.0, 12.5]


def test_crash_into_cube(run):
    s = run(HEADER + "print(arm.move_to(100, 50, 5))\nprint(arm.is_crashed())",
            scenario="cte_tile")
    assert s["console"].splitlines() == ["False", "True"]


def test_pen_draws_square(run):
    s = run(pathlib.Path("backend/vexsim/examples/cte/draw_square.py").read_text(), scenario="whiteboard",
            tool="pen")
    strokes = s["worker"].devices["arm"].pen.strokes
    assert len(strokes) == 1
    xs = [p[0] for p in strokes[0]]
    ys = [p[1] for p in strokes[0]]
    assert min(xs) == 130 and max(xs) == 210 and min(ys) == 0 and max(ys) == 80


def test_pen_only_marks_the_whiteboard(run):
    code = pathlib.Path("backend/vexsim/examples/cte/draw_square.py").read_text()
    s = run(code, scenario="cte_tile", tool="pen")  # bare tile: no ink
    assert s["worker"].devices["arm"].pen.strokes == []
    # on the whiteboard map, a path through the Signal Tower notch leaves a gap
    s = run(HEADER + "arm.set_end_effector_type(Arm.PEN)\n"
                     "arm.move_to(-40, 140, 10)\narm.move_to(-40, 140, 0)\narm.move_to(-40, 200, 0)\n"
                     "arm.move_to(-5, 200, 0)\n",
            scenario="whiteboard", tool="pen")
    strokes = s["worker"].devices["arm"].pen.strokes
    assert len(strokes) == 2  # ink stops over the notch and resumes on the sheet
    assert max(p[1] for p in strokes[0]) <= 175.5


def test_map_does_not_choose_the_tool():
    from vexsim.runner.worker import Worker

    assert Worker("cte", "whiteboard", None).devices["arm"].mounted_tool == "magnet"
    w = Worker("cte", "cte_tile", None, mounted_tool="pen", marker_protrusion=25)
    assert w.devices["arm"].mounted_tool == "pen" and w.devices["arm"].marker_protrusion == 25
