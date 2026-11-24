"""IQ2 ``DriveTrain`` and ``SmartDrive`` (api.vex.com/iq2/home/python/Drivetrain.html).

``DriveTrain`` turns by encoder dead reckoning using the *configured* track width.
``SmartDrive`` turns with the gyro: a controller on the engine thread drives the motors until
the heading error is inside the turn threshold.
"""

from __future__ import annotations

import math

from vexsim.api.common.constants import _Const, to_seconds
from vexsim.api.common.runtime import runtime
from vexsim.api.iq2.constants import (
    DEGREES,
    FORWARD,
    INCHES,
    LEFT,
    MM,
    MSEC,
    PERCENT,
    REVERSE,
    RIGHT,
    RPM,
    DistanceUnits,
    TemperatureUnits,
    TorqueUnits,
    deg_to,
    dist_mm,
    dps_to,
    rot_deg,
    vel_dps,
)


def _turn_sign(direction) -> float:
    if direction == RIGHT:
        return 1.0
    if direction == LEFT:
        return -1.0
    raise ValueError("direction must be LEFT or RIGHT")


def _drive_sign(direction) -> float:
    if direction == FORWARD:
        return 1.0
    if direction == REVERSE:
        return -1.0
    raise ValueError("direction must be FORWARD or REVERSE")


class DriveTrain:
    def __init__(self, lm, rm, *args, **kwargs):
        self._rt = runtime()
        self._left = lm._motors()
        self._right = rm._motors()
        # (wheelTravel=300, trackWidth=320, wheelBase=320, units=MM, externalGearRatio=1.0).
        # A units constant may appear anywhere (lab code passes SmartDrive(l, r, g, 200, MM)).
        nums, units = [], MM
        for a in args:
            if isinstance(a, _Const) and a in (MM, INCHES, DistanceUnits.CM):
                units = a
            elif isinstance(a, (int, float)) and not isinstance(a, bool):
                nums.append(float(a))
        units = kwargs.get("units", units)
        names = ["wheelTravel", "trackWidth", "wheelBase", "externalGearRatio"]
        vals = dict(zip(names, nums))
        vals.update({k: float(v) for k, v in kwargs.items() if k in names})
        self._travel = dist_mm(vals.get("wheelTravel", 300.0), units)
        self._track = dist_mm(vals.get("trackWidth", 320.0), units)
        self._wheelbase = dist_mm(vals.get("wheelBase", 320.0), units)
        self._ratio = vals.get("externalGearRatio", 1.0) or 1.0
        self._drive_dps = 0.5 * 720.0
        self._turn_dps = 0.5 * 720.0
        self._timeout: float | None = None
        self._threshold = 1.0
        self._constant = 1.0
        self._turning = False
        self._token = 0  # bumped by every drivetrain command; stale controllers exit
        self._head_zero = 0.0  # encoder-heading offsets (DriveTrain without a sensor)
        self._rot_zero = 0.0
        self._robot = self._rt.devices.get("robot")
        self._gyro = None

    # ------------------------------------------------------------ internals
    def _all(self):
        return self._left + self._right

    def _set_vel(self, left_dps: float, right_dps: float) -> None:
        for m in self._left:
            m._spin_dps(left_dps)
        for m in self._right:
            m._spin_dps(right_dps)

    def _stop_all(self, mode=None) -> None:
        for m in self._all():
            m._stop(mode)

    def _new_command(self) -> int:
        self._token += 1
        self._turning = False
        return self._token

    def _enc_rotation_raw(self) -> float:
        """Clockwise rotation (deg) estimated from the wheel encoders and the configured track."""
        if not self._left or not self._right:
            return 0.0
        mm = self._travel / 360.0 / self._ratio
        dl = sum(m._pos_deg() for m in self._left) / len(self._left) * mm
        dr = sum(m._pos_deg() for m in self._right) / len(self._right) * mm
        return math.degrees((dl - dr) / self._track)

    def _rotation_raw(self) -> float:
        return self._enc_rotation_raw()

    def _wait(self, done, timeout=None) -> bool:
        timeout = self._timeout if timeout is None else timeout
        ok = self._rt.engine.wait_until(done, timeout)
        if not ok:
            with self._rt.engine.lock:
                self._new_command()
                self._stop_all()
        return ok

    def _motors_done(self, ids) -> bool:
        return all(m._done(i) for m, i in ids)

    def _move_wheels(self, left_deg: float, right_deg: float, dps: float, wait: bool) -> bool:
        with self._rt.engine.lock:
            self._new_command()
            ids = []
            biggest = max(abs(left_deg), abs(right_deg), 1e-9)
            for ms, d in ((self._left, left_deg), (self._right, right_deg)):
                for m in ms:
                    ids.append((m, m._move_deg(m._pos_deg() + d, dps * abs(d) / biggest)))
        if not wait:
            return True
        return self._wait(lambda: self._motors_done(ids))

    def _turn_dps_for(self, velocity, units) -> float:
        return self._turn_dps if velocity is None else abs(vel_dps(velocity, units))

    # ------------------------------------------------------------ actions
    def drive(self, direction, velocity=None, units=PERCENT) -> None:
        self._rt.check_stop()
        dps = self._drive_dps if velocity is None else abs(vel_dps(velocity, units))
        s = _drive_sign(direction) * dps
        with self._rt.engine.lock:
            self._new_command()
            self._set_vel(s, s)

    def drive_for(self, direction, distance, units=INCHES, velocity=None, units_v=RPM, wait=True) -> bool:
        self._rt.check_stop()
        dps = self._drive_dps if velocity is None else abs(vel_dps(velocity, units_v))
        deg = _drive_sign(direction) * dist_mm(distance, units) / self._travel * 360.0 * self._ratio
        return self._move_wheels(deg, deg, dps, wait)

    def turn(self, direction, velocity=None, units=RPM) -> None:
        self._rt.check_stop()
        s = _turn_sign(direction) * self._turn_dps_for(velocity, units)
        with self._rt.engine.lock:
            self._new_command()
            self._turning = True
            self._set_vel(s, -s)

    def _turn_by(self, delta_deg: float, dps: float, wait: bool) -> bool:
        """Encoder turn: each wheel travels the arc of the configured track width."""
        arc = math.radians(abs(delta_deg)) * self._track / 2.0
        deg = arc / self._travel * 360.0 * self._ratio * (1 if delta_deg >= 0 else -1)
        ok = self._move_wheels(deg, -deg, dps, False)
        token = self._token
        if not wait:
            return ok
        ids = [(m, m._m.move_id if m._m else -1) for m in self._all()]
        return self._wait(lambda: self._token != token or self._motors_done(ids))

    def turn_for(self, direction, angle, units=DEGREES, velocity=None, units_v=RPM, wait=True) -> bool:
        self._rt.check_stop()
        return self._turn_by(_turn_sign(direction) * rot_deg(angle, units),
                             self._turn_dps_for(velocity, units_v), wait)

    def turn_to_heading(self, angle, units=DEGREES, velocity=None, units_v=PERCENT, wait=True) -> bool:
        self._rt.check_stop()
        err = (rot_deg(angle, units) - self.heading()) % 360.0
        if err > 180.0:
            err -= 360.0
        return self._turn_by(err, self._turn_dps_for(velocity, units_v), wait)

    def turn_to_rotation(self, angle, units=DEGREES, velocity=None, units_v=PERCENT, wait=True) -> bool:
        self._rt.check_stop()
        err = rot_deg(angle, units) - self.rotation()
        return self._turn_by(err, self._turn_dps_for(velocity, units_v), wait)

    def stop(self, mode=None) -> None:
        self._rt.check_stop()
        with self._rt.engine.lock:
            self._new_command()
            self._stop_all(mode)

    def calibrate_drivetrain(self) -> None:
        if self._gyro is not None:
            self._gyro.calibrate()
            self._gyro.wait_calibrated()

    # ------------------------------------------------------------ mutators
    def set_drive_velocity(self, velocity, units=PERCENT) -> None:
        self._drive_dps = abs(vel_dps(velocity, units))

    def set_turn_velocity(self, velocity, units=PERCENT) -> None:
        self._turn_dps = abs(vel_dps(velocity, units))

    def set_stopping(self, mode) -> None:
        for m in self._all():
            m.set_stopping(mode)

    def set_timeout(self, value, units=MSEC) -> None:
        self._timeout = to_seconds(value, units) if value and value > 0 else None

    def get_timeout(self) -> int:
        return round((self._timeout or 0) * 1000)

    def set_heading(self, value, units=DEGREES) -> None:
        with self._rt.engine.lock:
            self._head_zero = self._rotation_raw() - rot_deg(value, units)

    def set_rotation(self, value, units=DEGREES) -> None:
        with self._rt.engine.lock:
            self._rot_zero = self._rotation_raw() - rot_deg(value, units)

    def set_turn_threshold(self, value) -> None:
        self._threshold = max(0.05, float(value))

    def set_turn_constant(self, value) -> None:
        self._constant = max(0.1, min(4.0, float(value)))

    def set_gear_ratio(self, value) -> None:
        self._ratio = float(value) or 1.0

    # ------------------------------------------------------------ getters
    def heading(self, units=DEGREES) -> float:
        self._rt.poll()
        with self._rt.engine.lock:
            h = (self._rotation_raw() - self._head_zero) % 360.0
        return round(deg_to(h, units), 2)

    def rotation(self, units=DEGREES) -> float:
        self._rt.poll()
        with self._rt.engine.lock:
            r = self._rotation_raw() - self._rot_zero
        return round(deg_to(r, units), 2)

    def velocity(self, units=PERCENT) -> float:
        self._rt.poll()
        with self._rt.engine.lock:
            ms = self._all()
            v = sum(m._m.velocity * m._sign for m in ms if m._m) / max(1, len(ms))
        return round(dps_to(v, units), 2)

    def current(self, units=None) -> float:
        return round(sum(m.current() for m in self._all()), 3)

    def is_moving(self) -> bool:
        self._rt.poll()
        with self._rt.engine.lock:
            return (self._turning
                    or any(m._m is not None and not m._m.is_done() for m in self._all()))

    def is_done(self) -> bool:
        return not self.is_moving()

    def is_turning(self) -> bool:
        self._rt.poll()
        with self._rt.engine.lock:
            if self._turning:
                return True
            lv = [m._m.velocity * m._sign for m in self._left if m._m]
            rv = [m._m.velocity * m._sign for m in self._right if m._m]
            return bool(lv and rv) and lv[0] * rv[0] < 0 and not all(m._m.is_done() for m in self._all() if m._m)

    def power(self, units=None) -> float:
        return round(sum(m.power() for m in self._all()), 3)

    def torque(self, units=TorqueUnits.NM) -> float:
        return round(sum(m.torque(units) for m in self._all()), 3)

    def efficiency(self, units=PERCENT) -> float:
        ms = self._all()
        return sum(m.efficiency() for m in ms) / max(1, len(ms))

    def temperature(self, units=TemperatureUnits.CELSIUS) -> float:
        ms = self._all()
        return ms[0].temperature(units) if ms else 25.0


class SmartDrive(DriveTrain):
    def __init__(self, lm, rm, g, *args, **kwargs):
        super().__init__(lm, rm, *args, **kwargs)
        self._gyro = g

    def _rotation_raw(self) -> float:
        g = self._gyro
        if g is None or not g._ok:
            return self._enc_rotation_raw()
        return g._ins.yaw_cw

    def _turn_by(self, delta_deg: float, dps: float, wait: bool) -> bool:
        g = self._gyro
        if g is None or not g._ok:
            return super()._turn_by(delta_deg, dps, wait)
        g.wait_calibrated()
        ins = g._ins
        robot = self._robot
        with self._rt.engine.lock:
            token = self._new_command()
            self._turning = True
            target = ins.yaw_cw + delta_deg
            vmax = max(30.0, dps)
            thr = self._threshold
            kp = 10.0 * self._constant  # motor deg/s per degree of heading error
            # Finish well inside the threshold: the real controller decelerates into
            # the target rather than stopping at the threshold's edge, so errors don't pile up.
            tol = max(0.02, thr * 0.05)

            def control(dt: float) -> bool:
                if self._token != token:
                    return False
                err = target - ins.yaw_cw
                if abs(err) <= tol or (abs(err) <= thr and abs(ins.rate_cw) < 2.0):
                    self._turning = False
                    self._stop_all()
                    return False
                speed = min(vmax, max(8.0, kp * abs(err)))
                s = math.copysign(speed, err)
                self._set_vel(s, -s)
                return True

            robot.add_controller(control)
        if not wait:
            return True
        res = self._wait(lambda: self._token != token or not self._turning)
        return res

    def heading(self, units=DEGREES) -> float:
        g = self._gyro
        if g is not None and g._ok:
            return g.heading(units)
        return super().heading(units)

    def rotation(self, units=DEGREES) -> float:
        g = self._gyro
        if g is not None and g._ok:
            return g.rotation(units)
        return super().rotation(units)

    def set_heading(self, value, units=DEGREES) -> None:
        if self._gyro is not None and self._gyro._ok:
            self._gyro.set_heading(value, units)
        else:
            super().set_heading(value, units)

    def set_rotation(self, value, units=DEGREES) -> None:
        if self._gyro is not None and self._gyro._ok:
            self._gyro.set_rotation(value, units)
        else:
            super().set_rotation(value, units)

    def turn_to_heading(self, angle, units=DEGREES, velocity=None, units_v=PERCENT, wait=True) -> bool:
        self._rt.check_stop()
        err = (rot_deg(angle, units) - self.heading()) % 360.0
        if err > 180.0:
            err -= 360.0
        return self._turn_by(err, self._turn_dps_for(velocity, units_v), wait)
