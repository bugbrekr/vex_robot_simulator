from vex import *

brain = Brain()
arm = Arm()
signal_tower = SignalTower(Ports.PORT1)

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

signal_tower.set_color(SignalTower.YELLOW, SignalTower.BLINK)
arm.set_speed(80)
for level, (x, y) in enumerate([(100, 50), (100, 100), (100, 150)]):
    pick(x, y)
    place(200, 50, level)
signal_tower.set_color(SignalTower.ALL, SignalTower.OFF)
signal_tower.set_color(SignalTower.GREEN, SignalTower.ON)
print("Stacked all cubes!")
