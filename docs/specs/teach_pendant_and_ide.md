# Spec: Teach Pendant, VEXcode IDE look, and Dry-Erase Surface

Sources (captured 2026-11-18):
- KB "Using the Teach Pendant with the 6-Axis Arm": https://kb.vex.com/hc/en-us/articles/27274957624852
- STEM Labs Unit 1 Lesson 4 (manual movements): https://education.vex.com/stemlabs/cte/introduction-to-the-6-axis-arm/introduction-to-robotic-arms/lesson-4-understanding-manual-movements-of-the-robotic-arm
- STEM Labs Unit 4 Lesson 1 (using the pen): https://education.vex.com/stemlabs/cte/introduction-to-the-6-axis-arm/controlling-the-path/lesson-1-using-the-pen
- Forum post with the "Failed to move to safe position: controlled stop enable" error: https://plc.pd.vex.com/t/vex-cte-6-axis-robotic-arm-difficulties/1625

## Teach Pendant (VEXcode EXP)
- **Opening it:** the Teach Pendant icon sits on the toolbar between Monitor and Help. The device icon (ARM) turns green when the arm is connected.
- **Top row:**
  - **Move to Safe Position** goes to about (120, 0, 100) and *unlocks the other features*.
  - **Enable Manual Mode** lets you move the arm by hand. While it is on, jogging is disabled.
- **Status bar messages:**
  - "Click 'Move to Safe Position' to continue"
  - "Manual Mode Enabled"
  - Error: "Failed to move to safe position: controlled stop enable[d]"
- **Dashboard:** X / Y / Z of the TCP, updated live, shown as `120 mm`.
- **Add 'Move To' Block to Workspace:** Blocks only. The sim offers "Add 'move_to' to Code" instead, which inserts a Python line.
- **Arm Jogging:** +X/+Y/+Z on the top row, -X/-Y/-Z on the bottom row. **Jogging Increment** defaults to 10 mm.
- **Move To:** X / Y / Z inputs.
- **Magnet:** Engage / Release.
- **Settings:**
  - Units: mm or inches. This also changes the jog increments.
  - Speed.
  - End Effector.
  - Pen Offset.
- **Sim extras, not on the real pendant:** End Effector Jogging (yaw, roll, pitch), and mouse drag in Manual Mode (Shift + drag moves along z).

## Colours, sampled from VEXcode screenshots

| Element | Hex |
|---|---|
| Toolbar | `#4d90f0` |
| Disabled toolbar icon | `#a6c8f8` |
| Panel icon strip | `#92bcec` |
| Pendant header | `#2960b0` |
| Panel body | `#1f4d8a` |
| Header icon tiles | `#3674c9` (active: `#edf2f8`) |
| Primary button | `#3478b3` |
| Disabled button | `#dedbdb` |
| Section header | `#dadada` |
| Jog button | `#eeecec` |
| Card border | `#cccccc` |

**Toolbar order:** ARM (device) | RUN, STEP, STOP | SHARE, FEEDBACK. In the sim, FEEDBACK is replaced by SAVE (download the .py file).

## Dry-Erase Surface (whiteboard)
- A white sheet laid on the Tile.
- **Cut-outs:** a rounded cut-out around the arm's dark base plate, and a notch at the Signal Tower corner.
- **Screws:** black screws hold it at the corners.
- **Source:** traced from VEX's top-down render. The outline lives in `backend/vexsim/robots/cte_arm/tile.py` (`WHITEBOARD`), with every value an ESTIMATE (±3 mm).
- **Bounds:** x ∈ [-66, 214], y ∈ [-64, 216].
  - Base cut-out: x < 86 and y < 89, with a 57 mm corner radius.
  - Tower notch: x < -25 and y > 175.
- **Drawing:** the pen draws with the tip at z = 0. The Unit 4 example draws from (150, 50, 0) to (50, 150, 0).
- **Real hardware:**
  - The arm is a white shell with dark-grey wrist and joints, on a charcoal base with a dark base plate (Ø about 178 mm).
  - The Signal Tower has a red bumper cap, then red, yellow, green, blue and white from top to bottom.

## Simulator behaviour rules (user decisions, 2026-11-18)
- **The scene persists** across Run, Stop and mode changes. Only "Reset simulation" or a map change reloads it.
- **Run:** before the code starts, the arm goes to the safe position. Project defaults reset first: speed 50, MAGNET, pen offset 0, magnet off, callbacks cleared.
- **Safe-position requirements:**
  - **Enable Manual Mode** only works when the arm is *at* the safe position: TCP within 2 mm and orientation within 3°.
  - **End effector** changes (from the pendant or the simulation panel) also need the safe position. The arm re-homes afterwards so the new TCP sits at the safe point.
- **Manual Mode:** the joint motors power down over about 0.8 s. J2, J3 and J5 then sag under gravity until the links or tool rest on the tile or base. Dragging pulls the real tool tip with position-only DLS IK over J1, J2, J3 and J5. On release the arm sags again.
- **Magnet buttons** work whenever the pendant is active, including in Manual Mode, if the magnet is mounted.
- **Simulator-only controls** live in the orange "Simulation" panel, which is not part of VEXcode.

## Round-3 rules (2026-11-18)
- A **map only changes the base** (Tile, or Tile plus whiteboard, and its objects). The mounted tool and marker length carry over across map changes and resets.
- The **marker leaves ink only on the Dry-Erase Surface**, as given by `point_on_whiteboard`. The bare Tile and anything off the Tile take none.
- **Manual Mode slump** (user-confirmed real-arm behaviour, 2026-11-18): the motion is overdamped, with no toppling and no momentum.
  - Joint speed = (gravity torque − friction) / gearbox damping. The drives power down over 0.6 s.
  - The heavy elbow housing (J3/J4 drives) sits behind the shoulder, so **J2 leans further back** while the elbow folds.
  - The elbow stops at its **mechanical stop of 80°**, just before the forearm would touch the shoulder housing (contact is at about 85°).
  - The arm settles on its joint stops with the **tool hanging in the air**, after about 8 s.
  - Constants: top of `robots/cte_arm/arm.py`.
- **Arm–cube contact:**
  - The tool (31 mm magnet block, or marker barrel plus bracket), the wrist block and the forearm are capsules; the tool tip is a point.
  - They can't enter a resting cube during manual drags (limp or upright), during the slump, or while carrying a cube. They *can* touch faces, so the tool rests on a cube's top.
  - Drags advance in steps of at most 3 mm, so a fast mouse can't tunnel through a cube.
  - During programmed moves the same contact counts as a crash (3 mm tolerance).
- **Tile:**
  - 2×2 hole clusters sit at every cell corner, and the outer ones form the frame's hole pairs.
  - The cell borders are drawn as a separate dotted line on each cell edge between clusters, not as a continuous grid.
- **Keep tool vertical** (V): Manual-Mode dragging uses orientation-locked IK on the real tip (tool straight down, yaw kept). It is on by default when the pen is mounted.
- **Hotkeys** (outside text fields): **C** copies the tip x, y, z; **M** inserts `arm.move_to(x, y, z)`. With no cursor placed yet, the line goes at the end of the file.
- **Cubes** fall under gravity, landing on the tile or the highest cube below. A project counts as finished only once cubes have settled.
- **Tile look:** light-grey deck. Separate frame pieces join with jigsaw seams and corner clip pieces. Clip feet sit at the corners and mid-sides, with recessed spans between. Holes are black pairs and 2×2 clusters.
- **Location numbers** are rotated so they read upright when +X points down, as in VEX diagrams.
- **Base plate:** Ø170 mm. Bolts sit at the location 1/3/13/15 corners, with "X +" and "Y +" arrows printed on it. The joints are labelled J1–J6 with rotation arrows.
