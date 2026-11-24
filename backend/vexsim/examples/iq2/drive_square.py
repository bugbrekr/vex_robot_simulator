# Drive a 400 mm square with the gyro-assisted SmartDrive.
from vex import *

brain = Brain()
brain_inertial = Inertial()
left_motor = Motor(Ports.PORT6, False)
right_motor = Motor(Ports.PORT1, True)
drivetrain = SmartDrive(left_motor, right_motor, brain_inertial, 200, 173, 76, MM, 1)

drivetrain.set_drive_velocity(50, PERCENT)
drivetrain.set_turn_velocity(30, PERCENT)

for side in range(4):
    brain.screen.clear_screen()
    brain.screen.set_cursor(1, 1)
    brain.screen.print("Side", side + 1)
    drivetrain.drive_for(FORWARD, 400, MM)
    drivetrain.turn_for(RIGHT, 90, DEGREES)

brain.screen.next_row()
brain.screen.print("Heading", brain_inertial.heading())
