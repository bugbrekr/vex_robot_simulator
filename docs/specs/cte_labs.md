# Spec: CTE lab-manual experiments

Source: the user's lab manual, pages 31–47, supplied as a PDF in `docs/research/` (local only, not committed).

The programs live in `backend/vexsim/examples/cte/labs/`. They are listed in `examples/cte/index.yaml` with `group: Lab Programs`, which puts them under **File ▸ Lab Programs** in the CTE app. Loading one also switches to its map.

| Menu entry | File | Map | Tool |
|---|---|---|---|
| Exp 3.1: Polygon (absolute) | `exp03_polygon_absolute.py` | Whiteboard | pen |
| Exp 3.2: Polygon (relative) | `exp03_polygon_relative.py` | Whiteboard | pen |
| Exp 3.3: Rhombus (absolute) | `exp03_rhombus_absolute.py` | Whiteboard | pen |
| Exp 3.4: Rhombus (relative) | `exp03_rhombus_relative.py` | Whiteboard | pen |
| Exp 4: Palletizing and stacking | `exp04_palletizing.py` | `exp4_palletizing`: a cube in block 17 | magnet |
| Exp 6.1: Teach Pendant transfer | `exp06a_teach_pendant_transfer.py` | `exp6a_transfer`: a cube at (150, −50), cell 25 | magnet |
| Exp 6.2: Around two cube walls | `exp06b_obstacle_avoidance.py` | `exp6b_cube_walls`: a cube at cell 3, walls on cells 13–16 and 27–30 | magnet |

The manual prints only `def main()` for Exp 3. Each file therefore gets the standard VEXcode CTE header (`from cte import *`, `brain`, `arm`, `signal_tower`, `wait(100, MSEC)`) and ends with `cte_thread(main)`.

## Results in the simulator
- **Exp 3:** all four programs draw their shapes on the whiteboard with no warnings. The polygon is one stroke; the rhombus is three strokes (outline and two diagonals).
- **Exp 4:** the cube ends in block 29 at (150, 150).
- **Exp 6.1:** the cube ends at (50, 150).
- **Exp 6.2:** the source, cell 3 at (−50, 50), is 70.7 mm from the base axis. The simulated arm can't reach it at PICK_Z = 12. Along that diagonal the closest reachable point at pick height is about 90 mm out, and joint limits, not the base keep-out zone, are what stop it. The pick is skipped with "position unreachable", and the rest of the route runs. *To confirm on the real arm*; the link lengths and joint limits are partly estimates (`docs/specs/cte_hardware.md`).
