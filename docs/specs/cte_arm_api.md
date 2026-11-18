# Spec: CTE 6-Axis Arm, Python API

Source: https://api.vex.com/cte/home/python/Arm.html (standalone arm on the CTE Tile).
EXP variant: https://api.vex.com/exp/home/python/Arm.html (arm connected to an EXP Brain).
Captured on 2026-11-18. **The simulator must match these signatures exactly.**

## Construction

| Platform | Code |
|---|---|
| CTE standalone | `arm = Arm()` |
| EXP Brain | `arm = Arm(Ports.PORT1)` |

The simulator accepts both forms. A port argument is optional and ignored.

## Coordinates
- Units are mm for position and degrees for orientation.
- The origin (0,0,0) is the centre of the arm base, with z=0 at the Tile surface. See `cte_hardware.md`.
- Position means the TCP (Tool Center Point), which depends on the end effector type and the pen offset.
- Orientation axes:
  - **yaw** rotates about z.
  - **roll** rotates about x.
  - **pitch** rotates about y.

## Actions

All four actions take `wait=True` by default. With `wait=False` the call returns immediately. The docs say the return value is a bool (True when the target was reached). When `wait=False` we return True if the move was accepted.

| Signature | Meaning |
|---|---|
| `move_to(x, y, z, wait=True)` | Move the TCP to an absolute position, in mm |
| `move_inc(x, y, z, wait=True)` | Move the TCP relative to its current position, in mm |
| `move_end_effector_to(yaw, roll, pitch, wait=True)` | Absolute tool orientation, in degrees |
| `move_end_effector_inc(yaw, roll, pitch, wait=True)` | Relative tool orientation, in degrees |

Behaviour notes:
- If the target is unreachable, the arm does not move and the call returns False. On the real arm, the troubleshooting KB says this case shows an "invalid position" error.
- The real arm is accurate to about 1–2 mm (KB).
- A move ends early when the timeout set with `set_timeout` expires. The program then continues with the next line.

## Mutators

| Signature | Default | Notes |
|---|---|---|
| `set_speed(speed)` | 50 | Percent, 1–100 |
| `set_end_effector_type(type)` | `Arm.MAGNET` | `Arm.MAGNET` or `Arm.PEN`. Changing it adjusts the z-offset automatically |
| `set_end_effector_magnet(state)` | False | True turns the magnet on (picks up objects). False releases the held object |
| `set_pen_offset(zOffset)` | 0 | mm, from the top of the pen tool to the marker tip. Only applies with `PEN`. Sim: added to the `PEN` type's built-in offset, so 0 puts z=0 at the kit marker's tip, which matches real arms (see cte_hardware.md) |
| `set_control_stop(state=True)` | – | Stops motion immediately. **Latches**: no further moves until the program restarts |
| `set_timeout(timeout, units=MSEC)` | – | `MSEC`, `SECONDS` or `SEC` |

## Getters

| Signature | Returns |
|---|---|
| `is_done()` | bool. False while moving |
| `get_x()`, `get_y()`, `get_z()` | float, mm (TCP) |
| `get_yaw()`, `get_roll()`, `get_pitch()` | float, degrees |
| `get_timeout()` | int, ms |
| `is_connected()` | bool |
| `can_arm_reach_to(x, y, z)` | bool |
| `can_arm_reach_inc(x, y, z)` | bool |
| `can_end_effector_reach_to(yaw, roll, pitch)` | bool |
| `can_end_effector_reach_inc(yaw, roll, pitch)` | bool |
| `is_crashed()` | bool (EXP page only) |

## Callbacks

| Signature | Notes |
|---|---|
| `control_stopped(callback, arg=())` | Runs when control stop is engaged. Returns `Event` |
| `crashed(callback)` | EXP page only |

## Constants
- Tool types: `Arm.MAGNET`, `Arm.PEN`.
- Time units: `MSEC`, `SECONDS`, `SEC`.

## Example (VEXcode style)
```python
from vex import *
brain = Brain()
arm = Arm()

arm.set_speed(80)
if arm.can_arm_reach_to(150, 50, 30):
    arm.move_to(150, 50, 30)
arm.set_end_effector_magnet(True)
arm.move_inc(0, 0, 50)
print(arm.get_x(), arm.get_y(), arm.get_z())
```
