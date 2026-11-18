import math

import numpy as np
import pytest

from vexsim.robots.cte_arm.kinematics import (
    PEN,
    Kinematics,
    load_geometry,
    matrix_to_rpy_deg,
    rpy_deg_to_matrix,
)
from vexsim.robots.cte_arm.tile import location_to_xy, xy_to_location

KIN = Kinematics(load_geometry())


def test_tile_locations():
    assert location_to_xy(36) == (200, 200)  # VEX STEM Labs example
    assert location_to_xy(8) == (0, 0)  # arm base / origin
    assert location_to_xy(1) == (-50, -50)
    assert location_to_xy(6) == (-50, 200)
    assert all(xy_to_location(*location_to_xy(n)) == n for n in range(1, 37))


def test_fk_ik_round_trip_random():
    rng = np.random.default_rng(0)
    g = KIN.g
    checked = 0
    for _ in range(3000):
        q = rng.uniform(g.joint_min, g.joint_max)
        f = KIN.fk(q)
        if not KIN.pose_is_safe(f):
            continue
        sol = KIN.ik(f.tcp, f.r_ee, near=q)
        assert sol is not None, np.degrees(q)
        f2 = KIN.fk(sol)
        assert np.linalg.norm(f2.tcp - f.tcp) < 0.5
        assert np.allclose(f2.r_ee, f.r_ee, atol=math.radians(0.1))
        checked += 1
    assert checked > 500


def test_reach_matches_advertised():
    r = rpy_deg_to_matrix(0, 0, 0)
    xs = [x for x in range(250, 360) if KIN.ik((x, 0, 40), r) is not None]
    assert 320 <= max(xs) <= 340  # advertised 335 mm


@pytest.mark.parametrize("p", [(120, 0, 100), (200, 200, 0), (150, -100, 25), (0, 200, 30)])
def test_common_targets_reachable(p):
    assert KIN.ik(p, rpy_deg_to_matrix(0, 0, 0)) is not None


@pytest.mark.parametrize("p", [(0, 0, 50), (400, 0, 50), (150, 0, -15)])
def test_unreachable_targets(p):
    assert KIN.ik(p, rpy_deg_to_matrix(0, 0, 0)) is None


def test_rpy_round_trip():
    for ypr in [(10, 0, 0), (0, 20, 0), (0, 0, -30), (45, 10, 20)]:
        y, r, p = matrix_to_rpy_deg(rpy_deg_to_matrix(*ypr))
        assert np.allclose((y, r, p), ypr, atol=1e-6)


def test_pen_tool_tip_geometry():
    """Pen TCP = marker tip: pen offset along the tool axis + lateral clamp offset (forward)."""
    r = rpy_deg_to_matrix(0, 0, 0)
    q = KIN.ik((150, 0, 50), r)
    magnet_tip = KIN.fk(q).tcp
    pen_tip = KIN.fk(q, PEN, 23).tcp
    g = KIN.g
    assert np.isclose(pen_tip[2] - magnet_tip[2], g.magnet_length - g.pen_holder_length - 23, atol=1e-6)
    assert np.isclose(pen_tip[0] - magnet_tip[0], g.pen_lateral, atol=1e-6)
    # IK puts the configured tip exactly on target
    qp = KIN.ik((150, 0, 0), r, tool=PEN, pen_offset=23)
    assert np.allclose(KIN.fk(qp, PEN, 23).tcp, (150, 0, 0), atol=1e-6)
