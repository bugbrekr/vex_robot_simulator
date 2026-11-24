"""Build an IQ2 scene (field + robot + brain) from a scenario dict."""

from __future__ import annotations

from vexsim.core.engine import SimEngine
from vexsim.robots.iq2.brain import BrainModel
from vexsim.robots.iq2.field import Field
from vexsim.robots.iq2.robot import IQRobotModel


def build_scene(engine: SimEngine, scenario: dict, config: dict | None = None,
                realistic: bool = True, seed: int = 1, pose: list | None = None) -> dict:
    field = Field.from_scenario(scenario)
    engine.add(field)
    robot = IQRobotModel(field, scenario.get("start"), config=config or scenario.get("robot"),
                         realistic=realistic, seed=seed)
    if pose is not None:
        import math

        robot.place(float(pose[0]), float(pose[1]), math.radians(float(pose[2])))
    engine.add(robot)
    brain = engine.add(BrainModel())
    return {"field": field, "robot": robot, "brain": brain}
