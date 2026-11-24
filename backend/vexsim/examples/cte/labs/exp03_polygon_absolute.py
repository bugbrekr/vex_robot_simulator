#region VEXcode Generated Robot Configuration
from cte import *
import math
import random

# Brain should be defined by default
brain = Brain()

# Robot configuration code
arm = Arm()
signal_tower = arm.signal_tower


# Wait for sensor(s) to fully initialize
wait(100, MSEC)

#endregion VEXcode Generated Robot Configuration
# ------------------------------------------
#
#     Project:      Exp 3 Program 1 - Polygon, absolute motion
# Lab manual Experiment 3 (p. 31): trace a four-sided polygon with the pen, giving
# move_to() absolute coordinates. z = 0 or slightly negative touches the board; z = 100 lifts.
# Map: Whiteboard, with the Pen Holder Tool mounted.
#
# ------------------------------------------

# Library imports
from cte import *

def main():
    arm.set_speed(50)
    arm.set_end_effector_type(Arm.PEN)
    arm.move_to(120, 0, 100)
    arm.move_to(120, 0, 0)
    arm.move_to(180, 0, -1)
    arm.move_to(180, 180, 0)
    arm.move_to(0, 180, -2)
    arm.move_to(0, 120, -4)
    arm.move_to(120, 120, -2)
    arm.move_to(120, 0, -2)
    arm.move_to(120, 0, 120)


# CTE threads - Do not delete
cte_thread(main)
