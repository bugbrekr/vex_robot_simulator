# Experiment 10: Robo Lawn Mower Using Light Sensor (lab manual pp. 64-67) - not in the exam
#
# Drive until the Optical sensor sees the yard's black boundary (brightness < 80 %), drive
# 200 mm further, turn right 85 degrees, repeat for each side.
#
# Ports are the manual's; change them to match your robot (Build tab).
# Changes from the manual (behaviour kept):
#   * unused random-seed code, the Inertial sensor and the unused convert_color_to_string()
#     helper are removed
# Exercise (page 67) - left as in the manual on purpose:
#   * only turn_right() is used, so the robot traces the boundary instead of mowing the yard;
#     the diagram's back-and-forth (180 degree) passes need turn_left() too
# Note: DriveTrain (no gyro) turns by wheel encoders; 85 degrees is the manual's allowance
# for real robots over-rotating. In the simulator's ideal mode the turn is exactly 85.
from vex import *

brain = Brain()
left_drive_smart = Motor(Ports.PORT6, 1.0, False)
right_drive_smart = Motor(Ports.PORT1, 1.0, True)
drivetrain = DriveTrain(left_drive_smart, right_drive_smart, 200, 173, 76, MM, 1)
Optical7 = Optical(Ports.PORT3)


def forward():
    # Move forward until the black line is detected
    while Optical7.brightness() >= 80:
        drivetrain.drive(FORWARD)
    drivetrain.stop()


def turn_right():
    drivetrain.drive_for(FORWARD, 200, MM)
    drivetrain.turn_for(RIGHT, 85, DEGREES)
    drivetrain.stop()


def turn_left():
    drivetrain.drive_for(FORWARD, 200, MM)
    drivetrain.turn_for(LEFT, 85, DEGREES)
    drivetrain.stop()


def number_of_times(x):
    for i in range(x):
        forward()
        wait(400, MSEC)
        turn_right()
        wait(400, MSEC)


def main():
    drivetrain.set_drive_velocity(30, PERCENT)
    Optical7.set_light(LedStateType.ON)
    Optical7.set_light_power(100, PERCENT)
    wait(1, SECONDS)
    number_of_times(4)
    drivetrain.stop()


main()
