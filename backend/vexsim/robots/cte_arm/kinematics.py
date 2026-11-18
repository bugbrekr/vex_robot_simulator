"""Forward / inverse kinematics for the VEX CTE 6-Axis Arm.

Joint model (all angles radians internally, zero pose = upper arm vertical, forearm + tool
pointing forward along +x):

    R03   = Rz(q1) @ Ry(q2 + q3)
    S     = Rz(q1) @ [a, 0, h]                         shoulder (J2) axis point
    E     = S + Rz(q1) @ Ry(q2) @ [0, 0, L2]           elbow (J3)
    W     = E + R03 @ [Lf, 0, d]                       wrist centre (J5)
    Rtool = R03 @ Rx(q4) @ Ry(q5) @ Rx(q6)             tool axis = local +x
    TCP   = W + Rtool @ [wrist_to_flange + tool_len, 0, 0]

End-effector orientation reported to students (yaw, roll, pitch) uses
R_ee = Rz(yaw) Ry(pitch) Rx(roll) where the *tool points along -z of R_ee*.  So yaw=roll=pitch=0
is "tool pointing straight down, facing +x".  R_ee = Rtool @ Ry(-90deg).
(The real VEX sign conventions are unverified - see docs/specs/cte_hardware.md.)
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from vexsim.core.config import load_package_yaml
from vexsim.core.transforms import matrix_to_rpy, rpy_to_matrix, rx, ry, rz

TOOL_TO_EE = ry(-math.pi / 2)  # R_ee = R_tool @ TOOL_TO_EE
EE_TO_TOOL = TOOL_TO_EE.T

MAGNET = "magnet"
PEN = "pen"


@dataclass
class ArmGeometry:
    shoulder_height: float
    shoulder_forward: float
    upper_arm: float
    forearm: float
    forearm_offset: float
    wrist_to_flange: float
    magnet_length: float
    pen_lateral: float
    marker_protrusion: float
    pen_holder_length: float
    joint_min: np.ndarray  # radians
    joint_max: np.ndarray
    joint_max_speed: np.ndarray  # rad/s at 100 %
    max_linear_speed: float
    max_angular_speed: float  # rad/s
    accel_time: float
    default_speed: int
    position_tolerance: float
    floor_z: float
    floor_margin: float
    link_floor_margin: float
    keepout: list[tuple[float, float]]
    start_position: tuple[float, float, float]
    start_orientation: tuple[float, float, float]  # yaw, roll, pitch (deg)
    raw: dict = field(default_factory=dict, repr=False)

    @property
    def forearm_len(self) -> float:
        return math.hypot(self.forearm, self.forearm_offset)

    @property
    def forearm_angle(self) -> float:
        return math.atan2(self.forearm_offset, self.forearm)

    def tool_vector(self, tool: str, pen_offset: float = 0.0) -> np.ndarray:
        """Tool tip relative to the J5 wrist centre, in the tool frame (tool axis = +x).

        Magnet: contact face of the electromagnet. Pen: marker tip (lateral offset from the
        clamp; the PEN type's built-in holder length + pen offset along the tool axis). Tool-frame +z maps to end-effector +x."""
        if tool == PEN:
            return np.array([self.wrist_to_flange + self.pen_holder_length + pen_offset, 0.0,
                             self.pen_lateral])
        return np.array([self.wrist_to_flange + self.magnet_length, 0.0, 0.0])

    @classmethod
    def from_dict(cls, d: dict) -> ArmGeometry:
        joints = d["joints"]
        mo, ws = d["motion"], d["workspace"]
        return cls(
            shoulder_height=d["base"]["shoulder_height"],
            shoulder_forward=d["base"]["shoulder_forward"],
            upper_arm=d["links"]["upper_arm"],
            forearm=d["links"]["forearm"],
            forearm_offset=d["links"]["forearm_offset"],
            wrist_to_flange=d["links"]["wrist_to_flange"],
            magnet_length=d["tools"]["magnet"]["length"],
            pen_lateral=d["tools"]["pen"]["lateral_offset"],
            marker_protrusion=d["tools"]["pen"]["marker_protrusion"],
            pen_holder_length=d["tools"]["pen"].get("holder_length", 0.0),
            joint_min=np.radians([j["min"] for j in joints]),
            joint_max=np.radians([j["max"] for j in joints]),
            joint_max_speed=np.radians([j["max_speed"] for j in joints]),
            max_linear_speed=mo["max_linear_speed"],
            max_angular_speed=math.radians(mo["max_angular_speed"]),
            accel_time=mo["accel_time"],
            default_speed=mo["default_speed"],
            position_tolerance=mo["position_tolerance"],
            floor_z=ws["floor_z"],
            floor_margin=ws["floor_margin"],
            link_floor_margin=ws["link_floor_margin"],
            keepout=[(k["radius"], k["height"]) for k in ws["keepout"]],
            start_position=tuple(d["start_position"]),
            start_orientation=tuple(d["start_orientation"]),
            raw=d,
        )


def load_geometry() -> ArmGeometry:
    return ArmGeometry.from_dict(load_package_yaml("robots/cte_arm/geometry.yaml"))


@dataclass
class FKResult:
    tcp: np.ndarray
    r_tool: np.ndarray
    shoulder: np.ndarray
    elbow: np.ndarray
    wrist: np.ndarray
    frames: list[tuple[np.ndarray, np.ndarray]]  # (position, rotation) per link frame

    @property
    def r_ee(self) -> np.ndarray:
        return self.r_tool @ TOOL_TO_EE


class Kinematics:
    def __init__(self, geom: ArmGeometry):
        self.g = geom

    # ------------------------------------------------------------------ FK
    def fk(self, q, tool: str = MAGNET, pen_offset: float = 0.0) -> FKResult:
        g = self.g
        q1, q2, q3, q4, q5, q6 = q
        r1 = rz(q1)
        shoulder = r1 @ np.array([g.shoulder_forward, 0.0, g.shoulder_height])
        r2 = r1 @ ry(q2)
        elbow = shoulder + r2 @ np.array([0.0, 0.0, g.upper_arm])
        r3 = r1 @ ry(q2 + q3)
        wrist = elbow + r3 @ np.array([g.forearm, 0.0, g.forearm_offset])
        r4 = r3 @ rx(q4)
        r5 = r4 @ ry(q5)
        r6 = r5 @ rx(q6)
        flange = wrist + r6 @ np.array([g.wrist_to_flange, 0.0, 0.0])
        tcp = wrist + r6 @ g.tool_vector(tool, pen_offset)
        frames = [
            (np.zeros(3), r1),  # J1 turret
            (shoulder, r2),  # upper arm (J2)
            (elbow, r3),  # forearm (J3)
            (wrist, r4),  # wrist roll (J4) - located at wrist centre for display
            (wrist, r5),  # wrist pitch (J5)
            (flange, r6),  # tool flange (J6)
        ]
        return FKResult(tcp, r6, shoulder, elbow, wrist, frames)

    def pose(self, q, tool=MAGNET, pen_offset=0.0) -> tuple[np.ndarray, np.ndarray]:
        f = self.fk(q, tool, pen_offset)
        return f.tcp, f.r_ee

    # ------------------------------------------------------------------ IK
    def ik_all(self, p, r_ee, tool=MAGNET, pen_offset=0.0) -> list[np.ndarray]:
        """All analytic IK solutions (unfiltered by limits) for TCP position p, orientation r_ee."""
        g = self.g
        p = np.asarray(p, dtype=float)
        r_tool = r_ee @ EE_TO_TOOL
        w = p - r_tool @ g.tool_vector(tool, pen_offset)
        rxy = math.hypot(w[0], w[1])
        sols: list[np.ndarray] = []
        base_angle = math.atan2(w[1], w[0]) if rxy > 1e-9 else 0.0
        lf, delta, l2 = g.forearm_len, g.forearm_angle, g.upper_arm
        for q1, r_signed in ((base_angle, rxy), (base_angle + math.pi, -rxy)):
            u = r_signed - g.shoulder_forward
            v = w[2] - g.shoulder_height
            c = (u * u + v * v - l2 * l2 - lf * lf) / (2 * l2 * lf)
            if c < -1 - 1e-9 or c > 1 + 1e-9:
                continue
            c = max(-1.0, min(1.0, c))
            for sgn in (1.0, -1.0):
                gamma = sgn * math.acos(c)
                alpha = math.atan2(v, u) - math.atan2(lf * math.sin(gamma), l2 + lf * math.cos(gamma))
                beta = alpha + gamma
                q2 = math.pi / 2 - alpha
                phi = delta - beta
                q3 = phi - q2
                r03 = rz(q1) @ ry(phi)
                rw = r03.T @ r_tool  # = Rx(q4) Ry(q5) Rx(q6)
                cb = max(-1.0, min(1.0, rw[0, 0]))
                b = math.acos(cb)
                if math.sin(b) < 1e-6:  # wrist singular: q4 and q6 coaxial
                    total = math.atan2(rw[2, 1], rw[1, 1])
                    wrist_opts = [(0.0, b, total)]
                else:
                    a = math.atan2(rw[1, 0], -rw[2, 0])
                    cc = math.atan2(rw[0, 1], rw[0, 2])
                    wrist_opts = [(a, b, cc), (a + math.pi, -b, cc + math.pi)]
                for q4, q5, q6 in wrist_opts:
                    sols.append(np.array([q1, q2, q3, q4, q5, q6], dtype=float))
        return sols

    def _normalize_to_limits(self, q: np.ndarray, near: np.ndarray | None) -> np.ndarray | None:
        """Shift each joint by +-2pi to fit limits (choosing closest to `near`); None if impossible."""
        out = np.empty(6)
        for i in range(6):
            cands = [q[i] + k * 2 * math.pi for k in (-2, -1, 0, 1, 2)]
            cands = [x for x in cands if self.g.joint_min[i] - 1e-9 <= x <= self.g.joint_max[i] + 1e-9]
            if not cands:
                return None
            ref = near[i] if near is not None else 0.0
            out[i] = min(cands, key=lambda x: abs(x - ref))
        return out

    def ik(self, p, r_ee, near=None, tool=MAGNET, pen_offset=0.0) -> np.ndarray | None:
        """Best valid IK solution (within limits, collision-free) closest to `near`, else None."""
        near = None if near is None else np.asarray(near, dtype=float)
        best, best_cost = None, math.inf
        weights = np.array([1.0, 1.5, 1.5, 0.5, 0.5, 0.3])
        for raw in self.ik_all(p, r_ee, tool, pen_offset):
            q = self._normalize_to_limits(raw, near)
            if q is None:
                continue
            f = self.fk(q, tool, pen_offset)
            if np.linalg.norm(f.tcp - p) > 0.05 or not self.pose_is_safe(f):
                continue
            ref = near if near is not None else np.zeros(6)
            cost = float(np.sum(weights * np.abs(q - ref)))
            if cost < best_cost:
                best, best_cost = q, cost
        return best

    # ---------------------------------------------------------- validity
    def in_limits(self, q) -> bool:
        q = np.asarray(q)
        return bool(np.all(q >= self.g.joint_min - 1e-9) and np.all(q <= self.g.joint_max + 1e-9))

    def _in_keepout(self, pt: np.ndarray) -> bool:
        r = math.hypot(pt[0], pt[1])
        return any(r < rad and pt[2] < h for rad, h in self.g.keepout)

    def pose_is_safe(self, f: FKResult) -> bool:
        g = self.g
        if f.tcp[2] < g.floor_z + g.floor_margin - 1e-6:
            return False
        for pt in (f.elbow, f.wrist):
            if pt[2] < g.floor_z + g.link_floor_margin:
                return False
        return not (self._in_keepout(f.tcp) or self._in_keepout(f.wrist))

    def config_is_valid(self, q, tool=MAGNET, pen_offset=0.0) -> bool:
        return self.in_limits(q) and self.pose_is_safe(self.fk(q, tool, pen_offset))


def rpy_deg_to_matrix(yaw: float, roll: float, pitch: float) -> np.ndarray:
    return rpy_to_matrix(math.radians(yaw), math.radians(roll), math.radians(pitch))


def matrix_to_rpy_deg(r: np.ndarray) -> tuple[float, float, float]:
    y, ro, p = matrix_to_rpy(r)
    return math.degrees(y), math.degrees(ro), math.degrees(p)


__all__ = [
    "MAGNET",
    "PEN",
    "ArmGeometry",
    "FKResult",
    "Kinematics",
    "load_geometry",
    "matrix_to_rpy_deg",
    "rpy_deg_to_matrix",
]
