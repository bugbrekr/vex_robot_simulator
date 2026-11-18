"""Rule-based end effector behaviour: magnet pick/place and pen drawing."""

from __future__ import annotations

import math

import numpy as np

from vexsim.core.transforms import rz
from vexsim.core.world import World

PICK_ABOVE = 5.0  # mm: magnet may be up to this far above the cube top
PICK_BELOW = 3.0  # mm: ...or this far "into" it (positioning tolerance)
TOOL_DOWN_COS = 0.7  # tool axis must point mostly downward to pick
PEN_DRAW_Z = 0.5  # mm: pen tip at or below this height marks the surface
PEN_MIN_SEGMENT = 0.5  # mm between recorded stroke points


class Magnet:
    """Electromagnet on the Magnet Pickup Tool. The cubes are ferromagnetic: when the magnet is
    engaged and a cube's top face is within reach of the magnet face, the cube jumps up and
    sticks flush against the face. Releasing drops it onto whatever is below."""

    def __init__(self, world: World):
        self.world = world
        self.on = False
        self.held = None
        self._p_rel = np.zeros(3)
        self._r_rel = np.eye(3)

    def try_pick(self, tcp: np.ndarray, r_ee: np.ndarray) -> None:
        if not self.on or self.held is not None:
            return
        if r_ee[2, 2] < TOOL_DOWN_COS:  # tool points along -z_ee; it must point mostly down
            return
        best, best_d = None, math.inf
        for o in self.world.objects.values():
            if o.held or o.user_grab:
                continue
            dz = tcp[2] - o.top_z
            dxy = math.hypot(tcp[0] - o.position[0], tcp[1] - o.position[1])
            if -PICK_BELOW <= dz <= PICK_ABOVE and dxy <= o.half_height:
                if dxy < best_d:
                    best, best_d = o, dxy
        if best is not None:
            self.held = best
            best.held = True
            # snap flush: cube top face against the magnet face, centred under the tool axis
            yaw = math.atan2(best.rotation[1, 0], best.rotation[0, 0])
            best.rotation = rz(yaw)
            centre = tcp - r_ee[:, 2] * best.half_height
            self._p_rel = r_ee.T @ (centre - tcp)
            self._r_rel = r_ee.T @ best.rotation
            best.position = centre
            self.world.settle()

    def carry(self, tcp: np.ndarray, r_ee: np.ndarray) -> None:
        if self.held is not None:
            self.held.position = tcp + r_ee @ self._p_rel
            self.held.rotation = r_ee @ self._r_rel

    def detach(self) -> None:
        """Forget the held cube without dropping it (e.g. the user pulled it off)."""
        if self.held is not None:
            self.held.held = False
            self.held = None

    def release(self) -> None:
        o = self.held
        if o is None:
            return
        self.held = None
        o.held = False
        self.world.drop(o)


class Pen:
    def __init__(self) -> None:
        self.strokes: list[list[list[float]]] = []
        self._drawing = False
        self._pending: list[tuple[int, list[float]]] = []

    def update(self, tcp: np.ndarray, active: bool, drawable=None) -> None:
        """Record ink where the marker tip touches a drawable surface (the whiteboard sheet).
        The bare plastic Tile and anything off the Tile take no ink."""
        touching = (active and tcp[2] <= PEN_DRAW_Z
                    and (drawable is None or drawable(float(tcp[0]), float(tcp[1]))))
        if not touching:
            self._drawing = False
            return
        pt = [round(float(tcp[0]), 2), round(float(tcp[1]), 2)]
        if not self._drawing:
            self.strokes.append([pt])
            self._drawing = True
            self._pending.append((len(self.strokes) - 1, pt))
            return
        last = self.strokes[-1][-1]
        if math.hypot(pt[0] - last[0], pt[1] - last[1]) >= PEN_MIN_SEGMENT:
            self.strokes[-1].append(pt)
            self._pending.append((len(self.strokes) - 1, pt))

    def erase(self) -> None:
        """Wipe the dry-erase surface."""
        self.strokes = []
        self._drawing = False
        self._pending = [(-1, [0.0, 0.0])]  # sentinel: frontend clears its strokes

    def drain(self) -> list[tuple[int, list[float]]]:
        out, self._pending = self._pending, []
        return out
