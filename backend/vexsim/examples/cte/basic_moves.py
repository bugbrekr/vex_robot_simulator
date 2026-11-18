from vex import *

brain = Brain()
arm = Arm()
signal_tower = SignalTower(Ports.PORT1)


def main():
    signal_tower.set_color(SignalTower.GREEN, SignalTower.ON)
    arm.move_to(200, 0, 50)
    arm.move_to(200, 150, 50)
    arm.move_inc(0, -150, 0)
    print("At", arm.get_x(), arm.get_y(), arm.get_z())


cte_thread(main)
