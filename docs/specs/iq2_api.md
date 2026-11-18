# Spec: VEX IQ (2nd gen) Python API (Phase 2, partial capture)

Sources:
- https://api.vex.com/iq2/home/python/Drivetrain.html
- https://api.vex.com/iq2/home/python/Motion/Motor.html
- https://api.vex.com/iq2/home/python/Inertial.html
- https://api.vex.com/iq2/home/python/Sensing/TouchLED.html
- https://api.vex.com/iq2/home/python/Sensing/Optical.html

Captured on 2026-11-18. **Before starting Phase 2, capture the rest of the pages:** Brain/Screen, Bumper, Distance, Gyro, Controller, Pneumatics, AI Vision.

## Brain
- 12 Smart Ports.
- Built-in inertial sensor, available as `BrainInertial`.
- Screen, buttons, battery.
- Default template: `brain = Brain()`, `brain_inertial = Inertial()`.

## Motor
- **Constructors**
  - `Motor(port, gears=GearSetting.RATIO_1_1, reverse=False)`
  - `MotorGroup(m1, m2, ...)`
- **Actions**
  - `spin(dir, velocity, units)`
  - `spin_for(dir, angle, units=DEGREES, velocity, units_v=RPM, wait=True)`
  - `spin_to_position(rot, units, velocity, units_v, wait=True)`
  - `stop(mode=BRAKE)`
- **Mutators**
  - `set_velocity(v, units)`: default 50%.
  - `set_max_torque(v, units)`: default 50%.
  - `set_position(p, units)`, `set_stopping(mode)`, `set_timeout(v, units=MSEC)`, `set_reversed(b)`, `reset_position()`.
- **Getters**
  - `position(units=DEGREES)`, `velocity(units=RPM)`.
  - `current()`: 0 to 1.2 A.
  - `is_done()`, `is_spinning()`, `direction()`.
  - `power()`, `torque()`, `efficiency()`, `temperature()`, `get_timeout()`.
  - `count()` (MotorGroup only).

## Drivetrain
- **Constructors** (defaults: wheelTravel=300 mm, trackWidth=320 mm, wheelBase=320 mm, units=MM, externalGearRatio=1.0)
  - `DriveTrain(lm, rm, wheelTravel, trackWidth, wheelBase, units, externalGearRatio)`
  - `SmartDrive(lm, rm, gyro_or_inertial, wheelTravel, trackWidth, wheelBase, units, externalGearRatio)`
- **Actions**
  - `drive(dir, velocity, units=PERCENT)`
  - `drive_for(dir, distance, units=INCHES, velocity, units_v=RPM, wait=True)`
  - `turn(dir, velocity, units)`
  - `turn_for(dir, angle, units=DEGREES, velocity, units_v, wait=True)`
  - `turn_to_heading(angle, units=DEGREES, velocity, units_v=PERCENT, wait=True)`
  - `turn_to_rotation(...)`
  - `stop(mode=BRAKE)`
  - `calibrate_drivetrain()`
- **Mutators**
  - `set_drive_velocity(v, units=PERCENT)`, `set_turn_velocity(v, units=PERCENT)`: both default to 50%.
  - `set_stopping`, `set_timeout`, `set_heading`, `set_rotation`.
  - `set_turn_threshold(deg=1)`, `set_turn_constant(0.1–4.0, default 1.0)`.
- **Getters**
  - `heading(units=DEGREES)`: 0–359.
  - `rotation()`, `velocity()`, `current()`.
  - `is_moving()`, `is_done()`, `is_turning()`.
  - `power()`, `torque()`, `efficiency()`, `temperature()`.

## Sensors (to capture)
- **TouchLED:** `set_color`, `set_fade`, `set_brightness`, `set_blink`, `pressed` / `released` events, `pressing()`, `installed()`.
- **Inertial:** `heading`, `rotation`, `orientation(ROLL|PITCH|YAW)`, `gyro_rate`, `acceleration`, `calibrate`, `set_heading`, `set_rotation`.
- **Optical:** `color()`, `brightness()`, `hue()`, `is_near_object()`, `set_light`, `object_detected` / `object_lost` events.
- **Distance, Bumper, Gyro, Controller, Pneumatic, AiVision:** still to capture.

## Constants
- Direction: `FORWARD`, `REVERSE`, `LEFT`, `RIGHT`.
- Distance: `MM`, `INCHES`, `DistanceUnits.CM`.
- Velocity: `PERCENT`, `RPM`, `VelocityUnits.DPS`.
- Angle: `DEGREES`, `TURNS`.
- Stopping: `BRAKE`, `COAST`, `HOLD`.
- Time: `MSEC`, `SECONDS`.
- Other: `TorqueUnits.*`, `CurrentUnits.AMP`, `TemperatureUnits.*`, `GearSetting.RATIO_*`.
