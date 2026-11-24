# Experiment 7: Sensor Bed Experiment (lab manual pp. 49-53)
#
# The robot drives forward and reacts to the first sensor that triggers, in priority order:
#   Bumper -> stop, Touch LED red        | Distance <= 150 mm -> stop, yellow, show distance
#   Black line -> blue, turn right 90    | Touch LED pressed -> green, drive 200 mm
#   Heading > 90 -> purple, show heading
#
# Ports are the manual's; change them to match your robot (Build tab).
# Changes from the manual (behaviour kept):
#   * right motor reversed - the manual has Motor(Ports.PORT1, 1.0, False), which spins in place
#   * unused random-seed code and imports removed
#   * the repeated stop / LED / screen code is folded into report()
# Known issues in the manual's logic (left as-is so you can find and fix them):
#   * abs(heading()) > 90: heading() runs 0-359.99, so any drift to the left (359...) or the
#     right turn at the line (~90) keeps triggering it - rotation() + reset_rotation() was meant
#   * the Distance branch never turns away: with the obstacle still ahead the robot stays put
#   * clear_screen() does not move the cursor back to row 1 (add set_cursor(1, 1))
from vex import *

brain = Brain()
brain_inertial = Inertial()
left_drive_smart = Motor(Ports.PORT6, 1.0, False)
right_drive_smart = Motor(Ports.PORT1, 1.0, True)
drivetrain = SmartDrive(left_drive_smart, right_drive_smart, brain_inertial, 200)

bumper = Bumper(Ports.PORT11)
distance = Distance(Ports.PORT5)
optical = Optical(Ports.PORT3)
touch_led = Touchled(Ports.PORT4)


def calibrate_drivetrain():
    sleep(200, MSEC)
    brain.screen.print("Calibrating")
    brain.screen.next_row()
    brain.screen.print("Inertial")
    brain_inertial.calibrate()
    while brain_inertial.is_calibrating():
        sleep(25, MSEC)
    brain.screen.clear_screen()


def report(color, title, value=None, unit=""):
    """Stop, light the Touch LED in `color` and show `title` (and `value` `unit` below it)."""
    drivetrain.stop()
    touch_led.set_color(color)
    touch_led.on()
    brain.screen.clear_screen()
    brain.screen.print(title)
    if value is not None:
        brain.screen.next_row()
        brain.screen.print(value)
        brain.screen.print(unit)


calibrate_drivetrain()

# Initial settings
drivetrain.set_drive_velocity(40, PERCENT)
drivetrain.set_turn_velocity(40, PERCENT)
optical.set_light(LedStateType.ON)
optical.set_light_power(100, PERCENT)
touch_led.set_color(Color.GREEN)
touch_led.on()
brain.screen.clear_screen()
brain.screen.print("Sensor Bed Ready")
wait(1, SECONDS)

# Main program
while True:
    drivetrain.drive(FORWARD)

    if bumper.pressing():
        report(Color.RED, "Bumper Pressed")
        wait(1, SECONDS)

    elif distance.object_distance(MM) <= 150:
        report(Color.YELLOW, "Obstacle", distance.object_distance(MM), " mm")
        wait(1, SECONDS)

    elif optical.brightness() < 80:
        report(Color.BLUE, "Black Line")
        drivetrain.turn_for(RIGHT, 90, DEGREES)
        wait(1, SECONDS)

    elif touch_led.pressing():
        report(Color.GREEN, "Touch LED")
        drivetrain.drive_for(FORWARD, 200, MM)
        wait(1, SECONDS)

    elif abs(brain_inertial.heading()) > 90:
        report(Color.PURPLE, "Heading", brain_inertial.heading(), " deg")
        wait(1, SECONDS)

    wait(20, MSEC)
