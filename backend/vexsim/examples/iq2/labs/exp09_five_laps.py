# Experiment 9: Five Laps Using Sonic Sensor (lab manual pp. 60-63)
#
# Drive forward until the Distance sensor reads under 200 mm, turn right 90 degrees (gyro),
# repeat - one forward-and-turn per side of the square course.
#
# Ports are the manual's; change them to match your robot (Build tab).
# Changes from the manual (behaviour kept):
#   * the duplicate auto-generated configuration (a DriveTrain that was replaced by the
#     SmartDrive below, and an unused Distance7 on PORT7) and the random-seed code are removed
# Exercise (page 63) - left as in the manual on purpose:
#   * Numberoftimes(16) runs range(17): 17 sides = 4 laps + 1 side. 5 laps needs 20 sides.
from vex import *

brain = Brain()
brain_inertial = Inertial()
left_motor = Motor(Ports.PORT6, GearSetting.RATIO_1_1, False)
right_motor = Motor(Ports.PORT1, GearSetting.RATIO_1_1, True)
drivetrain = SmartDrive(left_motor, right_motor, brain_inertial, 200, MM)
distance = Distance(Ports.PORT5)

# Calibrate Inertial
brain.screen.print("Calibrating Inertial...")
brain_inertial.calibrate()
while brain_inertial.is_calibrating():
    wait(25, MSEC)
brain.screen.clear_screen()


def Forward():
    while distance.object_distance(MM) >= 200:
        drivetrain.drive(FORWARD)
    drivetrain.stop()


def turn_right():
    drivetrain.turn_for(RIGHT, 90, DEGREES)
    drivetrain.stop()


def turn_left():
    drivetrain.turn_for(LEFT, 90, DEGREES)
    drivetrain.stop()


def Numberoftimes(x):
    for i in range(x + 1):
        Forward()
        wait(400, MSEC)
        turn_right()
        wait(400, MSEC)


# Main
drivetrain.set_drive_velocity(60, PERCENT)
wait(1, SECONDS)
Numberoftimes(16)
drivetrain.stop()
