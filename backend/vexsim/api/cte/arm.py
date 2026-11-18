"""VEXcode ``Arm`` class for the CTE 6-Axis Arm (see docs/specs/cte_arm_api.md)."""

from __future__ import annotations

import numpy as np

from vexsim.api.common.brain import Event
from vexsim.api.common.constants import MSEC, _Const, to_seconds
from vexsim.api.common.runtime import runtime
from vexsim.robots.cte_arm.kinematics import MAGNET as _MAGNET
from vexsim.robots.cte_arm.kinematics import PEN as _PEN
from vexsim.robots.cte_arm.kinematics import matrix_to_rpy_deg, rpy_deg_to_matrix


def _num(name: str, v) -> float:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        raise TypeError(f"{name} must be a number, got {type(v).__name__}")
    return float(v)


class Arm:
    """6-Axis Arm. ``Arm()`` (CTE Tile) or ``Arm(Ports.PORTx)`` (EXP Brain)."""

    MAGNET = _Const("MAGNET", _MAGNET)
    PEN = _Const("PEN", _PEN)

    def __init__(self, port=None):
        rt = runtime()
        arms = rt.engine.find("cte_arm")
        if not arms:
            raise RuntimeError("this scenario has no 6-Axis Arm")
        self._m = arms[0]
        self._rt = rt

    # ------------------------------------------------------------ helpers
    def _move(self, p, r, wait: bool, label: str) -> bool:
        rt, m = self._rt, self._m
        rt.check_stop()
        self._check_tool_config()
        with rt.engine.lock:
            mid = m.start_move(p, r)
            timeout = m.timeout_ms / 1000.0 if m.timeout_ms > 0 else None
            if mid is None:
                why = "control stop is engaged" if m.control_stopped else "position unreachable"
                rt.warn(f"{label} ignored: {why}")
                return False
        if not wait:
            return True
        done = rt.engine.wait_until(lambda: m.move_id != mid or m.traj is None, timeout)
        with rt.engine.lock:
            if not done and m.move_id == mid:
                m.abort_move()  # timeout expired
            return bool(m.last_result.get(mid, False))

    def _check_tool_config(self) -> None:
        """Simulator hint (once per project): configured end effector != mounted tool."""
        rt, m = self._rt, self._m
        notes = getattr(rt, "tool_notes", None)
        if notes is None:
            notes = rt.tool_notes = set()
        if m.tool != m.mounted_tool and "type" not in notes:
            notes.add("type")
            mounted = "Pen Holder Tool" if m.mounted_tool == _PEN else "Magnet Pickup Tool"
            want = "Arm.PEN" if m.mounted_tool == _PEN else "Arm.MAGNET"
            rt.warn(f"The {mounted} is mounted but the end effector type is "
                    f"{'Arm.PEN' if m.tool == _PEN else 'Arm.MAGNET'} - did you forget "
                    f"arm.set_end_effector_type({want})?")
        elif (m.tool == _PEN and m.mounted_tool == _PEN and "offset" not in notes
              and abs(m.pen_offset - m.marker_offset) > 3):
            notes.add("offset")
            want = round(m.marker_offset, 1)
            rt.warn(f"Pen offset is {m.pen_offset:g} mm but the mounted marker needs "
                    f"{want:g} mm (its tip is {m.marker_protrusion:g} mm below the holder mount) - "
                    f"try arm.set_pen_offset({want:g})")

    def _base_pose(self):
        with self._rt.engine.lock:
            return self._m.target_pose()

    # ------------------------------------------------------------ actions
    def move_to(self, x, y, z, wait=True) -> bool:
        p = np.array([_num("x", x), _num("y", y), _num("z", z)])
        _, r = self._base_pose()
        return self._move(p, r, wait, f"move_to({x}, {y}, {z})")

    def move_inc(self, x, y, z, wait=True) -> bool:
        p0, r = self._base_pose()
        p = p0 + np.array([_num("x", x), _num("y", y), _num("z", z)])
        return self._move(p, r, wait, f"move_inc({x}, {y}, {z})")

    def move_end_effector_to(self, yaw, roll, pitch, wait=True) -> bool:
        p, _ = self._base_pose()
        r = rpy_deg_to_matrix(_num("yaw", yaw), _num("roll", roll), _num("pitch", pitch))
        return self._move(p, r, wait, f"move_end_effector_to({yaw}, {roll}, {pitch})")

    def move_end_effector_inc(self, yaw, roll, pitch, wait=True) -> bool:
        p, r0 = self._base_pose()
        y0, ro0, pi0 = matrix_to_rpy_deg(r0)
        r = rpy_deg_to_matrix(y0 + _num("yaw", yaw), ro0 + _num("roll", roll),
                              pi0 + _num("pitch", pitch))
        return self._move(p, r, wait, f"move_end_effector_inc({yaw}, {roll}, {pitch})")

    # ------------------------------------------------------------ mutators
    def set_speed(self, speed) -> None:
        s = int(round(_num("speed", speed)))
        with self._rt.engine.lock:
            self._m.speed = max(1, min(100, s))

    def set_end_effector_type(self, type) -> None:
        if type not in (Arm.MAGNET, Arm.PEN):
            raise ValueError("end effector type must be Arm.MAGNET or Arm.PEN")
        with self._rt.engine.lock:
            self._m.set_tool(_MAGNET if type == Arm.MAGNET else _PEN)

    def set_end_effector_magnet(self, state) -> None:
        self._rt.check_stop()
        with self._rt.engine.lock:
            self._m.set_magnet(bool(state))

    def set_pen_offset(self, zOffset) -> None:
        with self._rt.engine.lock:
            self._m.pen_offset = _num("zOffset", zOffset)

    def set_control_stop(self, state=True) -> None:
        if state:
            with self._rt.engine.lock:
                self._m.engage_control_stop()

    def set_timeout(self, timeout, units=MSEC) -> None:
        with self._rt.engine.lock:
            self._m.timeout_ms = int(round(to_seconds(_num("timeout", timeout), units) * 1000))

    # ------------------------------------------------------------ getters
    def is_done(self) -> bool:
        self._rt.poll()
        with self._rt.engine.lock:
            return not self._m.is_moving()

    def _tcp(self, i: int) -> float:
        self._rt.poll()
        with self._rt.engine.lock:
            return round(float(self._m.tcp()[i]), 2) + 0.0  # no "-0.0"

    def get_x(self) -> float:
        return self._tcp(0)

    def get_y(self) -> float:
        return self._tcp(1)

    def get_z(self) -> float:
        return self._tcp(2)

    def _rpy(self, i: int) -> float:
        self._rt.poll()
        with self._rt.engine.lock:
            return round(self._m.rpy()[i], 2) + 0.0

    def get_yaw(self) -> float:
        return self._rpy(0)

    def get_roll(self) -> float:
        return self._rpy(1)

    def get_pitch(self) -> float:
        return self._rpy(2)

    def get_timeout(self) -> int:
        return self._m.timeout_ms

    def is_connected(self) -> bool:
        return True

    def is_crashed(self) -> bool:
        return self._m.crashed

    def can_arm_reach_to(self, x, y, z) -> bool:
        _, r = self._base_pose()
        with self._rt.engine.lock:
            return self._m.can_reach(np.array([_num("x", x), _num("y", y), _num("z", z)]), r)

    def can_arm_reach_inc(self, x, y, z) -> bool:
        p0, r = self._base_pose()
        with self._rt.engine.lock:
            return self._m.can_reach(p0 + np.array([_num("x", x), _num("y", y), _num("z", z)]), r)

    def can_end_effector_reach_to(self, yaw, roll, pitch) -> bool:
        p, _ = self._base_pose()
        r = rpy_deg_to_matrix(_num("yaw", yaw), _num("roll", roll), _num("pitch", pitch))
        with self._rt.engine.lock:
            return self._m.can_reach(p, r)

    def can_end_effector_reach_inc(self, yaw, roll, pitch) -> bool:
        p, r0 = self._base_pose()
        y0, ro0, pi0 = matrix_to_rpy_deg(r0)
        r = rpy_deg_to_matrix(y0 + _num("yaw", yaw), ro0 + _num("roll", roll),
                              pi0 + _num("pitch", pitch))
        with self._rt.engine.lock:
            return self._m.can_reach(p, r)

    # ------------------------------------------------------------ callbacks
    def control_stopped(self, callback, arg=()) -> Event:
        with self._rt.engine.lock:
            self._m.on_control_stopped(callback, tuple(arg))
        self._rt.callbacks_registered += 1
        return Event()

    def crashed(self, callback, arg=()) -> Event:
        with self._rt.engine.lock:
            self._m.on_crashed(callback, tuple(arg))
        self._rt.callbacks_registered += 1
        return Event()
