"""IQ2 field: a white floor with tape lines and fixed obstacles (2D geometry + heights).

World frame: mm, +x east, +y north, z up, floor at z = 0. Lines are polylines of tape lying on
the floor (the Optical sensor sees them, nothing collides with them). Obstacles are boxes or
cylinders standing on the floor: they block the robot and the Distance sensor sees them.
"""

from __future__ import annotations

import itertools
import math
from dataclasses import dataclass, field

from vexsim.core.entity import Entity

WHITE = "#f4f4f1"
BLACK_TAPE = "#151515"
TAPE_WIDTH = 19.0  # ESTIMATE: 3/4 in electrical tape
WALL_HEIGHT = 75.0  # ESTIMATE: IQ field perimeter (~3 in)
WALL_THICKNESS = 20.0
WALL_COLOR = "#b8bcc0"


def hex_rgb(color: str) -> tuple[int, int, int]:
    c = color.lstrip("#")
    if len(c) == 3:
        c = "".join(ch * 2 for ch in c)
    return int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16)


@dataclass
class Line:
    points: list[tuple[float, float]]
    width: float = TAPE_WIDTH
    color: str = BLACK_TAPE
    closed: bool = False

    def segments(self):
        pts = self.points + ([self.points[0]] if self.closed and len(self.points) > 2 else [])
        return list(itertools.pairwise(pts))

    def covers(self, x: float, y: float) -> bool:
        r = self.width / 2
        return any(_seg_dist(x, y, a, b) <= r for a, b in self.segments())


@dataclass
class Obstacle:
    shape: str  # "box" | "cylinder"
    center: tuple[float, float]
    size: tuple[float, float] = (100.0, 100.0)  # box sx, sy
    radius: float = 50.0  # cylinder
    height: float = 100.0
    yaw: float = 0.0  # deg, CCW
    color: str = "#c8102e"
    id: str = ""

    # -------------------------------------------------------------- geometry helpers
    def to_local(self, x: float, y: float) -> tuple[float, float]:
        c, s = math.cos(math.radians(self.yaw)), math.sin(math.radians(self.yaw))
        dx, dy = x - self.center[0], y - self.center[1]
        return dx * c + dy * s, -dx * s + dy * c

    def corners(self) -> list[tuple[float, float]]:
        hx, hy = self.size[0] / 2, self.size[1] / 2
        c, s = math.cos(math.radians(self.yaw)), math.sin(math.radians(self.yaw))
        cx, cy = self.center
        return [(cx + px * c - py * s, cy + px * s + py * c)
                for px, py in ((hx, hy), (-hx, hy), (-hx, -hy), (hx, -hy))]

    def ray(self, ox: float, oy: float, dx: float, dy: float) -> float | None:
        """Distance along a unit ray to this obstacle's outline (None if missed)."""
        if self.shape == "cylinder":
            fx, fy = ox - self.center[0], oy - self.center[1]
            b = fx * dx + fy * dy
            cc = fx * fx + fy * fy - self.radius ** 2
            disc = b * b - cc
            if disc < 0:
                return None
            sq = math.sqrt(disc)
            for t in (-b - sq, -b + sq):
                if t >= 0:
                    return t
            return None
        lx, ly = self.to_local(ox, oy)
        c, s = math.cos(math.radians(self.yaw)), math.sin(math.radians(self.yaw))
        ldx, ldy = dx * c + dy * s, -dx * s + dy * c
        hx, hy = self.size[0] / 2, self.size[1] / 2
        tmin, tmax = -math.inf, math.inf
        for o, d, h in ((lx, ldx, hx), (ly, ldy, hy)):
            if abs(d) < 1e-12:
                if abs(o) > h:
                    return None
                continue
            t1, t2 = (-h - o) / d, (h - o) / d
            tmin, tmax = max(tmin, min(t1, t2)), min(tmax, max(t1, t2))
        if tmax < max(tmin, 0.0):
            return None
        return tmin if tmin >= 0 else tmax

    def width_across(self, dx: float, dy: float) -> float:
        """Width of the obstacle seen along direction (dx, dy)."""
        if self.shape == "cylinder":
            return 2 * self.radius
        px, py = -dy, dx
        proj = [x * px + y * py for x, y in self.corners()]
        return max(proj) - min(proj)

    def overlaps_polygon(self, poly: list[tuple[float, float]]) -> bool:
        if self.shape == "cylinder":
            cx, cy = self.center
            if _point_in_poly(cx, cy, poly):
                return True
            n = len(poly)
            return any(_seg_dist(cx, cy, poly[i], poly[(i + 1) % n]) < self.radius for i in range(n))
        return _sat(poly, self.corners())

    def describe(self) -> dict:
        d = {"id": self.id, "shape": self.shape, "center": list(self.center), "height": self.height,
             "yaw": self.yaw, "color": self.color}
        if self.shape == "cylinder":
            d["radius"] = self.radius
        else:
            d["size"] = list(self.size)
        return d


@dataclass
class Field(Entity):
    """Static map. Also an Entity so the frontend receives it in the scene description."""

    name: str = "field"
    floor_size: tuple[float, float] = (2400.0, 2400.0)
    floor_color: str = WHITE
    lines: list[Line] = field(default_factory=list)
    obstacles: list[Obstacle] = field(default_factory=list)
    labels: list[dict] = field(default_factory=list)

    kind = "iq2_field"

    def __post_init__(self):
        Entity.__init__(self, self.name)

    @classmethod
    def from_scenario(cls, sc: dict) -> Field:
        f = cls(floor_size=tuple(sc.get("floor", {}).get("size", (2400.0, 2400.0))),
                floor_color=sc.get("floor", {}).get("color", WHITE))
        for spec in sc.get("lines", []) or []:
            f.lines.append(Line([tuple(map(float, p)) for p in spec["points"]],
                                float(spec.get("width", TAPE_WIDTH)), spec.get("color", BLACK_TAPE),
                                bool(spec.get("closed", False))))
        for i, spec in enumerate(sc.get("obstacles", []) or []):
            f.obstacles.append(Obstacle(
                shape=spec.get("shape", "box"),
                center=tuple(map(float, spec["center"])),
                size=tuple(map(float, spec.get("size", (100.0, 100.0)))),
                radius=float(spec.get("radius", 50.0)),
                height=float(spec.get("height", 100.0)),
                yaw=float(spec.get("yaw", 0.0)),
                color=spec.get("color", "#c8102e"),
                id=spec.get("id", f"obstacle_{i + 1}")))
        f.labels = list(sc.get("labels", []) or [])
        if sc.get("walls", True):
            f.add_walls(float(sc.get("wall_height", WALL_HEIGHT)))
        return f

    def add_walls(self, height: float = 75.0) -> None:
        """IQ-field-style perimeter walls just outside the mat, so a robot that goes astray
        stops against them instead of driving off forever. Their ids start with ``wall_``."""
        w, h = self.floor_size
        t = WALL_THICKNESS
        for wid, cx, cy, sx, sy in (("wall_n", 0, h / 2 + t / 2, w + 2 * t, t),
                                    ("wall_s", 0, -h / 2 - t / 2, w + 2 * t, t),
                                    ("wall_e", w / 2 + t / 2, 0, t, h),
                                    ("wall_w", -w / 2 - t / 2, 0, t, h)):
            self.obstacles.append(Obstacle(shape="box", center=(cx, cy), size=(sx, sy), height=height,
                                           color=WALL_COLOR, id=wid))

    # -------------------------------------------------------------- queries
    def floor_color_at(self, x: float, y: float) -> str:
        for ln in reversed(self.lines):  # later lines lie on top
            if ln.covers(x, y):
                return ln.color
        return self.floor_color

    def raycast(self, ox: float, oy: float, heading: float, z: float, max_range: float):
        """Nearest obstacle hit by a horizontal ray at height z. Returns (distance, obstacle)."""
        dx, dy = math.cos(heading), math.sin(heading)
        best, hit = None, None
        for ob in self.obstacles:
            if ob.height < z:
                continue
            t = ob.ray(ox, oy, dx, dy)
            if t is not None and t <= max_range and (best is None or t < best):
                best, hit = t, ob
        return best, hit

    def collides(self, poly: list[tuple[float, float]]) -> list[Obstacle]:
        return [ob for ob in self.obstacles if ob.overlaps_polygon(poly)]

    def describe(self) -> dict:
        return {
            "name": self.name, "kind": self.kind,
            "floor": {"size": list(self.floor_size), "color": self.floor_color},
            "lines": [{"points": [list(p) for p in ln.points], "width": ln.width, "color": ln.color,
                       "closed": ln.closed} for ln in self.lines],
            "obstacles": [ob.describe() for ob in self.obstacles],
            "labels": self.labels,
        }


# ---------------------------------------------------------------------- 2D helpers
def _seg_dist(px: float, py: float, a, b) -> float:
    ax, ay = a
    bx, by = b
    vx, vy = bx - ax, by - ay
    L2 = vx * vx + vy * vy
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((px - ax) * vx + (py - ay) * vy) / L2))
    return math.hypot(px - (ax + t * vx), py - (ay + t * vy))


def _point_in_poly(x: float, y: float, poly) -> bool:
    inside = False
    n = len(poly)
    for i in range(n):
        (x1, y1), (x2, y2) = poly[i], poly[(i + 1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def _sat(p1, p2) -> bool:
    """Separating-axis overlap test for two convex polygons."""
    for poly in (p1, p2):
        n = len(poly)
        for i in range(n):
            (x1, y1), (x2, y2) = poly[i], poly[(i + 1) % n]
            ax, ay = y1 - y2, x2 - x1
            a = [x * ax + y * ay for x, y in p1]
            b = [x * ax + y * ay for x, y in p2]
            if max(a) <= min(b) or max(b) <= min(a):
                return False
    return True
