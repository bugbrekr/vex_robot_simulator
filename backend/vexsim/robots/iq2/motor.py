"""IQ Smart Motor model: velocity / position control with acceleration limits and an encoder.

Everything is in motor-shaft terms: ``position`` in degrees, velocities in deg/s. The motor's
own direction (``FORWARD`` = +) is used here; ``reversed`` and the mounting side are applied by
the API and the drivebase respectively.
"""

from __future__ import annotations

import math

IDLE, VELOCITY, POSITION, STOPPING = "idle", "velocity", "position", "stopping"
BRAKE, COAST, HOLD = "brake", "coast", "hold"


class SmartMotorModel:
    def __init__(self, name: str, cfg: dict):
        self.name = name
        self.max_dps = cfg["free_rpm"] * 6.0
        self.accel = cfg["accel_rpm_s"] * 6.0
        self.brake_decel = cfg["brake_rpm_s"] * 6.0
        self.coast_decel = cfg["coast_rpm_s"] * 6.0
        self.max_current = cfg["max_current"]
        self.stall_torque = cfg["stall_torque"]
        self.reset_for_program()
        self.position = 0.0  # deg (encoder, motor direction)
        self.velocity = 0.0  # deg/s actual
        self.blocked = False  # set by the drivebase when the wheel can't turn (robot against a wall)

    def reset_for_program(self) -> None:
        self.mode = IDLE
        self.target_vel = 0.0  # deg/s commanded (velocity mode, signed)
        self.target_pos = 0.0  # deg (position mode)
        self.pos_speed = 0.0  # deg/s magnitude for position moves
        self.stopping = BRAKE
        self.stop_mode = BRAKE
        self.hold_pos: float | None = None
        self.max_torque_pct = 50.0
        self.move_id = 0  # increments on every new command (lets waiting calls notice preemption)

    # ------------------------------------------------------------ commands (engine lock held)
    def spin(self, vel_dps: float) -> None:
        self.mode = VELOCITY
        self.target_vel = max(-self.max_dps, min(self.max_dps, vel_dps))
        self.hold_pos = None
        self.move_id += 1

    def move_to(self, target_deg: float, speed_dps: float) -> int:
        self.mode = POSITION
        self.target_pos = float(target_deg)
        self.pos_speed = max(0.0, min(self.max_dps, abs(speed_dps)))
        self.hold_pos = None
        self.move_id += 1
        return self.move_id

    def stop(self, mode: str | None = None) -> None:
        mode = mode or self.stopping
        self.mode = STOPPING
        self.stop_mode = mode
        self.target_vel = 0.0
        self.hold_pos = None
        self.move_id += 1

    def set_position(self, deg: float) -> None:
        shift = float(deg) - self.position
        self.position = float(deg)
        self.target_pos += shift
        if self.hold_pos is not None:
            self.hold_pos += shift

    # ------------------------------------------------------------ state
    def is_done(self) -> bool:
        return self.mode != POSITION

    def is_spinning(self) -> bool:
        return self.mode in (VELOCITY, POSITION) or abs(self.velocity) > 1.0

    def desired_velocity(self, dt: float) -> float:
        """Velocity the controller asks for this step (before the drivebase applies contact)."""
        v = self.velocity
        if self.mode == VELOCITY:
            return _approach(v, self.target_vel, self.accel * dt)
        if self.mode == POSITION:
            err = self.target_pos - self.position
            if abs(err) < 0.5 and abs(v) < self.brake_decel * dt * 2:
                return 0.0
            vmax = min(self.pos_speed, math.sqrt(2 * self.brake_decel * 0.8 * abs(err)))
            want = math.copysign(vmax, err)
            # don't overshoot within this step
            if abs(want) * dt > abs(err):
                want = err / dt
            return _approach(v, want, max(self.accel, self.brake_decel) * dt)
        if self.mode == STOPPING:
            decel = self.coast_decel if self.stop_mode == COAST else self.brake_decel
            return _approach(v, 0.0, decel * dt)
        if self.hold_pos is not None:  # HOLD after stopping: spring back to the held position
            err = self.hold_pos - self.position
            return max(-self.max_dps, min(self.max_dps, err * 20.0))
        return _approach(v, 0.0, self.coast_decel * dt)

    def advance(self, achieved_vel: float, dt: float) -> None:
        """Integrate the velocity the wheel actually reached (the drivebase may cut it short)."""
        self.velocity = achieved_vel
        self.position += achieved_vel * dt
        if self.mode == POSITION:
            if abs(self.target_pos - self.position) < 0.5 and abs(achieved_vel) < 30:
                if not self.blocked:
                    self.position = self.target_pos
                self.mode = IDLE
                self.velocity = 0.0
                self._settle(self.stopping)
        elif self.mode == STOPPING and achieved_vel == 0.0:
            self.mode = IDLE
            self._settle(self.stop_mode)

    def _settle(self, mode: str) -> None:
        if mode == HOLD:
            self.hold_pos = self.position

    # ------------------------------------------------------------ derived readings
    def current(self) -> float:
        """Rough current estimate: idle draw + load; maxes out when stalled against a wall."""
        if self.blocked and self.mode in (VELOCITY, POSITION):
            return self.max_current * self.max_torque_pct / 100.0
        if abs(self.velocity) < 1 and self.mode == IDLE:
            return 0.0
        return 0.12 + 0.18 * abs(self.velocity) / self.max_dps

    def torque(self) -> float:
        return self.stall_torque * self.current() / self.max_current

    def power(self) -> float:
        return self.torque() * abs(self.velocity) * math.pi / 180.0

    def snapshot(self) -> dict:
        return {"pos": round(self.position, 2), "vel": round(self.velocity / 6.0, 2),
                "cur": round(self.current(), 3), "mode": self.mode}


def _approach(v: float, target: float, step: float) -> float:
    if v < target:
        return min(target, v + step)
    return max(target, v - step)
