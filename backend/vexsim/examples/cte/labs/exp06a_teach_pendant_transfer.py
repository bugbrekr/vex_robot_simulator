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
#     Project:      Exp 6 Program 1 - Teach Pendant cell-to-cell transfer
# Lab manual Experiment 6, Part A (pp. 44-46): coordinates recorded with the Teach Pendant
# (Move to Safe Position, Enable Manual Mode, jog, read the dashboard) move a cube from the
# source cell to the destination cell. The Signal Tower is green when idle, yellow while moving.
# Map: Exp 6A - Transfer (a cube at the source, (150, -50)), Magnet Pickup Tool mounted.
#
# ------------------------------------------

# Library imports
from cte import *

# Coordinates gathered using the Teach Pendant (Enable Manual Mode, jog, record)
SAFE_Z = 100
PICK_Z = 12

SOURCE_X, SOURCE_Y = 150, -50   # jogged and recorded: source cell
DEST_X, DEST_Y = 50, 150        # jogged and recorded: destination cell


def pick():
    arm.move_to(SOURCE_X, SOURCE_Y, SAFE_Z)
    arm.move_to(SOURCE_X, SOURCE_Y, PICK_Z)
    arm.set_end_effector_magnet(True)
    wait(500, MSEC)
    arm.move_to(SOURCE_X, SOURCE_Y, SAFE_Z)


def place():
    arm.move_to(DEST_X, DEST_Y, SAFE_Z)
    arm.move_to(DEST_X, DEST_Y, PICK_Z)
    arm.set_end_effector_magnet(False)
    wait(500, MSEC)
    arm.move_to(DEST_X, DEST_Y, SAFE_Z)


def home():
    arm.move_to(120, 0, 100)


def main():
    arm.set_speed(50)
    signal_tower.set_color(SignalTower.GREEN, SignalTower.ON)    # idle / ready
    wait(1, SECONDS)

    signal_tower.set_color(SignalTower.GREEN, SignalTower.OFF)
    signal_tower.set_color(SignalTower.YELLOW, SignalTower.ON)   # transferring
    pick()
    place()
    signal_tower.set_color(SignalTower.YELLOW, SignalTower.OFF)

    home()
    signal_tower.set_color(SignalTower.GREEN, SignalTower.ON)    # done / idle


# CTE threads - Do not delete
cte_thread(main)
