import math

from vex import *

brain = Brain()
arm = Arm()


def line(x1, y1, x2, y2):
    arm.move_to(x1, y1, 10)   # hover above the start
    arm.move_to(x1, y1, 0)    # pen down
    arm.move_to(x2, y2, 0)    # draw
    arm.move_inc(0, 0, 10)    # pen up


def main():
    arm.set_end_effector_type(Arm.PEN)
    arm.set_pen_offset(23)

    # Triangle (STEM Labs Unit 4 style)
    line(150, 50, 50, 150)
    line(50, 150, 200, 150)
    line(200, 150, 150, 50)

    # Circle around (150, 150)
    arm.move_to(190, 150, 10)
    arm.move_to(190, 150, 0)
    for i in range(1, 37):
        a = math.radians(i * 10)
        arm.move_to(150 + 40 * math.cos(a), 150 + 40 * math.sin(a), 0)
    arm.move_inc(0, 0, 20)


cte_thread(main)
