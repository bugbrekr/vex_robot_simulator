# VEX Simulator

A browser-based simulator for VEX robots. Students write **VEXcode-compatible Python** (`from vex import *`), and it runs against a simulated robot.

- **Phase 1 (current):** VEX CTE 6-Axis Arm on a CTE Tile, with the Signal Tower and 25 mm AprilTag cubes.
- **Phase 2 (planned):** VEX IQ (2nd gen) robot.

## Quick start

```bash
uv sync                                  # Python deps (backend)
(cd frontend && npm install && npm run build)
uv run vexsim serve                      # http://127.0.0.1:8000/vex_cte/
```

For frontend development with hot reload, run `uv run vexsim serve` in one terminal and `cd frontend && npm run dev` in another, then open http://localhost:5173/vex_cte/. Vite proxies `/vex_cte/api` and `/vex_cte/ws` to the backend.

Run a program headless, for tests or grading:

```bash
uv run vexsim run backend/vexsim/examples/cte/pick_place.py --scenario cte_tile
uv run vexsim run my_program.py --scenario whiteboard --json
uv run pytest
```

## Hosting behind nginx

Everything is served under one path, `/vex_cte/` by default (change it with `--base-path` or `VEXSIM_BASE_PATH`):
- the page at `/vex_cte/`
- the REST API at `/vex_cte/api/...`
- the WebSocket at `/vex_cte/ws/cte`

The frontend uses only relative URLs, so nginx can put any prefix in front, for example `https://host/robotics/sim/vex_cte/`.
- `deploy/nginx-vexsim.conf` has the `location` blocks, including the WebSocket upgrade and a long read timeout.
- `deploy/vexsim.service` is a hardened systemd unit for the backend, bound to `127.0.0.1:8000`.

> ⚠️ The simulator executes the Python that users type **on the server**. On a shared server, turn on the **Docker sandbox** (`vexsim serve --sandbox docker`). Each session's code then runs in its own throw-away container with no network, a read-only filesystem, no capabilities, an unprivileged user and CPU/memory/process limits. Use **rootless Docker** for that: see [docs/sandbox.md](docs/sandbox.md), which also covers `deploy/vexsim-user.service`. Restricting access in nginx (LAN only and/or `auth_basic`) is still a good idea.

## What's simulated

| Area | Status |
|---|---|
| Arm API: `move_to`/`inc`, `move_end_effector_to`/`inc`, speed, timeout, control stop, `can_*_reach`, getters, callbacks | ✅ Matches api.vex.com signatures |
| Kinematics | Analytic 6-DOF IK/FK, joint limits, floor and base keep-out, about 330 mm reach |
| Motion | Straight-line Cartesian moves with trapezoidal speed profile, joint-space fallback, joint-speed limits |
| Magnet tool | Picks the cube under the tool, carries it, and drops it onto the Tile or a stack. Crash detection |
| Pen tool | `set_pen_offset`. Draws on the Tile when the tip touches z = 0 |
| Signal Tower | `set_color`, `set_colors`, ON/OFF/BLINK, clickable bumper with `pressed`/`released`/`pressing` |
| Runtime | `wait`, `Brain` timer (`timer_time`, `timer_reset`, `timer_event`), `Thread`, `Event`, `print`, `brain.program_stop` |
| UI | VEXcode-style IDE: blue toolbar (ARM / RUN / STEP / STOP / SHARE / SAVE), File/Edit/Tools/Help menus, project name + autosave, Python editor + Print Console, 3D simulation pane, collapsible side panel |
| Teach Pendant | Move to Safe Position (unlocks pendant), Enable Manual Mode (**drag the arm with the mouse**, Shift = up/down), status bar, X/Y/Z dashboard, arm + end-effector jogging, increments, Move To, Magnet engage/release, units mm/in, speed, end effector, pen offset, "Add move_to to code" |
| Monitor / Help | Live device values, Signal Tower with clickable bumper; Python quick reference |
| Maps | **CTE Tile** (3 cubes) and **Whiteboard** (Dry-Erase Surface). A map only changes the base: the mounted tool is kept across map changes / resets. Examples live in File ▸ Load Example |
| Persistent scene | Arm pose, mounted tool, cubes, drawings and tower LEDs survive Run / Stop / Manual Mode. Each Run resets VEX's per-project defaults (speed 50 %, MAGNET, pen offset 0, magnet off), then **homes to the safe position** before the code starts |
| Safe-position rules | Manual Mode and end-effector swaps are only allowed at the safe position (120, 0, 100) |
| Manual Mode | Motors power down: like the real arm, the links **slowly sink and settle** (overdamped gearbox back-drive: J2 leans back, the elbow folds to its mechanical stop just short of the shoulder housing, and the arm settles on its stops). The tool, wrist and forearm collide with cubes, so you can rest the tool on a cube top. Drag it by the tool tip; **keep tool vertical** (V, default on with the pen) holds the tool perpendicular to the board. **C** copies the tip x, y, z, **M** inserts `arm.move_to(x, y, z)` into the code - also while holding the arm |
| Tools | Mounted tool (physical) is separate from the configured end effector (code). IK targets the configured tip; the real tip (magnet face / marker tip, offset 22 mm sideways in its C-clamp) is what touches things. Hints are shown when they disagree |
| Cubes | Ferromagnetic 25 mm cubes (rounded edges) with blue-white tag36h11 AprilTags. They **fall under gravity** when released (magnet off, dropped by hand, support removed). Drag in from the Simulation panel, drag around (stacking), drag off the tile to delete, at any time |
| Pen | The marker only leaves ink on the whiteboard sheet - not on the bare Tile or off the Tile |
| Simulation panel (not VEXcode) | Object tray, delete all, pause, snap arm to safe, erase whiteboard, reset simulation, mounted tool + marker length, appearance (lighting, table, quality, arm/cube colours, overlays, shadows, trail, cables) |

Hardware numbers and their confidence (REAL / MEASURED / ESTIMATE) are in [docs/specs/](docs/specs/). Tune the arm in [`geometry.yaml`](backend/vexsim/robots/cte_arm/geometry.yaml).

## Layout

```
backend/vexsim/
  core/        robot-agnostic engine: sim clock, fixed-step loop, world, transforms, config
  robots/      physical models (no VEX API knowledge)
    cte_arm/   geometry.yaml, kinematics, trajectory planner, ArmModel, magnet/pen, signal tower, tile, cubes
    iq2/       (phase 2)
  api/         student-facing VEXcode facade, installed as the `vex` module
    common/    Brain, wait, Thread, Event, constants, runtime glue
    cte/       Arm, SignalTower
  runner/      worker process (scene + student threads), JSON-lines protocol
  server/      FastAPI: REST scenarios + /ws/{platform} session relay
  scenarios/   YAML maps (cte_tile, whiteboard)
  examples/    example projects + index.yaml (File > Load Example)
frontend/      Vite + TypeScript + three.js + CodeMirror
docs/specs/    API and hardware spec sheets (reference while building)
tests/         pytest suite
```

See [docs/architecture.md](docs/architecture.md) for how the pieces talk to each other and how to add a robot.
