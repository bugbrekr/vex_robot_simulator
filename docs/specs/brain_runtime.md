# Spec: Brain and runtime (CTE Python)

Sources:
- https://api.vex.com/cte/home/python/Logic/Timer.html
- https://api.vex.com/cte/home/python/Logic/Control.html
- https://api.vex.com/cte/home/python/Logic/Threads.html

Captured on 2026-11-18.

## Program header
```python
from vex import *
brain = Brain()
arm = Arm()
signal_tower_1 = SignalTower(Ports.PORT1)   # optional
```

## Console
- Plain `print(...)` writes to the Print Console. Most CTE examples use this form.
- `brain.print(value, precision=0)` is the V5/EXP-style call. `brain.clear()` clears the console. The sim supports both.

## Timer (CTE form)

| Signature | Notes |
|---|---|
| `brain.timer_reset()` | Resets the timer to 0 |
| `brain.timer_time(units=MSEC)` | MSEC returns an int. SECONDS returns a float |
| `timer_event(callback, delay_ms, arg=())` | Global function. Calls the callback once after the delay |

For V5/EXP compatibility the sim also provides `brain.timer.time(units)`, `brain.timer.clear()` and `brain.timer.event(cb, delay, arg)`.

## Control
- `wait(time, units=MSEC)`, where units is `MSEC` or `SECONDS`. Time is **sim time**.
- `brain.program_stop()` ends the project.

## Project entry point: `cte_thread(main)`
VEXcode CTE projects put their code in `def main():` and end the file with `cte_thread(main)`.
On the real arm the project only runs when it's started this way (the user confirmed this on hardware).
- `cte_thread(fn, args=())` starts `fn` as the project's main thread and returns immediately.
- **Simulator:** a program that never calls `cte_thread` still runs top to bottom, but the console shows a warning when the run starts. The check is static: it looks for any `cte_thread(...)` call in the source.

## Threads
- `Thread(fn)` starts a thread running `fn`.
- `thread.stop()` stops it. A stopped thread cannot be restarted.
- The sim runs student threads as real Python threads and kills them cooperatively. Every API call checks a stop flag.

## Event
- Callback registrations (`pressed`, `control_stopped`, and so on) return an `Event` object.
- `Event(callback)` with `event.broadcast()` is the generic VEX event and is provided too.

## Units / constants
- Time: `MSEC`, `SECONDS`, `SEC`.
- Distance: `MM`, `INCHES`.
- Angle: `DEGREES`.
- Ports: `Ports.PORT1` … `Ports.PORT12`.
