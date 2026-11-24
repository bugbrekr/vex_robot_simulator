# Events: the Touch LED and the brain's buttons change the LED colour.
# Click the Touch LED on the robot, or the brain's left / right buttons.
from vex import *

brain = Brain()
touch_led = Touchled(Ports.PORT4)


def led_pressed():
    touch_led.set_color(Color.GREEN)
    brain.screen.clear_screen()
    brain.screen.set_cursor(1, 1)
    brain.screen.print("Touch LED!")


def left_pressed():
    touch_led.set_color(Color.BLUE)


def right_pressed():
    touch_led.set_color(Color.RED)


touch_led.pressed(led_pressed)
brain.buttonLeft.pressed(left_pressed)
brain.buttonRight.pressed(right_pressed)

touch_led.set_color(Color.WHITE)
brain.screen.print("Press me")
