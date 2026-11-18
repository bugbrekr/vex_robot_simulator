# Spec: CTE 6-Axis Arm hardware, Tile and objects

Confidence tags:
- **REAL**: official VEX source.
- **MEASURED**: community measurement.
- **ESTIMATE**: a guess. Tune it in `backend/vexsim/robots/cte_arm/geometry.yaml`.

Sources:
- [L3] https://education.vex.com/stemlabs/cte/introduction-to-the-6-axis-arm/introduction-to-robotic-arms/lesson-3-the-coordinate-system-of-the-6-axis-arm
- [KIT] https://kb.vex.com/hc/en-us/articles/27339074776980-Overview-of-the-CTE-Workcell-Kit
- [KB-T] https://kb.vex.com/hc/en-us/articles/32138274956308-Troubleshooting-the-CTE-6-Axis-Arm
- [GH] https://github.com/gabriel975/VEX6AxisArmSimulator (community, `js/arm_config.js`)
- [RET] retailer listings (335 mm reach, 638×333 platform)

## Coordinate system [L3, REAL]
- The origin is the centre of the arm base. z=0 is the Tile surface, and z points up. Units are mm.
- +X runs away from the base, toward the Tile's front edge (locations 31–36).
- +Y runs toward location 6, the Signal Tower side [GH].
- **Tile locations:** a 6×6 grid of 50 mm squares numbered 1–36 row by row. The arm base sits at **location 8**.
  - `row = (n-1)//6`, `col = (n-1)%6`
  - `x = (row-1)*50`, `y = (col-1)*50`
  - Check: location 36 → (200, 200, 0), matching [L3]. Location 8 → (0, 0). Location 1 → (-50, -50).
  - x and y each span -50 to 200 [L3].

## Tile [GH / KIT]

| Item | Value | Tag |
|---|---|---|
| Tile size | 333 × 333 mm | REAL |
| Tile height (top surface above the floor) | 28 mm | MEASURED. In the sim, the Tile top is z=0 |
| Grid | 6×6 cells of 50 mm. Border is about 16.5 mm | REAL / DERIVED |
| Mounting holes | 2×2 clusters, 12.5 mm apart, at cell corners and centres. Ø4.2 | ESTIMATE |
| Workcell (2 tiles) | 333 × 638 mm | REAL |

## Arm geometry [GH unless noted]

| Item | Value | Tag |
|---|---|---|
| Advertised max reach | 335 mm | REAL [RET] |
| J2 (shoulder) height above the Tile | 84.0 mm | MEASURED |
| J2 offset forward of the J1 axis | 20.5 mm | MEASURED |
| Upper arm, J2→J3 | 133.0 mm | MEASURED |
| Forearm, J3→J5 along its length | 174.0 mm | MEASURED |
| Forearm offset above the elbow axis | 28.0 mm | MEASURED |
| Wrist (J5) → tool flange | 13.0 mm | MEASURED |
| Magnet tool, flange → TCP | 38.5 mm | MEASURED |
| Pen tip along the tool axis = **pen offset**, measured from where the holder connects | default 0; about 23 mm for the kit marker | REAL (VEX API / KB) |
| Pen marker axis, sideways from the tool axis (toward ee +x) | 22 mm | ESTIMATE (traced from the STEM Labs Unit 4 render) |
| Marker body | Ø18 × 120 mm, black cap, chisel tip | ESTIMATE |
| Base flange | Ø138 mm, 13 mm tall | MEASURED |
| Base body | Ø104 mm, up to 47 mm | MEASURED |
| Turret | Ø86 mm | MEASURED |

Zero pose: the upper arm points straight up, and the forearm and tool point forward (+X).

## Joints

| Joint | Function | Limits (°) | Max speed at 100% (°/s) | Tag |
|---|---|---|---|---|
| J1 | Base yaw (about z) | −170 … 170 | 90 | ESTIMATE |
| J2 | Shoulder pitch | −90 … 90 | 75 | ESTIMATE |
| J3 | Elbow pitch | −90 … 70 | 90 | ESTIMATE |
| J4 | Wrist roll (about the forearm) | −150 … 150 | 150 | ESTIMATE |
| J5 | Wrist pitch | −120 … 120 | 150 | ESTIMATE |
| J6 | Tool roll | −180 … 180 | 180 | ESTIMATE |

- Max linear TCP speed at 100%: 200 mm/s (ESTIMATE). Default speed is 50% (REAL).
- Accuracy: about 1–2 mm (REAL [KB-T]).
- Safe position: (120, 0, 100) (REAL per [GH]).
- Keep-out zones (DERIVED): cylinder r73 h59 (flange and body), cylinder r49 h104 (turret).

## End effectors [KIT]
- **Magnet Pickup Tool**: picks up Disks and Cubes.
- **Pen Holder Tool**: holds a dry-erase marker that draws on the Dry-Erase Surface.

## Kit objects [KIT]
- Disks: 5 red (AprilTags 0–4) and 5 green (AprilTags 10–14). Dimensions unknown.
- Cubes: 9 blue (AprilTags 20–28).
- Pallets: 2.

### Simulator v1 objects (user decision)
- **3 blue cubes, 25 mm per side**, with AprilTag IDs 20, 21 and 22.
- One face (the top, +z, by default) carries an AprilTag-style tag36h11 marker.
- Disks and pallets are not modelled yet.

## Other kit hardware (later phases)
- EXP Brain and battery.
- 3 Smart Motors (5.5 W).
- Distance Sensor, Optical Sensor, Object Sensor (3-wire).
- Pneumatics: pump, 70 mL tank, solenoid, cylinders.
- Linear and Serpentine conveyors, Disk Feeder and Loader, Diverter.

## End-effector geometry used for IK
- **TCP = tip of the tool.** For the magnet that is the contact face, at flange + 38.5 mm. For the pen it is the marker tip, at flange + pen offset along the tool axis, plus 22 mm sideways.
- **Two separate tools in the sim:**
  - The **mounted** tool is physical. It changes only at the safe position.
  - The **configured** tool is what software sets with `set_end_effector_type` / `set_pen_offset`, which reset to MAGNET / 0 at each project start.
  - IK positions the configured TCP. Contact (magnet pickup, drawing, crash detection) uses the mounted tool's real tip.
- **Pen holder look (STEM Labs render):** a dark-grey bracket under the J5 wrist block, with two flat C-jaws clamping a white marker. The marker's black cap points back past the wrist.
