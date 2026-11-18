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
#     Project:      basic_moves
#    Author:       VEX
#    Created:
#    Description:  Move the arm between a few points
#
# ------------------------------------------

# Library imports
from cte import *

# Add project code in "main"
def main():
    signal_tower.set_color(SignalTower.GREEN, SignalTower.ON)
    arm.move_to(200, 0, 50)
    arm.move_to(200, 150, 50)
    arm.move_inc(0, -150, 0)
    print("At", arm.get_x(), arm.get_y(), arm.get_z())


# CTE threads — Do not delete
cte_thread(main)
