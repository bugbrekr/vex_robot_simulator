"""The lab-manual programs (Exp 7-10) and examples on their maps, with their device presets."""

import pathlib

import pytest
import yaml

from vexsim.robots.iq2.robot import preset_config
from vexsim.runner.worker import Worker

ROOT = pathlib.Path("backend/vexsim/examples/iq2")
EXAMPLES = {e["id"]: e for e in yaml.safe_load((ROOT / "index.yaml").read_text())}


def run_example(eid, max_time, realistic=False, seed=1):
    ex = EXAMPLES[eid]
    msgs = []
    w = Worker("iq2", ex["map"], (ROOT / ex["file"]).read_text(), max_time=max_time,
               robot_config=preset_config(ex["robot"]), realistic=realistic, seed=seed,
               emit=lambda m: msgs.append(m))
    s = w.run_headless()
    s["warnings"] = [m["text"] for m in msgs if m["type"] == "warning"]
    return s


@pytest.mark.parametrize("eid", list(EXAMPLES))
def test_example_starts_without_errors(eid):
    s = run_example(eid, max_time=8)
    assert not s["errors"], s["errors"]
    # every device the program uses is plugged in by its preset (no "nothing is plugged" warnings)
    assert not [w for w in s["warnings"] if "plugged into" in w], s["warnings"]


def test_exp8_returns_to_start_three_times():
    s = run_example("exp08_line_runner", max_time=120)
    assert s["state"] == "finished"
    _, y, _ = s["robot"]["pose"]
    assert y == pytest.approx(-800, abs=10)
    # clear_screen() keeps the cursor, so the manual's last message lands off to the right
    assert s["screen"][0].strip() == "Task Complete!"


def test_exp9_runs_17_sides_without_touching():
    s = run_example("exp09_five_laps", max_time=200)
    assert s["state"] == "finished"
    assert s["robot"]["contacts"] == []
    x, y, _ = s["robot"]["pose"]
    # 17 sides = 4 laps + 1: it ends on the top-left corner, heading east
    assert x == pytest.approx(-550, abs=60) and y == pytest.approx(550, abs=60)


def test_exp9_realistic_drifts_like_the_lab_robots():
    # straight driving is unguided (even with SmartDrive): some robots finish, others drift
    # into an obstacle after a lap or two, as the user sees in the lab
    results = [run_example("exp09_five_laps", max_time=200, realistic=True, seed=k) for k in (1, 2)]
    assert all(not r["errors"] for r in results)
    assert {r["state"] for r in results} == {"finished", "stopped"}


def test_exp7_stops_at_the_block_in_yellow():
    s = run_example("exp07_sensor_bed", max_time=40)
    assert s["robot"]["touchled"]["color"] == "#ffff00"
    assert s["robot"]["distance"] <= 150


def test_drive_square_returns_home():
    s = run_example("drive_square", max_time=40)
    assert s["state"] == "finished"
    x, y, _ = s["robot"]["pose"]
    assert x == pytest.approx(0, abs=5) and y == pytest.approx(-600, abs=5)


@pytest.mark.parametrize("drive,realistic", [("fwd", False), ("fwd", True), ("rwd", True)])
def test_exp10b_mows_the_yard_in_passes(drive, realistic):
    ex = EXAMPLES["exp10b_lawn_mower_diagram"]
    cfg = preset_config(ex["robot"])
    cfg["drive"] = drive
    w = Worker("iq2", ex["map"], (ROOT / ex["file"]).read_text(), max_time=150, robot_config=cfg,
               realistic=realistic, seed=1)
    s = w.run_headless()
    assert s["state"] == "finished" and not s["errors"]
    assert s["screen"][0].startswith("Yard done")
    assert s["robot"]["contacts"] == []
    assert s["robot"]["pose"][1] < -400  # reached the bottom of the yard (bottom line at -650)


def test_exp10_boundary_following_needs_rear_wheel_drive():
    ex = EXAMPLES["exp10_lawn_mower"]
    for drive, expect in (("rwd", "finished"), ("fwd", "stopped")):
        cfg = preset_config(ex["robot"])
        cfg["drive"] = drive
        s = Worker("iq2", ex["map"], (ROOT / ex["file"]).read_text(), max_time=60, robot_config=cfg,
                   realistic=True, seed=2).run_headless()
        assert s["state"] == expect, drive
