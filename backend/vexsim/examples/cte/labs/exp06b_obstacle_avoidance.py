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
#     Project:      Exp 6 Program 2 - Obstacle avoidance around two cube walls
# Lab manual Experiment 6, Part B (pp. 46-47): carry a cube from cell 3 to cell 36 around
# two walls of cubes (cells 13-16 and 27-30), threading the open gap at the far end of each
# wall through waypoints recorded with the Teach Pendant.
# Map: Exp 6B - Two cube walls, Magnet Pickup Tool mounted.
#
# Note: in the simulator the source, cell 3 at (-50, 50), is too close to the arm base to reach
# at PICK_Z (the closest reachable point on that diagonal is ~90 mm from the base axis; cell 3 is
# 70.7 mm), so the pick is skipped with "position unreachable". Move the source cube one cell
# out (e.g. cell 4: SOURCE_X, SOURCE_Y = -50, 100) to run the rest of the route.
#
# ------------------------------------------

# Library imports
from cte import *

SAFE_Z = 100   # clears the tops of the cube obstacles
PICK_Z = 12

# All coordinates use the same block_to_xy scheme as Experiment 2:
# row = (block - 1) // 6, col = (block - 1) % 6, x = (row-1)*50, y = (col-1)*50
SOURCE_X, SOURCE_Y = -50, 50     # cell 3
DEST_X, DEST_Y = 200, 200        # cell 36

# Obstacles: Wall 1 = cells 13,14,15,16 (x=50)  |  Wall 2 = cells 27,28,29,30 (x=150)
# Dodge waypoints thread the one open gap at the far end of each wall
WAY1_X, WAY1_Y = 50, 200         # cell 18 - gap past Wall 1
WAY2_X, WAY2_Y = 150, 0          # cell 26 - gap past Wall 2


def pick():
    arm.move_to(SOURCE_X, SOURCE_Y, SAFE_Z)
    arm.move_to(SOURCE_X, SOURCE_Y, PICK_Z)
    arm.set_end_effector_magnet(True)
    wait(500, MSEC)
    arm.move_to(SOURCE_X, SOURCE_Y, SAFE_Z)


def travel_around_obstacles():
    arm.move_to(WAY1_X, WAY1_Y, SAFE_Z)   # thread the gap past Wall 1
    arm.move_to(WAY2_X, WAY2_Y, SAFE_Z)   # thread the gap past Wall 2


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
    signal_tower.set_color(SignalTower.GREEN, SignalTower.ON)

    signal_tower.set_color(SignalTower.GREEN, SignalTower.OFF)
    signal_tower.set_color(SignalTower.YELLOW, SignalTower.ON)
    pick()
    travel_around_obstacles()
    place()
    signal_tower.set_color(SignalTower.YELLOW, SignalTower.OFF)

    home()
    signal_tower.set_color(SignalTower.GREEN, SignalTower.ON)


# CTE threads - Do not delete
cte_thread(main)
