# Spec: VEX IQ (2nd gen) Python API (as simulated)

Sources:
- api.vex.com/iq2/home/python/: `Motion/Motor.html`, `Drivetrain.html`, `Sensing/{Brain,Distance,TouchLED,Bumper,Optical}.html`, `Inertial.html`, `Screen.html`, and `Logic/{Timer,Threads,Events,Color_objects}.html`.
- Captured 2026-11-18 and 2026-11-24.

Implementation: `backend/vexsim/api/iq2/`. Student code uses `from vex import *`.

## Project header
- VEXcode IQ projects start with a `#region VEXcode Generated Robot Configuration` block containing:
  - `import urandom`
  - the device constructors
  - a random-seed helper
- VS Code projects (`src/main.py`) have no configuration UI, so devices are declared by hand.
- The simulator supports:
  - `import urandom`: `seed`, `randint`, `random`, `uniform`, `choice`, `getrandbits`, `randrange`.
  - `sleep(ms, MSEC)`
  - `brain.timer.system()` and `brain.timer.system_high_res()`.

## Motor / MotorGroup
- **Constructors:**
  - `Motor(port, gears=GearSetting.RATIO_1_1, reverse=False)`.
  - `Motor(port, reverse)` and `Motor(port, 1.0, False)` (a float gear ratio, as VEXcode generates) are also accepted.
- **Velocity units:** default RPM for `spin`, `spin_for`, `spin_to_position`, `set_velocity` and `velocity()`. 100 % = 120 rpm = 720 dps. The default velocity is 50 %.
- **Stop modes:** `stop(mode)` defaults to the `set_stopping` mode, which defaults to BRAKE. HOLD keeps the shaft at its position.
- **`set_timeout`:** a blocking move gives up (and returns False) after the timeout.
- **Getters:**
  - `position(DEGREES|TURNS)`, `velocity`, `current`, `is_done`, `is_spinning`, `direction`.
  - `power`, `torque`, `efficiency`, `temperature` (always 25 °C), `get_timeout`, `installed`.
- **Port binding:** a device whose port has no matching device on the Build tab is "not installed".
  - `installed()` returns False, commands do nothing and getters return 0.
  - A one-time warning names the port.

## DriveTrain / SmartDrive
- **Signature:** `(lm, rm[, g], wheelTravel=300, trackWidth=320, wheelBase=320, units=MM, externalGearRatio=1.0)`.
- **Units constant anywhere:** a units constant may appear at any position. For example, the lab's `SmartDrive(l, r, g, 200, MM)` means wheelTravel 200 mm.
- **Units:**

  | Call | Default distance units | Default velocity units |
  |---|---|---|
  | `drive` | – | PERCENT |
  | `drive_for` | INCHES | RPM |
  | `turn` | – | RPM |
  | `turn_for` | DEGREES | RPM |
  | `turn_to_heading` / `turn_to_rotation` | DEGREES | PERCENT |

  Drive and turn velocities default to 50 %.
- **DriveTrain:**
  - `drive_for` and `turn_for` are encoder moves.
  - Turns use the *configured* track width, so a wrong track width gives wrong turns.
  - `heading()` and `rotation()` come from the encoders.
- **SmartDrive:**
  - Turns are closed-loop on the gyro. `set_turn_threshold` defaults to 1°, and `set_turn_constant` is the gain.
  - `drive` and `drive_for` are *not* gyro-guided. They are plain encoder moves, which matches the lab robots.
  - `heading()` and `rotation()` come from the gyro.
  - Gyro moves wait for any calibration in progress to finish.
- **Getters:** `is_moving`, `is_done`, `is_turning`, `velocity` (PERCENT), `current`, `power`, `torque`, `efficiency`, `temperature`.

## Sensors
- **Distance (2nd gen):**
  - `Distance(port)`. `Sonar` is an alias.
  - `object_distance(MM|INCHES|CM)` returns 9999 mm when nothing is in range.
  - `is_object_detected()` (within 1000 mm), `object_size()` (an `ObjectSizeType` value), `object_velocity()` (m/s), `installed()`.
- **Optical:**
  - `Optical(port)`.
  - `set_light(LedStateType.ON|OFF|ON|OFF|0-100)` and `set_light_power(v[, PERCENT])`.
  - `brightness(readraw=False)`, `hue()`, `rgb(raw=False)`.
  - `color()` returns one of BLACK, WHITE, RED, ORANGE, YELLOW, GREEN, CYAN, BLUE or PURPLE.
  - `is_near_object()`, `object_detect_threshold(v)`, and `object_detected` / `object_lost` callbacks.
  - Gestures are not simulated.
- **Bumper (2nd gen):** `pressing()` returns the int 1 or 0. `pressed` / `released` callbacks.
- **Touchled:**
  - `pressing()` returns the int 1 or 0. `pressed` / `released` callbacks.
  - `on(color=None)`, `off()`, `toggle()`, `set_color`, `set_brightness`, `set_fade`, `set_blink(color, 0.25, 0.25)`.
  - `off()` does not stop blinking; `set_brightness(0)` does.
- **Inertial:**
  - `Inertial()` is the brain's built-in IMU. A port means an external IMU, which is not simulated.
  - `heading`, `rotation`, `calibrate` (non-blocking, 2 s, then heading and rotation are 0), `is_calibrating`.
  - `set_heading`, `set_rotation`, `reset_heading`, `reset_rotation`, `changed(cb)`.
  - `acceleration(XAXIS|YAXIS|ZAXIS)`: Z is −1 G at rest (ESTIMATE). `gyro_rate(ZAXIS, DPS)`. `orientation(YAW)` runs from −180 to 180; ROLL and PITCH are 0.

## Brain
- **Buttons:** `brain.buttonCheck`, `buttonLeft` and `buttonRight`, each with `pressing()` (a bool) and `pressed` / `released` callbacks. X is the system's stop and back button.
- **Battery:** `brain.battery.capacity()`, `voltage(MV|VOLT)` (7.0 to 8.0 V), `current()`.
- **Timer:** `brain.timer` with `time(MSEC|SECONDS)`, `clear()`, `event(cb, ms)`, `system()`, `system_high_res()`. Plus `Timer()`.
- **Sound:** `brain.play_sound(SoundType.X)` prints a note in the console. Notes are silent.
- **`brain.screen` (160×108 px, colour):**
  - The default font is MONO20. The screen is light: the pen is black on a white background (ESTIMATE, consistent with the light theme in the KB captures).
  - `print(*args, precision=2, opaque=False)`: floats print with 2 decimals, and args are separated by a space (ESTIMATE).
  - Cursor: `set_cursor(row, col)`, `next_row()`, `row()`, `column()`. Text that runs past the edge is clipped, not wrapped.
  - **`clear_screen(color)` does not move the cursor** (confirmed by the user on the real brain).
  - Also: `clear_row`, `print_at(x=, y=)`, `set_font(FontType.*)`, `set_pen_color`, `set_fill_color`, `set_pen_width`, `set_origin`, `draw_pixel` / `line` / `rectangle` / `circle`, `set_clip_region`, `render()` (double buffering), `get_string_width` / `height`.
  - Rows and columns per font: MONO12 26×9, MONO15 20×7, MONO20 16×5, MONO30 10×3, MONO40 8×2, MONO60 5×1, PROP20 26×5, PROP30 18×3, PROP40 14×2.

## Logic
- `wait(t, MSEC|SECONDS)` and `sleep(t, MSEC)` use sim time.
- `Thread(fn)` and `.stop()`.
- `Event()`: `e(cb)`, `broadcast()`, `broadcast_and_wait()`.
- `Color`: `Color(0xRRGGBB)`, `Color("#RRGGBB")`, `Color(r, g, b)`, `.rgb()`, `.hsv()`, `.web()`, plus named constants.

## Program lifecycle
- A project ends when its code returns and no callbacks are registered. All motors then brake.
- Stop (X on the brain, or Stop in VS Code) ends the threads and brakes the motors.
- The scene persists across runs: the robot stays where it is, as on a real robot.
