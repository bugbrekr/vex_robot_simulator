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
#     Project:      draw_square
#    Author:       VEX
#    Created:
#    Description:  Draw a square with the Pen Holder Tool
#
# ------------------------------------------

# Library imports
from cte import *

# Add project code in "main"
def main():
    arm.set_end_effector_type(Arm.PEN)
    arm.move_to(130, 0, 20)
    arm.move_to(130, 0, 0)          # pen down
    for dx, dy in [(80, 0), (0, 80), (-80, 0), (0, -80)]:
        arm.move_inc(dx, dy, 0)
    arm.move_inc(0, 0, 20)          # pen up


# CTE threads — Do not delete
cte_thread(main)
