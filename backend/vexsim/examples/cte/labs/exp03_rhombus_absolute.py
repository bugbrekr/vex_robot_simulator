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
#     Project:      Exp 3 Program 3 - Rhombus, absolute motion
# Lab manual Experiment 3 (p. 32): draw a rhombus (diamond) and its two diagonals,
# lifting the pen between strokes.
#
# ------------------------------------------

# Library imports
from cte import *

def main():
    arm.set_speed(50)
    arm.set_end_effector_type(Arm.PEN)
    # Move above top vertex
    arm.move_to(125, 200, 100)
    # Draw outer diamond
    arm.move_to(125, 200, 0)
    arm.move_to(200, 125, 0)
    arm.move_to(125, 50, 0)
    arm.move_to(50, 125, 0)
    arm.move_to(125, 200, 0)
    # Lift pen
    arm.move_to(125, 200, 100)
    # Draw vertical center line
    arm.move_to(125, 200, 0)
    arm.move_to(125, 50, 0)
    # Lift pen
    arm.move_to(125, 50, 100)
    # Draw horizontal center line
    arm.move_to(50, 125, 100)
    arm.move_to(50, 125, 0)
    arm.move_to(200, 125, 0)
    # Lift pen
    arm.move_to(200, 125, 100)


# CTE threads - Do not delete
cte_thread(main)
