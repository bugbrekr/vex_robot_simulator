from vex import *

brain = Brain()
arm = Arm()

arm.set_end_effector_type(Arm.PEN)
arm.set_pen_offset(23)
arm.move_to(130, 0, 20)
arm.move_to(130, 0, 0)          # pen down
for dx, dy in [(80, 0), (0, 80), (-80, 0), (0, -80)]:
    arm.move_inc(dx, dy, 0)
arm.move_inc(0, 0, 20)          # pen up
