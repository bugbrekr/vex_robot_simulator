# Spec: Signal Tower

Sources:
- https://api.vex.com/cte/home/python/SignalTower.html
- https://api.vex.com/exp/home/python/SignalTower.html (includes the bumper)
- https://api.vex.com/cte/home/blocks/tower.html

Captured on 2026-11-18.

## Hardware
- 5 LEDs: red, yellow, green, blue and white.
- A bumper switch on top. On the EXP page it is used as an emergency stop.
- **Unknown:**
  - The physical stacking order. The sim assumes red is at the top, then yellow, green, blue and white, which follows the `set_colors` argument order.
  - The blink rate. The sim uses 2 Hz with a 50% duty cycle (ESTIMATE).

## Python API

| Signature | Notes |
|---|---|
| `SignalTower(Ports.PORTx)` | Constructor |
| `set_color(value, state)` | `value`: `SignalTower.RED`, `GREEN`, `BLUE`, `YELLOW`, `WHITE` or `ALL`. `state`: `SignalTower.ON`, `OFF` or `BLINK` |
| `set_colors(r, y, g, b, w)` | Each argument is ON, OFF or BLINK. **Note the order: r, y, g, b, w** |
| `pressing()` | bool, bumper held (EXP page) |
| `pressed(callback, arg=())` | Returns `Event` (EXP page) |
| `released(callback, arg=())` | Returns `Event` (EXP page) |

The C++ API also has LED brightness values from 0 to 255. Python doesn't expose them, so they are out of scope.

## Blocks (for later)
- `set signal tower [color] to [solid|blinking|off]`.
- `when Signal Tower bumper pressed`.

## Simulator behaviour
- Every LED starts OFF when the program starts.
- BLINK phase comes from the global sim clock, so all blinking LEDs stay in sync.
- The bumper is clickable in the UI. Mouse down sends pressed, mouse up sends released.
