"""Teach Pendant commands (Move to Safe Position, Manual Mode drag, jog, Move To, erase)."""

import pathlib

import numpy as np
import pytest

from vexsim.robots.cte_arm.tile import point_on_whiteboard, whiteboard_outline
from vexsim.runner.worker import Worker


@pytest.fixture
def pendant():
    msgs = []
    w = Worker("cte", "cte_tile", None, emit=msgs.append)
    w.msgs = msgs
    w.arm = w.devices["arm"]

    def cmd(**c):
        w._handle(c)

    def settle(seconds=10.0):
        for _ in range(int(seconds / w.engine.dt)):
            w.engine.step()
            if not w.arm.is_moving():
                break

    w.cmd, w.settle = cmd, settle
    return w


def tcp(w):
    return np.round(w.arm.tcp(), 1).tolist()


def test_jog_and_move_to(pendant):
    pendant.cmd(type="jog", mode="xyz", delta=[10, 0, 0])
    pendant.settle()
    assert tcp(pendant) == [130.0, 0.0, 100.0]
    pendant.cmd(type="jog", mode="abs", pos=[200, 100, 60])
    pendant.settle()
    assert tcp(pendant) == [200.0, 100.0, 60.0]


def test_move_to_safe_position(pendant):
    pendant.cmd(type="jog", mode="abs", pos=[200, 100, 60])
    pendant.settle()
    pendant.cmd(type="safe")
    pendant.settle()
    assert tcp(pendant) == [120.0, 0.0, 100.0]


def test_safe_position_blocked_by_control_stop(pendant):
    with pendant.engine.lock:
        pendant.arm.engage_control_stop()
    pendant.cmd(type="safe")
    assert any("controlled stop" in m.get("text", "") for m in pendant.msgs)


def test_manual_mode_drag(pendant):
    pendant.cmd(type="drag", pos=[150, 50, 80])  # ignored: manual mode off
    assert tcp(pendant) == [120.0, 0.0, 100.0]
    pendant.cmd(type="manual", enabled=True)
    pendant.cmd(type="drag", pos=[150, 50, 80])
    assert tcp(pendant) == [150.0, 50.0, 80.0]
    pendant.cmd(type="jog", mode="xyz", delta=[10, 0, 0])  # jogging disabled in manual mode
    pendant.settle()
    assert tcp(pendant) == [150.0, 50.0, 80.0]


def test_manual_drag_clamps_to_reach(pendant):
    pendant.cmd(type="manual", enabled=True)
    pendant.cmd(type="drag", pos=[600, 0, 80])  # far out of reach
    p = pendant.arm.tcp()
    # a limp arm pulled by its tip straightens out: shoulder + arm + forearm + wrist + tool
    assert 300 < p[0] <= 382 and abs(p[1]) < 1


def test_manual_drag_picks_cube(pendant):
    pendant.cmd(type="manual", enabled=True)
    pendant.cmd(type="drag", pos=[100, 50, 40])
    pendant.cmd(type="tool", magnet=True)
    pendant.cmd(type="drag", pos=[100, 50, 25])
    pendant.engine.step()
    assert pendant.arm.magnet.held is not None
    pendant.cmd(type="drag", pos=[180, 0, 60])
    pendant.engine.step()
    assert np.allclose(pendant.arm.magnet.held.position, [180, 0, 47.5], atol=5)


def test_whiteboard_shape():
    assert point_on_whiteboard(150, 150)
    assert not point_on_whiteboard(0, 0)  # arm base cut-out
    assert not point_on_whiteboard(-50, 200)  # signal tower notch
    assert len(whiteboard_outline()) > 8


def test_whiteboard_drawing_and_erase(run):
    code = pathlib.Path("backend/vexsim/examples/cte/whiteboard_shapes.py").read_text()
    s = run(code, scenario="whiteboard", tool="pen")
    arm = s["worker"].devices["arm"]
    assert len(arm.pen.strokes) == 4  # 3 triangle sides + circle
    assert s["worker"].scene["tile"]["surface"] == "whiteboard"
    s["worker"]._handle({"type": "erase"})
    assert arm.pen.strokes == []
