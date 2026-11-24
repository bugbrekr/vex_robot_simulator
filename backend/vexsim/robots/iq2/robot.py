"""The IQ2 mobile robot: differential drive (front motors, rear omni wheels), sensors, ports.

All devices physically exist on the robot. The Build tab's *config* decides which ones are
plugged in (enabled) and on which Smart Port. The API binds ``Motor(Ports.PORT6)`` and similar
calls to whatever device is on that port, like real hardware.
"""

from __future__ import annotations

import math
import random
from collections.abc import Callable
from functools import cache
from pathlib import Path

import yaml

from vexsim.core.entity import Entity
from vexsim.robots.iq2.field import Field, hex_rgb
from vexsim.robots.iq2.motor import SmartMotorModel

DEVICES = ("left_motor", "right_motor", "distance", "optical", "bumper", "touchled")
DEVICE_KIND = {"left_motor": "motor", "right_motor": "motor", "distance": "distance",
               "optical": "optical", "bumper": "bumper", "touchled": "touchled"}


@cache
def load_geometry() -> dict:
    with open(Path(__file__).with_name("geometry.yaml"), encoding="utf-8") as f:
        return yaml.safe_load(f)


def default_config() -> dict:
    g = load_geometry()
    return {d: {"port": int(g["default_ports"][d]), "enabled": True} for d in DEVICES}


DRIVES = ("fwd", "rwd")


def drive_of(cfg: dict | None) -> str:
    """The drive layout in a config: "fwd" (motors on the front axle, default) or "rwd"."""
    d = (cfg or {}).get("drive", "fwd")
    return d if d in DRIVES else "fwd"


def normalize_config(cfg: dict | None) -> dict:
    """Merge a (possibly partial) device config into the defaults; ports clamp to 1-12.
    (The ``drive`` key, if any, is read separately with ``drive_of``.)"""
    out = default_config()
    for d, v in (cfg or {}).items():
        if d in out and isinstance(v, dict):
            if "port" in v:
                out[d]["port"] = max(1, min(12, int(v["port"])))
            if "enabled" in v:
                out[d]["enabled"] = bool(v["enabled"])
    return out


def preset_config(preset: dict) -> dict:
    """An example's ``robot`` preset: the listed devices are plugged in, the rest are OFF."""
    cfg = default_config()
    for d in cfg:
        cfg[d]["enabled"] = d in preset
        if d in preset and "port" in (preset[d] or {}):
            cfg[d]["port"] = int(preset[d]["port"])
    return cfg


# ---------------------------------------------------------------------- simple sensor models
class Callbacks:
    """pressed/released-style callback lists, fired on the engine thread."""

    def __init__(self):
        self._cbs: dict[str, list[tuple[Callable, tuple]]] = {}

    def add(self, event: str, fn: Callable, args: tuple = ()) -> None:
        self._cbs.setdefault(event, []).append((fn, args))

    def fire(self, engine, event: str) -> None:
        for fn, args in self._cbs.get(event, []):
            engine.spawn_callback(fn, args)

    def clear(self) -> None:
        self._cbs.clear()


class TouchLedModel:
    def __init__(self):
        self.ui_pressed = False
        self.pressed = False
        self.events = Callbacks()
        self.reset_for_program()

    def reset_for_program(self):
        self.color = "#ffffff"
        self.brightness = 0
        self.fade = "off"
        self.blink: tuple[str, float, float] | None = None
        self.events.clear()

    def lit_color(self, t: float) -> str | None:
        if self.blink is not None:
            color, on, off = self.blink
            period = max(1e-3, on + off)
            return color if (t % period) < on else None
        return self.color if self.brightness > 0 else None


class Inertial:
    """The brain's built-in IMU. Angles are clockwise-positive (VEX heading convention)."""

    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.yaw_cw = 0.0  # cumulative clockwise rotation since power-on (deg)
        self.rate_cw = 0.0  # deg/s
        self.accel = (0.0, 0.0)  # robot-frame x (forward), y (left) in G
        self.events = Callbacks()
        self.reset_for_program()

    def reset_for_program(self):
        self.head_zero = self.yaw_cw
        self.rot_zero = self.yaw_cw
        self.calibrating_until = -1.0
        self.events.clear()
        self._last_heading = 0.0

    def rotation(self) -> float:
        return self.yaw_cw - self.rot_zero

    def heading(self) -> float:
        return (self.yaw_cw - self.head_zero) % 360.0


# ---------------------------------------------------------------------- robot
class IQRobotModel(Entity):
    kind = "iq2_robot"

    def __init__(self, field: Field, start: dict | None = None, config: dict | None = None,
                 realistic: bool = True, seed: int = 1, name: str = "robot"):
        super().__init__(name)
        self.g = load_geometry()
        self.field = field
        start = start or {}
        self.start_pose = (float(start.get("x", 0.0)), float(start.get("y", 0.0)),
                           math.radians(float(start.get("yaw", 90.0))))
        self.config = normalize_config(config)
        self.drive = drive_of(config)
        # map starts give the chassis position (its FWD axle point); the pose is the drive axle
        self.x, self.y, self.theta = self.start_world()
        mcfg = self.g["motor"]
        self.motors = {"left_motor": SmartMotorModel("left_motor", mcfg),
                       "right_motor": SmartMotorModel("right_motor", mcfg)}
        # left motor's FORWARD drives its wheel forward; the right motor is mounted mirrored
        self.mount = {"left_motor": 1.0, "right_motor": -1.0}
        self.omni_angle = 0.0
        self.track = self.g["drive"]["track_width"]
        self.travel = self.g["drive"]["wheel_travel"]
        self.realistic = realistic
        self.seed = seed
        self.rng = random.Random(seed)
        self.wheel_scale = {"left_motor": 1.0, "right_motor": 1.0}
        self.turn_gain = 1.0
        # sensors
        s = self.g["sensors"]
        self.inertial = Inertial(s["inertial"])
        self.touchled = TouchLedModel()
        self.bumper_ui = False
        self.bumper_contact = False
        self.bumper_pressed = False
        self.bumper_events = Callbacks()
        self.optical_led = 0.0  # %
        self.optical_events = Callbacks()
        self.optical_near = False
        self.optical_threshold = 100
        self.optical_reading = {"brightness": 0.0, "hue": 0.0, "rgb": (0, 0, 0), "prox": 0.0}
        self.distance_reading = s["distance"]["no_object"]
        self.distance_true: float | None = None
        self.distance_hit = None
        self.distance_vel = 0.0
        self.contacts: list[str] = []
        self.controllers: list[Callable[[float], bool]] = []
        self.t = 0.0
        self.set_realistic(realistic)
        self._update_sensors(0.0)

    # ------------------------------------------------------------------ configuration
    def set_realistic(self, on: bool) -> None:
        self.realistic = bool(on)
        r = self.g["realism"]
        if self.realistic:
            spread = r["wheel_scale_spread"]
            self.wheel_scale = {m: 1.0 + self.rng.uniform(-spread, spread) for m in self.motors}
            self.turn_gain = r["turn_gain"]
        else:
            self.wheel_scale = {m: 1.0 for m in self.motors}
            self.turn_gain = 1.0

    @property
    def offset(self) -> float:
        """Chassis-frame x of the pose origin's offset: the pose is always the centre of the
        driven axle (the turning point). Geometry is given for FWD (drive axle at chassis x = 0);
        with RWD the motors and tyres sit on the rear axle, so the chassis lies ahead of it."""
        return self.g["drive"]["wheel_base"] if self.drive == "rwd" else 0.0

    def set_config(self, cfg: dict) -> None:
        self.config = normalize_config(cfg)
        drive = drive_of(cfg)
        if drive != self.drive:
            # keep the chassis where it is on the mat: move the pose to the new drive axle
            old = self.offset
            self.drive = drive
            dx = old - self.offset
            self.x, self.y = self.to_world(dx, 0.0)
            self._update_sensors(0.0)

    def device_at(self, port: int) -> str | None:
        """Name of the enabled device plugged into a Smart Port (None if the port is empty)."""
        for d, c in self.config.items():
            if c["enabled"] and c["port"] == port:
                return d
        return None

    def enabled(self, device: str) -> bool:
        return self.config[device]["enabled"]

    def reset_for_program(self) -> None:
        for m in self.motors.values():
            m.reset_for_program()
            if abs(m.velocity) > 0:
                m.stop("brake")
        self.controllers.clear()
        self.touchled.reset_for_program()
        self.inertial.reset_for_program()
        self.bumper_events.clear()
        self.optical_events.clear()
        self.optical_led = 0.0
        self.optical_threshold = 100

    def stop_motors(self) -> None:
        """End of a project: motors brake to a stop (like the brain does)."""
        self.controllers.clear()
        for m in self.motors.values():
            if m.mode != "idle" or abs(m.velocity) > 0:
                m.stop("brake")

    def place(self, x: float, y: float, theta: float) -> None:
        old = self.theta
        self.x, self.y, self.theta = float(x), float(y), float(theta)
        # picking the robot up and turning it is seen by the gyro
        self.inertial.yaw_cw += -math.degrees(_wrap(self.theta - old))
        self._update_sensors(0.0)

    def start_world(self) -> tuple[float, float, float]:
        """Pose (driven-axle centre) that puts the chassis on the map's start."""
        x, y, th = self.start_pose
        return x - self.offset * math.cos(th), y - self.offset * math.sin(th), th

    def reset_pose(self) -> None:
        self.place(*self.start_world())

    def add_controller(self, fn: Callable[[float], bool]) -> None:
        self.controllers.append(fn)

    def is_moving(self) -> bool:
        return bool(self.controllers) or any(m.mode in ("position", "stopping") for m in self.motors.values())

    # ------------------------------------------------------------------ geometry
    def to_world(self, px: float, py: float, x=None, y=None, theta=None) -> tuple[float, float]:
        x = self.x if x is None else x
        y = self.y if y is None else y
        th = self.theta if theta is None else theta
        c, s = math.cos(th), math.sin(th)
        return x + px * c - py * s, y + px * s + py * c

    def chassis_to_world(self, px: float, py: float, x=None, y=None, theta=None) -> tuple[float, float]:
        """A point given in the chassis frame (geometry.yaml, FWD layout) -> world."""
        return self.to_world(px + self.offset, py, x, y, theta)

    def footprint(self, x=None, y=None, theta=None, grow: float = 0.0) -> list[tuple[float, float]]:
        f = self.g["footprint"]
        hw, fr, re = f["half_width"] + grow, f["front"] + grow, f["rear"] - grow
        return [self.chassis_to_world(px, py, x, y, theta) for px, py in ((fr, hw), (re, hw), (re, -hw), (fr, -hw))]

    def bumper_zone(self) -> list[tuple[float, float]]:
        f = self.g["footprint"]
        hy = self.g["mounts"]["bumper"]["size"][1] / 2 + 4
        x0, x1 = f["front"] - 4, f["front"] + 2.5
        return [self.chassis_to_world(px, py) for px, py in ((x1, hy), (x0, hy), (x0, -hy), (x1, -hy))]

    # ------------------------------------------------------------------ stepping
    def step(self, t: float, dt: float) -> None:
        self.t = t + dt
        self.controllers = [c for c in self.controllers if c(dt)]
        want = {n: m.desired_velocity(dt) for n, m in self.motors.items()}
        # wheel ground speeds (mm/s, + = robot forward)
        vl = want["left_motor"] * self.mount["left_motor"] / 360.0 * self.travel * self.wheel_scale["left_motor"]
        vr = want["right_motor"] * self.mount["right_motor"] / 360.0 * self.travel * self.wheel_scale["right_motor"]
        v = (vl + vr) / 2
        w = (vr - vl) / self.track * self.turn_gain  # rad/s, CCW
        frac = self._free_fraction(v, w, dt)
        for n, m in self.motors.items():
            m.blocked = frac < 1.0 and abs(want[n]) > 1e-6
            m.advance(want[n] * frac, dt)
        if frac > 0:
            nx, ny, nth = _integrate(self.x, self.y, self.theta, v * frac, w * frac, dt)
            dth = nth - self.theta
            accel_fwd = 0.0
            self.x, self.y, self.theta = nx, ny, nth
        else:
            dth, accel_fwd = 0.0, 0.0
        self.omni_angle += v * frac * dt / self.travel * 360.0
        # IMU
        ins = self.inertial
        rate = -math.degrees(dth) / dt
        if self.realistic:
            rate += ins.cfg["drift_dps"]
        ins.rate_cw = rate
        ins.yaw_cw += rate * dt
        ins.accel = (accel_fwd, 0.0)
        self._update_sensors(dt)

    def _free_fraction(self, v: float, w: float, dt: float) -> float:
        if abs(v) < 1e-9 and abs(w) < 1e-12:
            return 1.0
        nx, ny, nth = _integrate(self.x, self.y, self.theta, v, w, dt)
        if not self.field.collides(self.footprint(nx, ny, nth)):
            return 1.0
        if self.field.collides(self.footprint()):
            # already overlapping (e.g. placed into an obstacle): allow moves that don't go deeper
            return 1.0
        lo, hi = 0.0, 1.0
        for _ in range(8):
            mid = (lo + hi) / 2
            mx, my, mth = _integrate(self.x, self.y, self.theta, v * mid, w * mid, dt)
            if self.field.collides(self.footprint(mx, my, mth)):
                hi = mid
            else:
                lo = mid
        return lo

    # ------------------------------------------------------------------ sensors
    def _update_sensors(self, dt: float) -> None:
        g = self.g
        # obstacles the robot is touching (within 2 mm)
        self.contacts = [ob.id for ob in self.field.collides(self.footprint(grow=2.0))]
        # bumper
        contact = bool(self.field.collides(self.bumper_zone())) and self.enabled("bumper")
        self.bumper_contact = contact
        pressed = contact or self.bumper_ui
        if pressed != self.bumper_pressed:
            self.bumper_pressed = pressed
            if self.engine is not None:
                self.bumper_events.fire(self.engine, "pressed" if pressed else "released")
        # touch LED (pressed only from the UI)
        tl = self.touchled
        if tl.ui_pressed != tl.pressed:
            tl.pressed = tl.ui_pressed
            if self.engine is not None:
                tl.events.fire(self.engine, "pressed" if tl.pressed else "released")
        # distance sensor
        dc = g["sensors"]["distance"]
        m = g["mounts"]["distance"]
        sx, sy = self.chassis_to_world(m["pos"][0], m["pos"][1])
        best, hit = None, None
        ha = math.radians(dc["beam_half_angle"])
        for off in (0.0, -ha, ha):
            d, ob = self.field.raycast(sx, sy, self.theta + off, m["pos"][2], dc["max_range"])
            if d is not None and (best is None or d < best):
                best, hit = d, ob
        prev = self.distance_true
        self.distance_true, self.distance_hit = best, hit
        if dt > 0:
            if best is not None and prev is not None:
                inst = -(best - prev) / dt / 1000.0  # m/s, + = approaching
                self.distance_vel += (inst - self.distance_vel) * min(1.0, dt / 0.1)
            else:
                self.distance_vel = 0.0
        if best is None:
            self.distance_reading = dc["no_object"]
        else:
            r = max(dc["min_range"], best)
            if self.realistic:
                sigma = dc["near_error"] / 3 if r < 200 else r * dc["far_error_pct"] / 300
                r = max(dc["min_range"], r + self.rng.gauss(0.0, sigma))
            self.distance_reading = r
        # optical sensor (faces the floor)
        oc = g["sensors"]["optical"]
        om = g["mounts"]["optical"]
        ox, oy = self.chassis_to_world(om["pos"][0], om["pos"][1])
        rad = oc["spot_radius"]
        samples = [(ox, oy)] + [(ox + rad * math.cos(a), oy + rad * math.sin(a))
                                for a in (k * math.pi / 3 for k in range(6))]
        rs = gs = bs = 0.0
        for px, py in samples:
            r_, g_, b_ = hex_rgb(self.field.floor_color_at(px, py))
            rs, gs, bs = rs + r_, gs + g_, bs + b_
        n = len(samples)
        rgb = (rs / n / 255, gs / n / 255, bs / n / 255)
        lum = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
        refl = oc["black_reflectance"] + (oc["white_reflectance"] - oc["black_reflectance"]) * lum
        light = oc["ambient"] + (1 - oc["ambient"]) * self.optical_led / 100.0
        bright = refl * light * 100.0
        if self.realistic:
            bright += self.rng.gauss(0.0, oc["noise"])
        bright = max(0.0, min(100.0, bright))
        prox = max(0.0, min(255.0, refl * light * 255.0)) if self.enabled("optical") else 0.0
        self.optical_reading = {"brightness": bright, "hue": _hue(rgb), "rgb": rgb, "prox": prox,
                                "sat": _sat(rgb), "lum": lum}
        near = prox >= self.optical_threshold
        if near != self.optical_near:
            self.optical_near = near
            if self.engine is not None:
                self.optical_events.fire(self.engine, "detected" if near else "lost")

    # ------------------------------------------------------------------ io
    def snapshot(self) -> dict:
        tl = self.touchled
        return {
            "pose": [round(self.x, 2), round(self.y, 2), round(math.degrees(self.theta), 3)],
            "wheels": {n: round(m.position * self.mount[n], 1) for n, m in self.motors.items()},
            "omni": round(self.omni_angle, 1),
            "motors": {n: m.snapshot() for n, m in self.motors.items()},
            "heading": round(self.inertial.heading(), 2),
            "rotation": round(self.inertial.rotation(), 2),
            "distance": round(self.distance_reading, 1),
            "distance_hit": self.distance_true is not None and self.distance_true <= 2000,
            "optical": {"brightness": round(self.optical_reading["brightness"], 1),
                        "hue": round(self.optical_reading["hue"], 1),
                        "led": self.optical_led, "near": self.optical_near},
            "bumper": self.bumper_pressed,
            "touchled": {"color": tl.lit_color(self.t), "pressed": tl.pressed,
                         "brightness": tl.brightness},
            "contacts": self.contacts,
            "config": {**self.config, "drive": self.drive},
        }

    def describe(self) -> dict:
        return {"name": self.name, "kind": self.kind, "geometry": self.g,
                "start": [*self.start_world()[:2], math.degrees(self.start_pose[2])],
                "config": {**self.config, "drive": self.drive}}


# ---------------------------------------------------------------------- helpers
def _integrate(x: float, y: float, th: float, v: float, w: float, dt: float):
    if abs(w) < 1e-9:
        return x + v * dt * math.cos(th), y + v * dt * math.sin(th), th
    nth = th + w * dt
    r = v / w
    return x + r * (math.sin(nth) - math.sin(th)), y - r * (math.cos(nth) - math.cos(th)), nth


def _wrap(a: float) -> float:
    return (a + math.pi) % (2 * math.pi) - math.pi


def _hue(rgb) -> float:
    r, g, b = rgb
    mx, mn = max(rgb), min(rgb)
    if mx - mn < 1e-9:
        return 0.0
    d = mx - mn
    if mx == r:
        h = ((g - b) / d) % 6
    elif mx == g:
        h = (b - r) / d + 2
    else:
        h = (r - g) / d + 4
    return (h * 60.0) % 360.0


def _sat(rgb) -> float:
    mx = max(rgb)
    return 0.0 if mx == 0 else (mx - min(rgb)) / mx
