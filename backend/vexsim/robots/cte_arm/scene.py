"""Build a CTE workcell scene (arm, tower, cubes) from a scenario dict."""

from __future__ import annotations

import numpy as np

from vexsim.core.engine import SimEngine
from vexsim.core.world import World
from vexsim.robots.cte_arm.arm import ArmModel
from vexsim.robots.cte_arm.kinematics import load_geometry
from vexsim.robots.cte_arm.objects import make_object
from vexsim.robots.cte_arm.signal_tower import SignalTowerModel
from vexsim.robots.cte_arm.tile import (
    CELL,
    GRID,
    TILE_HEIGHT,
    TILE_SIZE,
    location_to_xy,
    point_on_whiteboard,
    tile_bounds,
    whiteboard_outline,
    whiteboard_screws,
)


def build_scene(engine: SimEngine, scenario: dict) -> dict:
    world = World(bounds=tile_bounds())

    def factory(spec: dict):
        spec = dict(spec)
        if "tag_id" not in spec:  # next free AprilTag id, starting at 20 like the kit cubes
            used = {getattr(o, "tag_id", None) for o in world.objects.values()}
            spec["tag_id"] = next(i for i in range(20, 587) if i not in used)
        return make_object(spec)

    world.factory = factory
    if scenario.get("surface") == "whiteboard":
        world.drawable = point_on_whiteboard
    for spec in scenario.get("objects", []):
        world.spawn(spec)
    engine.add(world)
    devices: dict = {"world": world}
    arm_cfg = scenario.get("arm", {})
    if arm_cfg is not None:
        arm = ArmModel(load_geometry(), world)
        if arm_cfg.get("marker_protrusion") is not None:
            arm.marker_protrusion = float(arm_cfg["marker_protrusion"])
        if arm_cfg.get("mounted_tool") == "pen":
            # pen mounted and configured (pendant jogging uses the marker tip); re-home the TCP
            arm.mounted_tool = arm.tool = "pen"
            arm.pen_offset = arm.marker_protrusion
            from vexsim.robots.cte_arm.kinematics import rpy_deg_to_matrix

            q = arm.kin.ik(np.array(arm.g.start_position), rpy_deg_to_matrix(*arm.g.start_orientation),
                           near=arm.q, tool="pen", pen_offset=arm.pen_offset)
            if q is not None:
                arm.q = q
        devices["arm"] = engine.add(arm)
    tower = scenario.get("signal_tower")
    if tower is not None:
        if "location" in tower:
            pos = location_to_xy(int(tower["location"]))
        else:
            pos = tuple(tower.get("position", (-50.0, 200.0)))
        devices["signal_tower"] = engine.add(SignalTowerModel(position=pos))
    return devices


def describe_tile(scenario: dict | None = None) -> dict:
    xmin, xmax, ymin, ymax = tile_bounds()
    surface = (scenario or {}).get("surface", "tile")
    return {
        "surface": surface,
        "whiteboard": (
            {"outline": whiteboard_outline(), "screws": whiteboard_screws()}
            if surface == "whiteboard" else None
        ),
        "size": TILE_SIZE,
        "height": TILE_HEIGHT,
        "cell": CELL,
        "grid": GRID,
        "bounds": [xmin, xmax, ymin, ymax],
        "locations": {n: location_to_xy(n) for n in range(1, GRID * GRID + 1)},
    }
