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
#     Project:      Exp 3 Program 4 - Rhombus, relative motion
# Lab manual Experiment 3 (p. 33): the same rhombus as Program 3, annotated with the
# relative displacement of every step.
#
# ------------------------------------------

# Library imports
from cte import *

def main():
    arm.set_speed(50)
    arm.set_end_effector_type(Arm.PEN)
    arm.move_to(125, 200, 100)
    arm.move_to(125, 200, 0)      # Δ(0,0,-100)
    arm.move_to(200, 125, 0)      # Δ(+75,-75,0)
    arm.move_to(125, 50, 0)       # Δ(-75,-75,0)
    arm.move_to(50, 125, 0)       # Δ(-75,+75,0)
    arm.move_to(125, 200, 0)      # Δ(+75,+75,0)
    arm.move_to(125, 200, 100)    # Δ(0,0,+100)
    arm.move_to(125, 200, 0)      # Δ(0,0,-100)
    arm.move_to(125, 50, 0)       # Δ(0,-150,0)
    arm.move_to(125, 50, 100)     # Δ(0,0,+100)
    arm.move_to(50, 125, 100)     # Δ(-75,+75,0)
    arm.move_to(50, 125, 0)       # Δ(0,0,-100)
    arm.move_to(200, 125, 0)      # Δ(+150,0,0)
    arm.move_to(200, 125, 100)    # Δ(0,0,+100)


# CTE threads - Do not delete
cte_thread(main)
