# Experiment 8: Line Runner Challenge (lab manual pp. 54-57)
#
# Drive to line 1 and back to the start, to line 2 and back, to line 3 and back, using the
# left motor's encoder to retrace each leg. A line is a brightness reading below 40 %.
#
# Ports are the manual's; change them to match your robot (Build tab).
# Changes from the manual (behaviour kept):
#   * Right motor reversed - the manual has Motor(Ports.PORT1, False), which spins in place
#   * unused random-seed code, imports and the Inertial sensor removed
#   * the three identical phase blocks are folded into return_to_start(); "phase == n and
#     lineCount == n" is written as lineCount == phase
# Known issues in the manual's logic:
#   * it waits 400 ms after seeing a line before stopping, so it stops ~30 mm past the line
#   * the aim says "stop at the third line", but phase 3 also returns to the start
#   * clear_screen() does not move the cursor back to row 1 (set_cursor(1, 1) is there - good)
from vex import *

brain = Brain()
Optical7 = Optical(Ports.PORT7)
Left = Motor(Ports.PORT6, False)
Right = Motor(Ports.PORT1, True)


def fwrd():
    Left.spin(FORWARD)
    Right.spin(FORWARD)


def bkwd():
    Left.spin(REVERSE)
    Right.spin(REVERSE)


def stop():
    Left.stop()
    Right.stop()


def return_to_start(pause_ms):
    """Stop, then back up until the left encoder has counted back down to zero."""
    tTurns = Left.position(TURNS)
    stop()
    wait(pause_ms, MSEC)
    while tTurns > 0:
        tTurns = Left.position(TURNS)
        bkwd()
        wait(10, MSEC)
    stop()
    return tTurns


Optical7.set_light(LedStateType.ON)
Optical7.set_light_power(100, PERCENT)
Left.set_velocity(20, PERCENT)
Right.set_velocity(20, PERCENT)

lineCount = 0
phase = 1
tTurns = 0

wait(1, SECONDS)

while True:
    brightness = Optical7.brightness()

    brain.screen.clear_screen()
    brain.screen.set_cursor(1, 1)
    brain.screen.print("B:{} T:{} L:{} P:{}".format(brightness, tTurns, lineCount, phase))

    wait(50, MSEC)

    if brightness < 40:
        lineCount += 1
        wait(400, MSEC)

        if lineCount == phase:  # phase 1 reacts to line 1, phase 2 to line 2, phase 3 to line 3
            tTurns = return_to_start(200 if phase == 1 else 300)
            if phase == 3:
                break
            lineCount = 0
            phase += 1
            Left.reset_position()
            Right.reset_position()
            wait(1, SECONDS)

    fwrd()

brain.screen.clear_screen()
brain.screen.print("Task Complete!")
