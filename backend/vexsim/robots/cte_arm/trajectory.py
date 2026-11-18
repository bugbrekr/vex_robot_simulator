"""Motion planning for the arm: Cartesian-linear moves with joint-space fallback,
trapezoidal time scaling, joint-speed limiting. Pure functions, no threading."""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from vexsim.core.transforms import rotation_angle, slerp_matrix
from vexsim.robots.cte_arm.kinematics import Kinematics

MAX_SAMPLE_STEP_DEG = 12.0  # joint jump between path samples that indicates a config flip


def trapezoid_duration(distance: float, v_max: float, accel_time: float) -> float:
    if distance <= 1e-9 or v_max <= 0:
        return 0.0
    a = v_max / accel_time
    if v_max * accel_time >= distance:  # triangular profile
        return 2 * math.sqrt(distance / a)
    return distance / v_max + accel_time


def trapezoid_s(t: float, total: float, accel_time: float) -> float:
    """Normalized path parameter s in [0,1] for time t in [0,total]."""
    if total <= 0:
        return 1.0
    t = min(max(t, 0.0), total)
    ta = min(accel_time, total / 2)
    vp = 1.0 / (total - ta)
    if t < ta:
        return 0.5 * vp / ta * t * t
    if t <= total - ta:
        return 0.5 * vp * ta + vp * (t - ta)
    r = total - t
    return 1.0 - 0.5 * vp / ta * r * r


@dataclass
class Trajectory:
    s_grid: np.ndarray  # (N,) path parameter samples 0..1
    q_samples: np.ndarray  # (N, 6)
    duration: float
    accel_time: float
    mode: str  # "linear" | "joint" | "none"

    def q_at(self, t: float) -> np.ndarray:
        s = trapezoid_s(t, self.duration, self.accel_time)
        return np.array([np.interp(s, self.s_grid, self.q_samples[:, i]) for i in range(6)])

    @property
    def q_end(self) -> np.ndarray:
        return self.q_samples[-1].copy()


class Planner:
    def __init__(self, kin: Kinematics):
        self.kin = kin
        self.g = kin.g

    # -------------------------------------------------------------- helpers
    def _retime(self, s_grid, qs, duration, speed_pct) -> float:
        """Stretch duration so no joint exceeds its max speed (scaled by speed %)."""
        ta = self.g.accel_time
        limits = self.g.joint_max_speed * (speed_pct / 100.0)
        if len(s_grid) < 2:
            return duration
        dq_ds = np.max(np.abs(np.diff(qs, axis=0)) / np.diff(s_grid)[:, None], axis=0)
        for _ in range(4):
            if duration <= 0:
                duration = 0.05
            tae = min(ta, duration / 2)
            peak = 1.0 / (duration - tae)
            ratio = float(np.max(dq_ds * peak / limits))
            if ratio <= 1.0 + 1e-6:
                break
            duration *= ratio
        return duration

    def _path_safe(self, qs, tool, pen) -> bool:
        return all(self.kin.config_is_valid(q, tool, pen) for q in qs)

    # -------------------------------------------------------------- planners
    def plan(self, q0, p_goal, r_goal, speed_pct, tool, pen) -> Trajectory | None:
        """Plan from joint config q0 to TCP pose (p_goal, r_goal). None if unreachable."""
        q_goal = self.kin.ik(p_goal, r_goal, near=q0, tool=tool, pen_offset=pen)
        if q_goal is None:
            return None
        traj = self.plan_linear(q0, p_goal, r_goal, speed_pct, tool, pen)
        if traj is None:
            traj = self.plan_joint(q0, q_goal, speed_pct, tool, pen)
        return traj

    def plan_linear(self, q0, p1, r1, speed_pct, tool, pen) -> Trajectory | None:
        f0 = self.kin.fk(q0, tool, pen)
        p0, r0 = f0.tcp, f0.r_ee
        dist = float(np.linalg.norm(np.asarray(p1) - p0))
        ang = rotation_angle(r0, r1)
        pct = speed_pct / 100.0
        ta = self.g.accel_time
        dur = max(
            trapezoid_duration(dist, self.g.max_linear_speed * pct, ta),
            trapezoid_duration(ang, self.g.max_angular_speed * pct, ta),
        )
        if dur == 0:
            return Trajectory(np.array([0.0, 1.0]), np.array([q0, q0]), 0.0, ta, "none")
        n = int(max(8, min(400, math.ceil(max(dist / 2.0, math.degrees(ang) / 2.0)))))
        s_grid = np.linspace(0, 1, n + 1)
        qs = [np.asarray(q0, dtype=float)]
        max_jump = math.radians(MAX_SAMPLE_STEP_DEG)
        for s in s_grid[1:]:
            p = p0 + s * (np.asarray(p1) - p0)
            r = slerp_matrix(r0, r1, s)
            q = self.kin.ik(p, r, near=qs[-1], tool=tool, pen_offset=pen)
            if q is None or np.max(np.abs(q - qs[-1])) > max_jump:
                return None
            qs.append(q)
        q_arr = np.array(qs)
        dur = self._retime(s_grid, q_arr, dur, speed_pct)
        return Trajectory(s_grid, q_arr, dur, ta, "linear")

    def plan_joint(self, q0, q1, speed_pct, tool, pen, check: bool = True) -> Trajectory | None:
        q0, q1 = np.asarray(q0, float), np.asarray(q1, float)
        s_grid = np.linspace(0, 1, 41)
        qs = np.array([q0 + s * (q1 - q0) for s in s_grid])
        if check and not self._path_safe(qs, tool, pen):
            return None
        dur = self._retime(s_grid, qs, 0.05, speed_pct)
        if float(np.max(np.abs(q1 - q0))) < 1e-9:
            dur = 0.0
        return Trajectory(s_grid, qs, dur, self.g.accel_time, "joint")
