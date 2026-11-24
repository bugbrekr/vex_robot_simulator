"""IQ2 ``Motor`` and ``MotorGroup`` (api.vex.com/iq2/home/python/Motion/Motor.html)."""

from __future__ import annotations

from vexsim.api.common.constants import _Const, _Port, to_seconds
from vexsim.api.common.runtime import runtime
from vexsim.api.iq2.constants import (
    BRAKE,
    COAST,
    DEGREES,
    FORWARD,
    HOLD,
    MSEC,
    PERCENT,
    REVERSE,
    RPM,
    TURNS,
    GearSetting,
    TemperatureUnits,
    TorqueUnits,
    deg_to,
    dps_to,
    rot_deg,
    vel_dps,
)

STOP_MODES = {BRAKE: "brake", COAST: "coast", HOLD: "hold"}


def port_index(port) -> int:
    if isinstance(port, _Port):
        return port.index
    if isinstance(port, int) and 1 <= port <= 12:
        return port
    raise ValueError(f"expected a Smart Port such as Ports.PORT1, got {port!r}")


def bind(port, kind: str, cls_name: str):
    """Find the model of the ``kind`` device on ``port``; warn (once) if there is none."""
    rt = runtime()
    robot = rt.devices.get("robot")
    idx = port_index(port)
    from vexsim.robots.iq2.robot import DEVICE_KIND

    name = robot.device_at(idx) if robot is not None else None
    if name is not None and DEVICE_KIND[name] == kind:
        return robot, name
    what = "nothing is" if name is None else f"a {DEVICE_KIND[name]} is"
    key = ("bind", idx, kind)
    warned = rt.__dict__.setdefault("_iq2_warned", set())
    if key not in warned:
        warned.add(key)
        rt.warn(f"{cls_name}(Ports.PORT{idx}): {what} plugged into PORT{idx}, not a {kind}. "
                f"The device does nothing (check the Build tab's port setup).")
    return robot, None


def _direction_sign(direction) -> float:
    if direction == FORWARD:
        return 1.0
    if direction == REVERSE:
        return -1.0
    raise ValueError("direction must be FORWARD or REVERSE")


class Motor:
    def __init__(self, port, *args, **kwargs):
        self._rt = runtime()
        self._port = port_index(port)
        self._gears = GearSetting.RATIO_1_1
        self._reversed = False
        for a in args:  # Motor(port, gears, reverse) / Motor(port, reverse) / Motor(port, 1.0, False)
            if isinstance(a, bool):
                self._reversed = a
            elif isinstance(a, (_Const, int, float)):
                self._gears = a
        self._reversed = bool(kwargs.get("reverse", self._reversed))
        self._gears = kwargs.get("gears", self._gears)
        self._robot, self._name = bind(port, "motor", "Motor")
        self._velocity_dps = 0.5 * 720.0  # default 50 %
        self._timeout: float | None = None

    # ------------------------------------------------------------ internals
    @property
    def _m(self):
        return self._robot.motors[self._name] if self._name else None

    @property
    def _sign(self) -> float:
        return -1.0 if self._reversed else 1.0

    def _lock(self):
        return self._rt.engine.lock

    def _spin_dps(self, dps: float) -> None:
        """Engine-side: command a signed velocity in *this API motor's* direction."""
        if self._m is not None:
            self._m.spin(dps * self._sign)

    def _move_deg(self, target_deg: float, speed_dps: float) -> int:
        if self._m is None:
            return -1
        return self._m.move_to(target_deg * self._sign, speed_dps)

    def _pos_deg(self) -> float:
        return self._m.position * self._sign if self._m is not None else 0.0

    def _stop(self, mode=None) -> None:
        if self._m is not None:
            self._m.stop(STOP_MODES.get(mode) if mode is not None else None)

    def _done(self, move_id: int) -> bool:
        m = self._m
        return m is None or m.move_id != move_id or m.is_done()

    def _wait_move(self, move_id: int, timeout: float | None = None) -> bool:
        timeout = self._timeout if timeout is None else timeout
        ok = self._rt.engine.wait_until(lambda: self._done(move_id), timeout)
        if not ok:
            with self._lock():
                self._stop()
        return ok

    # ------------------------------------------------------------ actions
    def spin(self, direction, velocity=None, units=RPM) -> None:
        self._rt.check_stop()
        dps = self._velocity_dps if velocity is None else vel_dps(velocity, units)
        with self._lock():
            self._spin_dps(_direction_sign(direction) * dps)

    def spin_for(self, direction, angle, units=DEGREES, velocity=None, units_v=RPM, wait=True) -> bool:
        self._rt.check_stop()
        if units not in (DEGREES, TURNS):
            self._rt.warn(f"spin_for: {units!r} is not a rotation unit; using DEGREES")
            units = DEGREES
        dps = self._velocity_dps if velocity is None else vel_dps(velocity, units_v)
        with self._lock():
            target = self._pos_deg() + _direction_sign(direction) * rot_deg(angle, units)
            mid = self._move_deg(target, dps)
        return self._wait_move(mid) if wait else True

    def spin_to_position(self, rotation, units=DEGREES, velocity=None, units_v=RPM, wait=True) -> bool:
        self._rt.check_stop()
        dps = self._velocity_dps if velocity is None else vel_dps(velocity, units_v)
        with self._lock():
            mid = self._move_deg(rot_deg(rotation, units), dps)
        return self._wait_move(mid) if wait else True

    def stop(self, mode=None) -> None:
        self._rt.check_stop()
        with self._lock():
            self._stop(mode)

    # ------------------------------------------------------------ mutators
    def set_velocity(self, velocity, units=RPM) -> None:
        self._velocity_dps = abs(vel_dps(velocity, units))

    def set_max_torque(self, value, units=PERCENT) -> None:
        pct = float(value) if units == PERCENT else float(value) / 0.414 * 100.0
        if self._m is not None:
            with self._lock():
                self._m.max_torque_pct = max(0.0, min(100.0, pct))

    def set_position(self, position, units=DEGREES) -> None:
        if self._m is not None:
            with self._lock():
                self._m.set_position(rot_deg(position, units) * self._sign)

    def reset_position(self) -> None:
        self.set_position(0)

    def set_stopping(self, mode) -> None:
        if self._m is not None:
            with self._lock():
                self._m.stopping = STOP_MODES[mode]

    def set_timeout(self, value, units=MSEC) -> None:
        self._timeout = to_seconds(value, units) if value and value > 0 else None

    def get_timeout(self) -> int:
        return round((self._timeout or 0) * 1000)

    def set_reversed(self, value) -> None:
        self._reversed = bool(value)

    # ------------------------------------------------------------ getters
    def position(self, units=DEGREES) -> float:
        self._rt.poll()
        with self._lock():
            return deg_to(self._pos_deg(), units)

    def velocity(self, units=RPM) -> float:
        self._rt.poll()
        if self._m is None:
            return 0.0
        with self._lock():
            return dps_to(self._m.velocity * self._sign, units)

    def current(self, units=None) -> float:
        self._rt.poll()
        return round(self._m.current(), 3) if self._m is not None else 0.0

    def is_done(self) -> bool:
        self._rt.poll()
        return self._m is None or self._m.is_done()

    def is_spinning(self) -> bool:
        self._rt.poll()
        return self._m is not None and self._m.is_spinning()

    def direction(self):
        self._rt.poll()
        if self._m is None:
            return FORWARD
        v = (self._m.velocity if abs(self._m.velocity) > 1e-6 else self._m.target_vel) * self._sign
        return REVERSE if v < 0 else FORWARD

    def power(self, units=None) -> float:
        self._rt.poll()
        return round(self._m.power(), 3) if self._m is not None else 0.0

    def torque(self, units=TorqueUnits.NM) -> float:
        self._rt.poll()
        t = self._m.torque() if self._m is not None else 0.0
        return t * 8.8507 if units == TorqueUnits.INLB else t

    def efficiency(self, units=PERCENT) -> float:
        self._rt.poll()
        if self._m is None or abs(self._m.velocity) < 1:
            return 0.0
        return 0.0 if self._m.blocked else 60.0

    def temperature(self, units=TemperatureUnits.CELSIUS) -> float:
        self._rt.poll()
        c = 25.0
        return c * 9 / 5 + 32 if units == TemperatureUnits.FAHRENHEIT else c

    def installed(self) -> bool:
        return self._m is not None

    def _motors(self) -> list[Motor]:
        return [self]


class MotorGroup:
    def __init__(self, *motors):
        if len(motors) == 1 and isinstance(motors[0], (list, tuple)):
            motors = tuple(motors[0])
        self._list: list[Motor] = []
        for m in motors:
            self._list.extend(m._motors())
        self._rt = runtime()

    def _motors(self) -> list[Motor]:
        return list(self._list)

    def count(self) -> int:
        return len(self._list)

    def spin(self, direction, velocity=None, units=RPM) -> None:
        for m in self._list:
            m.spin(direction, velocity, units)

    def spin_for(self, direction, angle, units=DEGREES, velocity=None, units_v=RPM, wait=True) -> bool:
        for m in self._list:
            m.spin_for(direction, angle, units, velocity, units_v, wait=False)
        return self._wait() if wait else True

    def spin_to_position(self, rotation, units=DEGREES, velocity=None, units_v=RPM, wait=True) -> bool:
        for m in self._list:
            m.spin_to_position(rotation, units, velocity, units_v, wait=False)
        return self._wait() if wait else True

    def _wait(self) -> bool:
        ids = [(m, m._m.move_id if m._m else -1) for m in self._list]
        timeout = self._list[0]._timeout if self._list else None
        return self._rt.engine.wait_until(lambda: all(m._done(i) for m, i in ids), timeout)

    def stop(self, mode=None) -> None:
        for m in self._list:
            m.stop(mode)

    def set_velocity(self, velocity, units=RPM) -> None:
        for m in self._list:
            m.set_velocity(velocity, units)

    def set_max_torque(self, value, units=PERCENT) -> None:
        for m in self._list:
            m.set_max_torque(value, units)

    def set_position(self, position, units=DEGREES) -> None:
        for m in self._list:
            m.set_position(position, units)

    def reset_position(self) -> None:
        for m in self._list:
            m.reset_position()

    def set_stopping(self, mode) -> None:
        for m in self._list:
            m.set_stopping(mode)

    def set_timeout(self, value, units=MSEC) -> None:
        for m in self._list:
            m.set_timeout(value, units)

    def position(self, units=DEGREES) -> float:
        return self._list[0].position(units) if self._list else 0.0

    def velocity(self, units=RPM) -> float:
        return self._list[0].velocity(units) if self._list else 0.0

    def current(self, units=None) -> float:
        return sum(m.current() for m in self._list)

    def is_done(self) -> bool:
        return all(m.is_done() for m in self._list)

    def is_spinning(self) -> bool:
        return any(m.is_spinning() for m in self._list)

    def direction(self):
        return self._list[0].direction() if self._list else FORWARD

    def power(self, units=None) -> float:
        return sum(m.power() for m in self._list)

    def torque(self, units=TorqueUnits.NM) -> float:
        return sum(m.torque(units) for m in self._list)

    def efficiency(self, units=PERCENT) -> float:
        return sum(m.efficiency() for m in self._list) / max(1, len(self._list))

    def temperature(self, units=TemperatureUnits.CELSIUS) -> float:
        return self._list[0].temperature(units) if self._list else 25.0
