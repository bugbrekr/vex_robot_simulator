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
#     Project:      Exp 3 Program 2 - Polygon, relative motion
# Lab manual Experiment 3 (p. 32): the same path as Program 1, annotated with the
# relative displacement of every step. move_to() always takes absolute coordinates.
#
# ------------------------------------------

# Library imports
from cte import *

def main():
    arm.set_speed(50)
    arm.set_end_effector_type(Arm.PEN)
    arm.move_to(120, 0, 100)      # Start
    arm.move_to(120, 0, 0)        # Δ(0, 0, -100)
    arm.move_to(180, 0, -1)       # Δ(+60, 0, -1)
    arm.move_to(180, 180, 0)      # Δ(0, +180, +1)
    arm.move_to(0, 180, -2)       # Δ(-180, 0, -2)
    arm.move_to(0, 120, -4)       # Δ(0, -60, -2)
    arm.move_to(120, 120, -2)     # Δ(+120, 0, +2)
    arm.move_to(120, 0, -2)       # Δ(0, -120, 0)
    arm.move_to(120, 0, 120)      # Δ(0, 0, +122)


# CTE threads - Do not delete
cte_thread(main)
