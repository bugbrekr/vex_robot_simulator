"""Persistent scene: state survives runs/stops/mode changes; homing; gating; cubes; sag."""

import numpy as np
import pytest

from vexsim.runner.worker import Worker

H = "from vex import *\nbrain = Brain()\narm = Arm()\n"


@pytest.fixture
def w():
    msgs = []
    wk = Worker("cte", "cte_tile", None, emit=msgs.append, interactive=True)
    wk.msgs = msgs
    wk.arm = wk.devices["arm"]
    wk.world = wk.devices["world"]
    wk.speed = 0.0
    return wk


def run_program(wk, code, limit=200.0):
    wk.start_program(code)
    t0 = wk.engine.t
    wk.engine.run_loop(
        should_continue=lambda: wk.state == "running" and wk.engine.t - t0 < limit,
        speed=lambda: 0.0,
        all_blocked=lambda: wk.rt.all_blocked(),
        on_step=wk._on_step,
    )
    wk._flush_console()
    return "".join(m["text"] for m in wk.msgs if m["type"] == "console")


def steps(wk, seconds):
    for _ in range(int(seconds / wk.engine.dt)):
        wk.engine.step()
        wk._on_step()


def warnings(wk):
    return [m["text"] for m in wk.msgs if m["type"] == "warning"]


def test_state_persists_between_runs(w):
    run_program(w, H + "arm.move_to(100, 50, 25)\narm.set_end_effector_magnet(True)\n"
                       "arm.move_to(200, -50, 60)\narm.set_end_effector_magnet(False)\n")
    moved = {o.id: o.position.copy() for o in w.world.objects.values()}
    assert np.allclose(moved["cube_1"], [200, -50, 12.5])
    out = run_program(w, H + "print(arm.get_x(), arm.get_y(), arm.get_z())\n")
    # second run: cube is still where the first run left it, arm homed to safe first
    assert np.allclose(w.world.objects["cube_1"].position, [200, -50, 12.5])
    assert out.strip().endswith("120.0 0.0 100.0")


def test_run_homes_arm_first(w):
    w._handle({"type": "jog", "mode": "abs", "pos": [220, 120, 40]})
    steps(w, 5)
    assert not w.arm.at_safe_position()
    out = run_program(w, H + "print(arm.get_x(), arm.get_y(), arm.get_z())\n")
    assert out.strip() == "120.0 0.0 100.0"


def test_stop_keeps_pose(w):
    w.start_program(H + "arm.move_to(250, 0, 60)\n")
    steps(w, 1.0)
    w._handle({"type": "stop"})
    pose = w.arm.tcp().copy()
    steps(w, 1.0)
    assert w.state == "stopped" and np.allclose(w.arm.tcp(), pose)
    assert pose[0] > 125  # it had started moving and stayed there


def test_manual_mode_requires_safe_position(w):
    w._handle({"type": "jog", "mode": "xyz", "delta": [30, 0, 0]})
    steps(w, 3)
    w._handle({"type": "manual", "enabled": True})
    assert not w.arm.manual_mode
    assert any("Safe Position" in t for t in warnings(w))
    w._handle({"type": "safe"})
    steps(w, 5)
    w._handle({"type": "manual", "enabled": True})
    assert w.arm.manual_mode


def test_end_effector_swap_requires_safe_position(w):
    w._handle({"type": "jog", "mode": "xyz", "delta": [30, 0, 0]})
    steps(w, 3)
    w._handle({"type": "tool", "tool": "pen"})
    assert w.arm.mounted_tool == "magnet"
    w._handle({"type": "safe"})
    steps(w, 5)
    w._handle({"type": "tool", "tool": "pen", "pen_offset": 23})
    steps(w, 5)
    assert w.arm.mounted_tool == "pen" and w.arm.tool == "pen"
    assert np.allclose(w.arm.tcp(), [120, 0, 100], atol=1)  # re-homed with the pen TCP


def test_manual_mode_slumps_slowly_and_settles(w):
    """Real-arm behaviour: the drives power down, the links sink slowly (overdamped, no
    toppling): J2 leans further back, the elbow folds to its mechanical stop, and the arm
    settles on its joint stops with the tool hanging in the air."""
    f0 = w.arm.physical_fk()
    q0 = w.arm.q.copy()
    w._handle({"type": "manual", "enabled": True})
    steps(w, 0.5)
    assert f0.tcp[2] - w.arm.physical_fk().tcp[2] < 20  # slow start
    steps(w, 11.5)
    f = w.arm.physical_fk()
    assert w.arm.q[1] < q0[1] - np.radians(30)  # J2 leaned back
    assert f.elbow[2] < f0.elbow[2] - 60  # the upper links came down
    assert np.degrees(w.arm.q[2]) <= 80.01  # elbow stopped short of the shoulder housing
    assert f.tcp[2] > 5  # tool hangs in the air
    q = w.arm.q.copy()
    steps(w, 1)
    assert np.allclose(q, w.arm.q, atol=np.radians(0.5))  # settled


def test_program_resets_project_defaults_and_warns_tool_mismatch(w):
    w._handle({"type": "tool", "tool": "pen", "pen_offset": 23})
    steps(w, 5)
    run_program(w, H + "arm.move_inc(0, 0, 10)\n")
    assert w.arm.tool == "magnet"  # VEX default at project start
    assert any("Pen Holder Tool is mounted" in t for t in warnings(w))


def test_cube_add_move_drop_delete(w):
    n0 = len(w.world.objects)
    w._handle({"type": "add_object", "kind": "cube", "x": 200, "y": 150})
    steps(w, 0.3)
    assert len(w.world.objects) == n0 + 1
    new = [o for o in w.world.objects.values() if o.id not in ("cube_1", "cube_2", "cube_3")][0]
    assert new.tag_id == 23 and np.allclose(new.position, [200, 150, 12.5])
    # drag cube_2 onto the new cube -> stacks
    w._handle({"type": "grab_object", "id": "cube_2"})
    w._handle({"type": "move_object", "id": "cube_2", "pos": [200, 150, 60]})
    w._handle({"type": "drop_object", "id": "cube_2", "x": 200, "y": 150})
    assert w.world.objects["cube_2"].position[2] > 37.5  # released in the air...
    steps(w, 0.3)
    assert np.allclose(w.world.objects["cube_2"].position, [200, 150, 37.5])  # ...and landed
    # remove the bottom one -> top one falls
    w._handle({"type": "remove_object", "id": new.id})
    steps(w, 0.3)
    assert np.allclose(w.world.objects["cube_2"].position, [200, 150, 12.5])
    # dropping outside the tile deletes
    w._handle({"type": "grab_object", "id": "cube_1"})
    w._handle({"type": "drop_object", "id": "cube_1", "x": 600, "y": 0})
    assert "cube_1" not in w.world.objects
    w._handle({"type": "clear_objects"})
    assert not w.world.objects


def test_cubes_can_be_moved_while_running(w):
    w.start_program(H + "wait(5, SECONDS)\n")
    steps(w, 0.5)
    w._handle({"type": "add_object", "kind": "cube", "x": 150, "y": -50})
    assert any(np.allclose(o.position, [150, -50, 12.5]) for o in w.world.objects.values())


def test_grabbing_held_cube_detaches_it(w):
    run_program(w, H + "arm.move_to(100, 50, 25)\narm.set_end_effector_magnet(True)\n"
                       "arm.move_inc(0, 0, 40)\n")
    assert w.arm.magnet.held is not None
    w._handle({"type": "grab_object", "id": "cube_1"})
    assert w.arm.magnet.held is None


def test_time_sleep_uses_sim_time(w):
    out = run_program(w, H + "import time\nt = brain.timer_time()\ntime.sleep(2)\n"
                             "print(brain.timer_time() - t)\n")
    assert out.strip() == "2000"


def test_cube_falls_with_gravity(w):
    w._handle({"type": "add_object", "kind": "cube", "x": 200, "y": 150, "z": 100})
    cube = [o for o in w.world.objects.values() if o.id not in ("cube_1", "cube_2", "cube_3")][0]
    z0 = cube.position[2]
    steps(w, 0.05)
    z1 = cube.position[2]
    assert abs((z0 - z1) - 0.5 * 9810 * 0.05 ** 2) < 3  # free fall: ~12 mm after 50 ms
    steps(w, 0.3)
    assert np.isclose(cube.position[2], 12.5)


def test_manual_drag_upright_keeps_tool_vertical(w):
    w._handle({"type": "tool", "tool": "pen", "pen_offset": 23})
    steps(w, 5)
    w._handle({"type": "manual", "enabled": True})
    steps(w, 4)  # it slumps
    w._handle({"type": "drag", "pos": [160, 40, 5], "upright": True})
    f = w.arm.physical_fk()
    assert f.r_ee[2, 2] > 0.999  # marker perpendicular to the board
    assert np.allclose(f.tcp, [160, 40, 5], atol=0.5)
    w._handle({"type": "drag", "pos": [160, 40, 0], "upright": True})
    steps(w, 0.05)
    assert w.arm.pen.strokes == []  # bare CTE Tile takes no ink


# ------------------------------------------------------------------ arm <-> cube contact
def _cube_at(w, x, y):
    return next(o for o in w.world.objects.values() if np.allclose(o.position[:2], [x, y]))


@pytest.mark.parametrize("upright", [True, False])
def test_manual_drag_rests_tool_on_top_of_cube(w, upright):
    """cube_1 sits on location 21 (100, 50): pushing the tool down onto it stops at its top."""
    w._handle({"type": "manual", "enabled": True})
    w._handle({"type": "drag", "pos": [100, 50, 60], "upright": upright})
    w._handle({"type": "drag", "pos": [100, 50, 0], "upright": upright})  # push through the cube
    tip = w.arm.physical_fk().tcp
    assert tip[2] >= 25 - 0.5, tip  # resting on the top face, not inside
    assert abs(tip[0] - 100) < 3 and abs(tip[1] - 50) < 3
    assert np.allclose(_cube_at(w, 100, 50).position, [100, 50, 12.5])  # cube undisturbed


def test_released_arm_settles_on_cube_not_through_it(w):
    w._handle({"type": "manual", "enabled": True})
    w._handle({"type": "drag", "pos": [100, 50, 26], "upright": True})
    w._handle({"type": "drag_end"})
    steps(w, 6)
    f = w.arm.physical_fk()
    pts, rad = w.arm._body_points(f)
    for o in w.world.objects.values():
        d = np.abs(pts - o.position) - o.half_height
        sd = np.linalg.norm(np.maximum(d, 0), axis=1) + np.minimum(d.max(axis=1), 0)
        assert np.all(sd >= rad - 0.5), o.id


def test_manual_drag_cannot_sweep_through_cube(w):
    w._handle({"type": "manual", "enabled": True})
    w._handle({"type": "drag", "pos": [100, 0, 12], "upright": True})  # beside cube_1, low
    w._handle({"type": "drag", "pos": [100, 100, 12], "upright": True})  # straight through it
    tip = w.arm.physical_fk().tcp
    assert tip[1] < 50 - 12.5, tip  # stopped at the cube's side
