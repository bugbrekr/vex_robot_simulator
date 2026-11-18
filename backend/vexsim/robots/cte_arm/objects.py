"""Workcell objects. v1: 25 mm blue cubes with an AprilTag-style marker on one face."""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from vexsim.core.transforms import matrix_to_quat, rz


@dataclass(kw_only=True)
class WorkObject:
    id: str
    kind: str
    position: np.ndarray  # centre, mm
    rotation: np.ndarray = field(default_factory=lambda: np.eye(3))
    color: str = "#1f5fd6"
    held: bool = False  # carried by the magnet
    user_grab: bool = False  # being dragged by the user in the UI
    vz: float = 0.0  # vertical speed while falling (mm/s)

    @property
    def half_height(self) -> float:
        raise NotImplementedError

    @property
    def top_z(self) -> float:
        return float(self.position[2] + self.half_height)

    @property
    def bottom_z(self) -> float:
        return float(self.position[2] - self.half_height)

    def footprint_overlaps(self, x: float, y: float, other_half: float) -> bool:
        raise NotImplementedError

    def snapshot(self) -> dict:
        return {
            "id": self.id,
            "kind": self.kind,
            "pos": [round(float(v), 2) for v in self.position],
            "quat": [round(v, 5) for v in matrix_to_quat(self.rotation)],
            "held": self.held,
            "grabbed": self.user_grab,
            **{k: v for k, v in self.describe().items() if k not in ("id", "kind")},
        }

    def describe(self) -> dict:
        return {"id": self.id, "kind": self.kind}


@dataclass(kw_only=True)
class Cube(WorkObject):
    size: float = 25.0
    tag_id: int = 20
    tag_face: str = "+z"  # which face (in the cube's frame) carries the marker
    kind: str = "cube"

    @property
    def half_height(self) -> float:
        return self.size / 2

    def footprint_overlaps(self, x: float, y: float, other_half: float) -> bool:
        h = self.size / 2 + other_half
        return abs(self.position[0] - x) < h and abs(self.position[1] - y) < h

    def describe(self) -> dict:
        return {
            "id": self.id,
            "kind": self.kind,
            "size": self.size,
            "color": self.color,
            "tag_id": self.tag_id,
            "tag_face": self.tag_face,
        }


def make_object(spec: dict) -> WorkObject:
    kind = spec.get("kind", "cube")
    if kind != "cube":
        raise ValueError(f"unsupported object kind {kind!r} (v1 supports cubes only)")
    size = float(spec.get("size", 25.0))
    if "location" in spec:
        from vexsim.robots.cte_arm.tile import location_to_xy

        x, y = location_to_xy(int(spec["location"]))
    else:
        x, y = spec["x"], spec["y"]
    z = float(spec.get("z", 0.0)) + size / 2
    return Cube(
        id=str(spec["id"]),
        kind="cube",
        position=np.array([x, y, z], dtype=float),
        rotation=rz(np.radians(spec.get("yaw", 0.0))),
        color=spec.get("color", "#1f5fd6"),
        size=size,
        tag_id=int(spec.get("tag_id", 20)),
        tag_face=spec.get("tag_face", "+z"),
    )
