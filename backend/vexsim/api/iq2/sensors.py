"""IQ2 sensors: Distance, Optical, Bumper, Touchled, Inertial (built into the brain)."""

from __future__ import annotations

import math

from vexsim.api.common.brain import Event
from vexsim.api.common.runtime import runtime
from vexsim.api.iq2.constants import (
    DEGREES,
    DPS,
    MM,
    PERCENT,
    RPM,
    XAXIS,
    YAXIS,
    ZAXIS,
    Color,
    FadeType,
    LedStateType,
    ObjectSizeType,
    OrientationType,
    color_hex,
    deg_to,
    mm_to,
    rot_deg,
)
from vexsim.api.iq2.motor import bind


class _Device:
    _kind = ""

    def __init__(self, port):
        self._rt = runtime()
        self._robot, self._name = bind(port, self._kind, type(self).__name__)

    @property
    def _ok(self) -> bool:
        return self._name is not None

    def installed(self) -> bool:
        return self._ok

    def _register(self, events, event: str, callback, arg=()) -> Event:
        with self._rt.engine.lock:
            events.add(event, callback, tuple(arg))
        self._rt.callbacks_registered += 1
        return Event()


# ---------------------------------------------------------------------- Distance (2nd gen)
class Distance(_Device):
    _kind = "distance"

    def object_distance(self, units=MM) -> float:
        self._rt.poll()
        if not self._ok:
            return 0.0
        with self._rt.engine.lock:
            return round(mm_to(self._robot.distance_reading, units), 2)

    def is_object_detected(self) -> bool:
        self._rt.poll()
        if not self._ok:
            return False
        r = self._robot
        with self._rt.engine.lock:
            return r.distance_true is not None and r.distance_true <= r.g["sensors"]["distance"]["detect_range"]

    def object_size(self):
        self._rt.poll()
        if not self.is_object_detected():
            return ObjectSizeType.NONE
        r = self._robot
        with self._rt.engine.lock:
            hit = r.distance_hit
            th = r.theta
            c = r.g["sensors"]["distance"]
            w = hit.width_across(math.cos(th), math.sin(th)) if hit is not None else 0.0
        if w < c["size_small"]:
            return ObjectSizeType.SMALL
        if w < c["size_medium"]:
            return ObjectSizeType.MEDIUM
        return ObjectSizeType.LARGE

    def object_velocity(self) -> float:
        self._rt.poll()
        if not self._ok:
            return 0.0
        with self._rt.engine.lock:
            return round(self._robot.distance_vel, 3)

    def object_rawsize(self) -> int:
        return {"none": 0, "small": 100, "medium": 250, "large": 400}[self.object_size().value]

    # 1st-gen style call, kept for convenience
    def distance(self, units=MM) -> float:
        return self.object_distance(units)

    def changed(self, callback, arg=()) -> Event:
        self._rt.warn("Distance.changed is not simulated")
        return Event()


# ---------------------------------------------------------------------- Optical
_COLOR_BANDS = ((15, "RED"), (45, "ORANGE"), (70, "YELLOW"), (160, "GREEN"), (200, "CYAN"),
                (260, "BLUE"), (340, "PURPLE"), (360, "RED"))


class Optical(_Device):
    _kind = "optical"

    def set_light(self, state) -> None:
        if not self._ok:
            return
        if state == LedStateType.ON:
            pct = 100.0
        elif state == LedStateType.OFF:
            pct = 0.0
        else:
            pct = float(state)
        with self._rt.engine.lock:
            self._robot.optical_led = max(0.0, min(100.0, pct))

    def set_light_power(self, value, units=PERCENT) -> None:
        self.set_light(float(value))

    def object_detect_threshold(self, value) -> int:
        if not self._ok:
            return 0
        with self._rt.engine.lock:
            if value:
                self._robot.optical_threshold = max(0, min(255, int(value)))
            return self._robot.optical_threshold

    def _r(self) -> dict:
        self._rt.poll()
        with self._rt.engine.lock:
            return dict(self._robot.optical_reading)

    def brightness(self, readraw=False) -> float:
        if not self._ok:
            return 0.0
        b = self._r()["brightness"]
        return round(b * 10.23) if readraw else round(b, 2)

    def hue(self) -> float:
        return round(self._r()["hue"], 2) if self._ok else 0.0

    def rgb(self, raw=False):
        if not self._ok:
            return (0, 0, 0, 0)
        r = self._r()
        k = 1023 if raw else 255
        scale = r["brightness"] / 100.0 / max(r["lum"], 1e-6) if r["lum"] > 0 else 0.0
        return tuple(round(min(1.0, c * scale) * k) for c in r["rgb"]) + (round(r["brightness"]),)

    def color(self):
        if not self._ok:
            return Color.BLACK
        r = self._r()
        if r["brightness"] < 15:
            return Color.BLACK
        if r["sat"] < 0.25:
            return Color.WHITE
        h = r["hue"]
        for limit, name in _COLOR_BANDS:
            if h < limit:
                return getattr(Color, name)
        return Color.RED

    def is_near_object(self) -> bool:
        self._rt.poll()
        if not self._ok:
            return False
        with self._rt.engine.lock:
            return self._robot.optical_near

    def object_detected(self, callback, arg=()) -> Event:
        return self._register(self._robot.optical_events, "detected", callback, arg)

    def object_lost(self, callback, arg=()) -> Event:
        return self._register(self._robot.optical_events, "lost", callback, arg)

    def gesture_enable(self) -> None:
        self._rt.warn("Optical gestures are not simulated")

    def gesture_disable(self) -> None:
        pass


# ---------------------------------------------------------------------- Bumper (2nd gen)
class Bumper(_Device):
    _kind = "bumper"

    def pressing(self) -> int:
        self._rt.poll()
        if not self._ok:
            return 0
        with self._rt.engine.lock:
            return int(self._robot.bumper_pressed)

    def pressed(self, callback, arg=()) -> Event:
        return self._register(self._robot.bumper_events, "pressed", callback, arg)

    def released(self, callback, arg=()) -> Event:
        return self._register(self._robot.bumper_events, "released", callback, arg)


# ---------------------------------------------------------------------- Touch LED
class Touchled(_Device):
    _kind = "touchled"

    @property
    def _tl(self):
        return self._robot.touchled

    def pressing(self) -> int:
        self._rt.poll()
        if not self._ok:
            return 0
        with self._rt.engine.lock:
            return int(self._tl.pressed)

    def pressed(self, callback, arg=()) -> Event:
        return self._register(self._tl.events, "pressed", callback, arg)

    def released(self, callback, arg=()) -> Event:
        return self._register(self._tl.events, "released", callback, arg)

    def on(self, color=None, brightness=None) -> None:
        """Turn on at 100 % in ``color``, or in the most recently set colour (lab manual usage)."""
        if not self._ok:
            return
        with self._rt.engine.lock:
            if color is not None:
                self._tl.color = color_hex(color, self._tl.color)
            self._tl.brightness = 100 if brightness is None else max(0, min(100, int(brightness)))

    def off(self) -> None:
        if self._ok:
            with self._rt.engine.lock:
                self._tl.brightness = 0  # (does not stop blinking, as documented)

    def toggle(self) -> None:
        if self._ok:
            with self._rt.engine.lock:
                self._tl.brightness = 0 if self._tl.brightness > 0 else 100

    def set_color(self, color=None) -> None:
        if not self._ok:
            return
        with self._rt.engine.lock:
            if color is not None:
                c = color_hex(color, None)
                if c is None:  # Color.TRANSPARENT -> off
                    self._tl.brightness = 0
                    return
                self._tl.color = c
            self._tl.blink = None
            if self._tl.brightness == 0:
                self._tl.brightness = 100

    def set_fade(self, fade_type) -> None:
        if self._ok:
            with self._rt.engine.lock:
                self._tl.fade = fade_type.value if fade_type != FadeType.OFF else "off"

    def set_brightness(self, brightness) -> None:
        if not self._ok:
            return
        with self._rt.engine.lock:
            self._tl.brightness = max(0, min(100, int(brightness)))
            if self._tl.brightness == 0:
                self._tl.blink = None

    def set_blink(self, color=None, ontime=0.25, offtime=0.25) -> None:
        if not self._ok:
            return
        with self._rt.engine.lock:
            c = color_hex(color, self._tl.color) or self._tl.color
            self._tl.color = c
            self._tl.blink = (c, float(ontime), float(offtime))
            if self._tl.brightness == 0:
                self._tl.brightness = 100


# ---------------------------------------------------------------------- Inertial (brain IMU)
class Inertial:
    def __init__(self, port=None):
        self._rt = runtime()
        robot = self._rt.devices.get("robot")
        self._robot = robot
        self._ok = port is None and robot is not None
        if port is not None:
            self._rt.warn("Only the brain's built-in Inertial sensor is simulated: use Inertial() "
                          "without a port")

    @property
    def _ins(self):
        return self._robot.inertial

    def installed(self) -> bool:
        return self._ok

    def _calibrating(self) -> bool:
        return self._rt.engine.t < self._ins.calibrating_until

    # orientation
    def heading(self, units=DEGREES) -> float:
        self._rt.poll()
        if not self._ok:
            return 0.0
        with self._rt.engine.lock:
            h = 0.0 if self._calibrating() else self._ins.heading()
            if self._robot.realistic and not self._calibrating():
                h = (h + self._robot.rng.gauss(0.0, self._ins.cfg["noise_deg"])) % 360.0
        return round(deg_to(h, units), 2)

    def rotation(self, units=DEGREES) -> float:
        self._rt.poll()
        if not self._ok:
            return 0.0
        with self._rt.engine.lock:
            r = 0.0 if self._calibrating() else self._ins.rotation()
            if self._robot.realistic and not self._calibrating():
                r += self._robot.rng.gauss(0.0, self._ins.cfg["noise_deg"])
        return round(deg_to(r, units), 2)

    def calibrate(self) -> None:
        self._rt.check_stop()
        if not self._ok:
            return
        engine = self._rt.engine
        with engine.lock:
            until = engine.t + self._ins.cfg["calibrate_time"]
            self._ins.calibrating_until = until
            ins = self._ins

            def done():
                if ins.calibrating_until == until:
                    ins.head_zero = ins.rot_zero = ins.yaw_cw

            engine.schedule(self._ins.cfg["calibrate_time"], done)

    def is_calibrating(self) -> bool:
        self._rt.poll()
        return self._ok and self._calibrating()

    def wait_calibrated(self) -> None:
        if self._ok:
            self._rt.engine.wait_until(lambda: not self._calibrating())

    def set_heading(self, value, units=DEGREES) -> None:
        if self._ok:
            with self._rt.engine.lock:
                self._ins.head_zero = self._ins.yaw_cw - rot_deg(value, units)

    def set_rotation(self, value, units=DEGREES) -> None:
        if self._ok:
            with self._rt.engine.lock:
                self._ins.rot_zero = self._ins.yaw_cw - rot_deg(value, units)

    def reset_heading(self) -> None:
        self.set_heading(0)

    def reset_rotation(self) -> None:
        self.set_rotation(0)

    def changed(self, callback, arg=()) -> Event:
        robot = self._robot
        ins = self._ins
        rt = self._rt
        last = [ins.heading()]

        def check():  # engine-side poll every 20 ms
            if rt.stopped:
                return
            h = ins.heading()
            if abs(h - last[0]) > 0.5:
                last[0] = h
                rt.spawn_callback(callback, tuple(arg))
            rt.engine.schedule(0.02, check)

        rt.callbacks_registered += 1
        with rt.engine.lock:
            rt.engine.schedule(0.02, check)
        del robot
        return Event()

    # motion
    def acceleration(self, axis) -> float:
        self._rt.poll()
        if not self._ok:
            return 0.0
        with self._rt.engine.lock:
            ax, ay = self._ins.accel
        noise = self._robot.rng.gauss(0.0, 0.003) if self._robot.realistic else 0.0
        if axis == XAXIS:
            return round(ax + noise, 3)
        if axis == YAXIS:
            return round(ay + noise, 3)
        if axis == ZAXIS:
            return round(-1.0 + noise, 3)  # ESTIMATE sign: gravity reads -1 G on Z at rest
        raise ValueError("axis must be XAXIS, YAXIS or ZAXIS")

    def gyro_rate(self, axis, units=DPS) -> float:
        self._rt.poll()
        if not self._ok:
            return 0.0
        with self._rt.engine.lock:
            rate = self._ins.rate_cw if axis == ZAXIS else 0.0
        if units == RPM:
            return round(rate / 6.0, 3)
        if units == PERCENT:
            return round(rate / 1000.0 * 100.0, 3)
        return round(rate, 3)

    def orientation(self, axis, units=DEGREES) -> float:
        if axis in (OrientationType.ROLL, OrientationType.PITCH):
            self._rt.poll()
            return 0.0
        h = self.heading()
        return round(deg_to(h - 360.0 if h > 180 else h, units), 2)
