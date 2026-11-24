# Follow the left edge of a black line with the downward-facing Optical sensor.
# Use the "Exp 8 - Line Runner" map: start on the lane outline, or draw your own map.
from vex import *

brain = Brain()
left_motor = Motor(Ports.PORT6, False)
right_motor = Motor(Ports.PORT1, True)
optical = Optical(Ports.PORT3)

optical.set_light(LedStateType.ON)
optical.set_light_power(100, PERCENT)

timer = Timer()
while timer.time(SECONDS) < 20:
    b = optical.brightness()
    brain.screen.clear_screen()
    brain.screen.set_cursor(1, 1)
    brain.screen.print("Bright", b)
    if b < 50:  # on the line: steer left
        left_motor.spin(FORWARD, 10, PERCENT)
        right_motor.spin(FORWARD, 35, PERCENT)
    else:       # on the floor: steer right
        left_motor.spin(FORWARD, 35, PERCENT)
        right_motor.spin(FORWARD, 10, PERCENT)
    wait(20, MSEC)
