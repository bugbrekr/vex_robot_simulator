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
#     Project:      pick_place
#    Author:       VEX
#    Created:
#    Description:  Stack the three cubes with the Magnet Pickup Tool
#
# ------------------------------------------

# Library imports
from cte import *

CUBE = 25  # mm

def pick(x, y):
    arm.move_to(x, y, CUBE + 30)
    arm.move_to(x, y, CUBE)
    arm.set_end_effector_magnet(True)
    arm.move_inc(0, 0, 40)

def place(x, y, level):
    top = CUBE * (level + 1)
    arm.move_to(x, y, top + 30)
    arm.move_to(x, y, top)
    arm.set_end_effector_magnet(False)
    arm.move_inc(0, 0, 40)


# Add project code in "main"
def main():
    signal_tower.set_color(SignalTower.YELLOW, SignalTower.BLINK)
    arm.set_speed(80)
    for level, (x, y) in enumerate([(100, 50), (100, 100), (100, 150)]):
        pick(x, y)
        place(200, 50, level)
    signal_tower.set_color(SignalTower.ALL, SignalTower.OFF)
    signal_tower.set_color(SignalTower.GREEN, SignalTower.ON)
    print("Stacked all cubes!")


# CTE threads — Do not delete
cte_thread(main)
