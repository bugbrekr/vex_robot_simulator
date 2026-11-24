# Architecture

```
Browser (Vite + TS)                     Python backend
┌──────────────────────────┐  WS JSON   ┌─────────────────────────────────────────┐
│ CodeMirror editor        │ ─────────▶ │ FastAPI server (Session per socket)     │
│ three.js viewport        │ ◀───────── │   └─ spawns a worker subprocess per run │
│ Console / tower / jog    │  frames    │        ├─ SimEngine (fixed dt = 10 ms)  │
└──────────────────────────┘            │        └─ student code on threads,      │
                                        │           `vex` module -> models        │
                                        └─────────────────────────────────────────┘
```

## Layers (dependencies point downward only)
1. **`core/`**: `SimEngine`, `Entity`, `World`, transforms, config. Knows nothing about VEX.
2. **`robots/<robot>/`**: physical models as `Entity` subclasses: state, `step(t, dt)`, `snapshot()` and `describe()`. Robot-specific, but independent of the API.
3. **`api/<platform>/`**: thin VEXcode-shaped classes. They call model methods while holding `engine.lock`, and block on sim time through `engine.wait_until`.
4. **`runner/worker.py`**: builds the scene from a scenario, installs `sys.modules["vex"] = vexsim.api.<platform>`, runs the student code on a `StudentThread`, and drives the engine loop.
5. **`server/`**: process management and message relay only.

## Time and determinism
- The sim clock advances in fixed 10 ms steps. Every student-visible time (`wait`, timers, move durations) is sim time.
- **Real-time mode** (speed > 0): steps are paced to wall time × speed.
- **Fast mode** (speed = 0, headless): *lockstep*. The engine steps only when every live student thread is blocked on sim time and none is about to wake, or when a thread is busy-polling a getter (`is_done()`, `get_x()` and so on call `runtime.poll()`). This makes runs deterministic and lets the tests assert exact timings.
- **Stop:** `Runtime.stop_all()` sets a flag that every API call checks, and also injects `ProgramStopped` into the project's student threads.
- **One persistent worker per session:** **Run** creates a fresh `Runtime` inside the same worker, so the scene persists. Only **Reset** and map changes start a new worker process.
- **`runtime()` is per thread:** it returns the calling thread's Runtime, so leftover threads from a stopped project can't touch the next one.
- **`time.sleep`:** inside student threads it is patched to wait in sim time.

## Protocol
JSON lines. See `backend/vexsim/runner/protocol.py`, mirrored in `frontend/src/net/protocol.ts`.
- `hello` carries the static scene: the Tile, arm geometry, objects and tower position. The frontend builds meshes from it, so visuals always match `geometry.yaml`.
- `frame` arrives at about 30 Hz and carries:
  - joint angles, plus per-link FK frames (position and quaternion). The frontend never does kinematics itself.
  - TCP position and orientation.
  - object poses.
  - LED states.
  - new pen points.

## Arm conventions
- Coordinates are in mm, with the origin at the centre of the arm base. z=0 is the Tile top, and +X points to the front.
- **Tile locations:** location n sits at `((n-1)//6 - 1)*50, ((n-1)%6 - 1)*50`.
- **End-effector orientation:** `R = Rz(yaw) Ry(pitch) Rx(roll)`. (0,0,0) means the tool points straight down, facing +X. *This is our convention; check it against real hardware.*
- **XYZ moves** hold the current world orientation.
- **Unreachable targets** return False and print a sim warning. Reachability is checked with joint limits, the floor, and the base keep-out zones.

## IQ (2nd gen)
- **Robot model:** `robots/iq2/`.
  - `IQRobotModel`: the differential drive (front motors, rear omnis), collisions against field obstacles, and every sensor.
  - `BrainModel`: the screen, kept as a display list of drawing ops.
  - `Field`: the floor, tape lines and obstacles.
  - All dimensions are in `geometry.yaml`.
- **Port binding:** the API (`api/iq2/`) binds `Motor(Ports.PORT6)` and similar calls to whatever device the Build tab's config puts on that port.
  - Config message: `robot_config`, which sets each device's enabled flag and port.
- **Closed-loop SmartDrive moves:** these run as *controllers* that the robot model steps on the engine thread (`robot.add_controller`).
- **Frames:** each frame carries `robot` (pose, wheels, sensor readings) and `brain` (buttons, battery, and the screen ops added since the last frame).
- **Other commands:** `brain_button`, `touch`, `bumper`, `place_robot`, `reset_robot` and `realism`.
- **Frontend:** a second Vite page, `frontend/iq2/index.html`, served at `<base>/iq2/`. Same server and WebSocket path (`ws/iq2`), so deployment is unchanged. It has three tabs:
  - Build (`buildTab.ts`)
  - Code: a VS Code look-alike (`codeTab.ts`)
  - Simulator (`simTab.ts`)

  The brain's own menus (`brainOS.ts`) and the brain slots run in the browser. A slot's code is sent to the worker with `run`.

## Adding a robot
1. Add `robots/iq2/` with `Entity` models (drivetrain, motors, sensors) and a `scene.py` `build_scene()`.
2. Add `api/iq2/` with VEXcode classes that reuse `api/common` (Brain, wait, Thread, Event).
3. Register the platform in `runner/worker.py::build_platform`, and add scenarios under `scenarios/iq2/`.
4. Frontend: add scene views for the new entity kinds. The session and editor are already parameterised by platform.
