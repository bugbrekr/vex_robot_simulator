# Experiment 10 (diagram version): Robo Lawn Mower - back-and-forth mowing
#
# The manual's figure (p. 64) shows the robot mowing the whole yard in passes: it drives across
# until it sees the black boundary line, makes a 180 degree U-turn down to the next row, drives
# back across, and so on until it reaches the far side of the yard. The manual's own code
# (exp10_lawn_mower.py) only follows the boundary; this program does what the figure shows.
#
# U-turn = turn to face down the yard, move one row over, turn to face back across.
# Turns use the brain's Inertial sensor (SmartDrive) and turn to *absolute* headings (0 = the
# first pass, 90 = down the yard, 180 = the way back). Driving straight isn't gyro-guided, so
# each pass drifts a little; turning to a heading instead of "90 more" cancels that drift at
# every U-turn rather than letting it add up.
# The yard is done when the bottom boundary line is seen while moving over to the next row.
#
# Ports follow the manual's Exp 10 (motors 6 / 1, Optical on 3); change them to match your robot.
from vex import *

brain = Brain()
brain_inertial = Inertial()
left_drive_smart = Motor(Ports.PORT6, 1.0, False)
right_drive_smart = Motor(Ports.PORT1, 1.0, True)
drivetrain = SmartDrive(left_drive_smart, right_drive_smart, brain_inertial, 200, 173, 76, MM, 1)
Optical7 = Optical(Ports.PORT3)

LINE = 80          # brightness below this is the black boundary line (manual's threshold)
ROW_SPACING = 200  # mm between mowing passes (about one robot width)


def show(text):
    brain.screen.clear_screen()
    brain.screen.set_cursor(1, 1)
    brain.screen.print(text)


def on_line():
    return Optical7.brightness() < LINE


def forward():
    # Mow one pass: drive until the boundary line ahead is detected
    while not on_line():
        drivetrain.drive(FORWARD)
    drivetrain.stop()


ACROSS = 0      # heading of the first pass (the robot starts facing across the yard)
DOWN = 90       # heading down the yard, toward the next row (a right turn from ACROSS)
BACK = 180      # heading of the return passes


def u_turn(next_heading):
    """180 degree U-turn: face down the yard, move one row over, face `next_heading`.
    Returns False if the bottom boundary line is reached while moving over: the yard is done."""
    drivetrain.turn_to_heading(DOWN, DEGREES)
    drivetrain.drive_for(FORWARD, ROW_SPACING, MM, wait=False)
    while drivetrain.is_moving():
        if on_line():
            drivetrain.stop()
            return False
        wait(10, MSEC)
    drivetrain.turn_to_heading(next_heading, DEGREES)
    return True


def main():
    show("Calibrating")
    brain_inertial.calibrate()
    while brain_inertial.is_calibrating():
        wait(25, MSEC)
    drivetrain.set_drive_velocity(30, PERCENT)
    drivetrain.set_turn_velocity(30, PERCENT)
    Optical7.set_light(LedStateType.ON)
    Optical7.set_light_power(100, PERCENT)
    wait(1, SECONDS)

    drivetrain.set_heading(ACROSS, DEGREES)
    passes = 1
    show("Pass 1")
    forward()
    # U-turns alternate: right turns at one side, left turns at the other (as in the figure)
    while u_turn(BACK if passes % 2 == 1 else ACROSS):
        passes += 1
        show("Pass " + str(passes))
        forward()

    drivetrain.stop()
    show("Yard done: " + str(passes) + " passes")


main()
