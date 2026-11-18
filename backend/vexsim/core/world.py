"""World state shared by entities: loose objects on the work surface."""

from __future__ import annotations

import math

import numpy as np

from vexsim.core.entity import Entity
from vexsim.core.transforms import rz

GRAVITY = 9810.0  # mm/s^2


class World(Entity):
    kind = "world"

    def __init__(self, name: str = "world", floor_z: float = 0.0, bounds=None):
        super().__init__(name)
        self.floor_z = floor_z
        self.bounds = bounds  # (xmin, xmax, ymin, ymax) of the work surface; None = unbounded
        self.objects: dict = {}
        self.factory = None  # callable(spec) -> object, set by the scene builder
        self.drawable = lambda x, y: False  # where a dry-erase marker leaves ink
        self._next = 1

    # ------------------------------------------------------------------ queries
    def on_surface(self, x: float, y: float) -> bool:
        if self.bounds is None:
            return True
        xmin, xmax, ymin, ymax = self.bounds
        return xmin <= x <= xmax and ymin <= y <= ymax

    def support_height(self, x: float, y: float, half_width: float, exclude=None) -> float:
        """Highest resting surface under a square footprint centred at (x, y)."""
        z = self.floor_z
        for o in self.objects.values():
            if o is exclude or o.held or o.user_grab:
                continue
            if o.footprint_overlaps(x, y, half_width):
                z = max(z, o.top_z)
        return z

    # ------------------------------------------------------------------ mutation
    def add_object(self, obj) -> None:
        self.objects[obj.id] = obj

    def new_id(self, kind: str) -> str:
        while f"{kind}_{self._next}" in self.objects:
            self._next += 1
        oid = f"{kind}_{self._next}"
        self._next += 1
        return oid

    def spawn(self, spec: dict, drop_from: float | None = None):
        """Create an object from a spec (kind, x, y, ...). It rests on the surface, or - if
        ``drop_from`` (height of its bottom, mm) is given - is released there and falls."""
        spec = dict(spec)
        spec.setdefault("id", self.new_id(spec.get("kind", "cube")))
        obj = self.factory(spec)
        self.add_object(obj)
        support = self.support_height(obj.position[0], obj.position[1], obj.half_height, exclude=obj)
        bottom = support if drop_from is None else max(support, drop_from)
        obj.position = np.array([obj.position[0], obj.position[1], bottom + obj.half_height])
        return obj

    def drop(self, o) -> None:
        """Release an object: it straightens up and falls under gravity (see step())."""
        yaw = math.atan2(o.rotation[1, 0], o.rotation[0, 0])
        o.rotation = rz(yaw)
        o.vz = 0.0

    def remove(self, oid: str) -> bool:
        o = self.objects.pop(oid, None)
        if o is None:
            return False
        self.settle()
        return True

    def clear(self) -> None:
        self.objects.clear()

    def is_settled(self) -> bool:
        return all(getattr(o, "vz", 0.0) == 0.0 for o in self.objects.values()
                   if not (o.held or o.user_grab)) and not any(
            o.position[2] > self.support_height(o.position[0], o.position[1], o.half_height, exclude=o)
            + o.half_height + 1e-6 for o in self.objects.values() if not (o.held or o.user_grab))

    def settle(self) -> None:
        """Kept for callers: unsupported objects now fall on their own in step()."""

    def step(self, t: float, dt: float) -> None:
        """Gravity: free objects fall straight down until they land on the tile or a cube."""
        free = [o for o in self.objects.values() if not (o.held or o.user_grab)]
        for o in sorted(free, key=lambda o: o.position[2]):  # lowest first, so stacks land in order
            support = self.support_height(o.position[0], o.position[1], o.half_height, exclude=o)
            rest = support + o.half_height
            if o.position[2] > rest + 1e-6 or getattr(o, "vz", 0.0) != 0.0:
                o.vz = getattr(o, "vz", 0.0) - GRAVITY * dt
                z = o.position[2] + o.vz * dt
                if z <= rest:
                    z, o.vz = rest, 0.0
                o.position = np.array([o.position[0], o.position[1], z])

    # ------------------------------------------------------------------ io
    def snapshot(self) -> dict:
        return {"objects": [o.snapshot() for o in self.objects.values()]}

    def describe(self) -> dict:
        return {
            "name": self.name,
            "kind": self.kind,
            "objects": [o.describe() for o in self.objects.values()],
        }
