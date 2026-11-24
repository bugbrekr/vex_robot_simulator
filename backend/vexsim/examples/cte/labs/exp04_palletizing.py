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
#     Project:      Exp 4 - Palletizing and Stacking of Objects
# Lab manual Experiment 4 (pp. 35-37): pick the cube in block 17 and place it in
# block 29, addressing blocks by number (6 per row, block 8 is the origin).
# Map: Exp 4 - Palletizing (a cube in block 17), Magnet Pickup Tool mounted.
#
# ------------------------------------------

# Library imports
from cte import *

SAFE_Z = 100
PICK_Z = 15


# ------------------------------------------------------
# Convert Block Number to Cartesian Coordinates
# ------------------------------------------------------
def block_to_xy(block):
    row = (block - 1) // 6
    col = (block - 1) % 6
    # Block 8 is (0,0)
    x = (row - 1) * 50
    y = (col - 1) * 50
    return x, y


# ------------------------------------------------------
# Move to a Block
# ------------------------------------------------------
def move_to_block(block, z):
    x, y = block_to_xy(block)
    arm.move_to(x, y, z)


# ------------------------------------------------------
# Pick Operation
# ------------------------------------------------------
def pick(block):
    move_to_block(block, SAFE_Z)
    move_to_block(block, PICK_Z)
    arm.set_end_effector_magnet(True)
    wait(500, MSEC)
    move_to_block(block, SAFE_Z)


# ------------------------------------------------------
# Place Operation
# ------------------------------------------------------
def place(block):
    move_to_block(block, SAFE_Z)
    move_to_block(block, PICK_Z)
    arm.set_end_effector_magnet(False)
    wait(500, MSEC)
    move_to_block(block, SAFE_Z)


# ------------------------------------------------------
# Pick and Place
# ------------------------------------------------------
def pick_and_place(source, destination):
    pick(source)
    place(destination)


def home():
    arm.move_to(120, 0, 100)


# ------------------------------------------------------
# Main
# ------------------------------------------------------
def main():
    arm.set_speed(50)
    pick_and_place(17, 29)
    home()


# CTE threads - Do not delete
cte_thread(main)
