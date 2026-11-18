"""Small SO(3)/SE(3) helpers (numpy, degrees at API boundaries, radians inside)."""

from __future__ import annotations

import math

import numpy as np


def rx(a: float) -> np.ndarray:
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]], dtype=float)


def ry(a: float) -> np.ndarray:
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]], dtype=float)


def rz(a: float) -> np.ndarray:
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]], dtype=float)


def rpy_to_matrix(yaw: float, roll: float, pitch: float) -> np.ndarray:
    """VEX end-effector convention (radians): R = Rz(yaw) @ Ry(pitch) @ Rx(roll)."""
    return rz(yaw) @ ry(pitch) @ rx(roll)


def matrix_to_rpy(r: np.ndarray) -> tuple[float, float, float]:
    """Inverse of rpy_to_matrix -> (yaw, roll, pitch) radians."""
    pitch = math.asin(max(-1.0, min(1.0, -r[2, 0])))
    if abs(r[2, 0]) < 1 - 1e-9:
        yaw = math.atan2(r[1, 0], r[0, 0])
        roll = math.atan2(r[2, 1], r[2, 2])
    else:  # gimbal lock: fold everything into yaw
        roll = 0.0
        yaw = math.atan2(-r[0, 1], r[1, 1])
    return yaw, roll, pitch


def matrix_to_quat(r: np.ndarray) -> list[float]:
    """Rotation matrix -> quaternion [x, y, z, w]."""
    t = r[0, 0] + r[1, 1] + r[2, 2]
    if t > 0:
        s = math.sqrt(t + 1.0) * 2
        w, x = 0.25 * s, (r[2, 1] - r[1, 2]) / s
        y, z = (r[0, 2] - r[2, 0]) / s, (r[1, 0] - r[0, 1]) / s
    elif r[0, 0] > r[1, 1] and r[0, 0] > r[2, 2]:
        s = math.sqrt(1.0 + r[0, 0] - r[1, 1] - r[2, 2]) * 2
        w, x = (r[2, 1] - r[1, 2]) / s, 0.25 * s
        y, z = (r[0, 1] + r[1, 0]) / s, (r[0, 2] + r[2, 0]) / s
    elif r[1, 1] > r[2, 2]:
        s = math.sqrt(1.0 + r[1, 1] - r[0, 0] - r[2, 2]) * 2
        w, x = (r[0, 2] - r[2, 0]) / s, (r[0, 1] + r[1, 0]) / s
        y, z = 0.25 * s, (r[1, 2] + r[2, 1]) / s
    else:
        s = math.sqrt(1.0 + r[2, 2] - r[0, 0] - r[1, 1]) * 2
        w, x = (r[1, 0] - r[0, 1]) / s, (r[0, 2] + r[2, 0]) / s
        y, z = (r[1, 2] + r[2, 1]) / s, 0.25 * s
    return [x, y, z, w]


def quat_to_matrix(q) -> np.ndarray:
    x, y, z, w = q
    return np.array(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ]
    )


def slerp_matrix(r0: np.ndarray, r1: np.ndarray, s: float) -> np.ndarray:
    """Spherical interpolation between two rotation matrices (s in [0, 1])."""
    q0 = np.array(matrix_to_quat(r0))
    q1 = np.array(matrix_to_quat(r1))
    d = float(np.dot(q0, q1))
    if d < 0:
        q1, d = -q1, -d
    if d > 0.9995:
        q = q0 + s * (q1 - q0)
    else:
        th = math.acos(d)
        q = (math.sin((1 - s) * th) * q0 + math.sin(s * th) * q1) / math.sin(th)
    return quat_to_matrix(q / np.linalg.norm(q))


def rotation_angle(r0: np.ndarray, r1: np.ndarray) -> float:
    """Angle (rad) of the relative rotation r0 -> r1."""
    c = (np.trace(r0.T @ r1) - 1) / 2
    return math.acos(max(-1.0, min(1.0, c)))


def wrap_pi(a: float) -> float:
    return (a + math.pi) % (2 * math.pi) - math.pi
