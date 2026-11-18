"""CTE Tile grid: 6x6 numbered 50 mm locations, arm base at location 8 (origin)."""

from __future__ import annotations

TILE_SIZE = 333.0  # mm, REAL
TILE_HEIGHT = 28.0  # mm, MEASURED (tile top is z = 0 in the sim)
CELL = 50.0  # mm, REAL
GRID = 6
ORIGIN_LOCATION = 8


def location_to_xy(n: int) -> tuple[float, float]:
    """Centre of Tile location n (1-36) in arm coordinates (mm). Location 36 -> (200, 200)."""
    if not 1 <= n <= GRID * GRID:
        raise ValueError(f"tile location must be 1..36, got {n}")
    row, col = divmod(n - 1, GRID)
    return (row - 1) * CELL, (col - 1) * CELL


def xy_to_location(x: float, y: float) -> int | None:
    row = round(x / CELL) + 1
    col = round(y / CELL) + 1
    if 0 <= row < GRID and 0 <= col < GRID:
        return row * GRID + col + 1
    return None


def tile_bounds() -> tuple[float, float, float, float]:
    """(xmin, xmax, ymin, ymax) of the tile surface in arm coordinates."""
    cx = cy = -CELL + (GRID - 1) * CELL / 2  # centre of the grid = (75, 75)
    half = TILE_SIZE / 2
    return cx - half, cx + half, cy - half, cy + half


# ---------------------------------------------------------------------------- dry-erase surface
# Outline of the CTE Dry-Erase Surface ("whiteboard") laid on top of the Tile, in arm coordinates
# (mm). Traced from VEX's top-down product render (STEM Labs Unit 4): a white sheet covering the
# Tile with a rounded cut-out around the arm's base plate and a notch for the Signal Tower.
# All values ESTIMATE (+-3 mm).
WHITEBOARD = {
    "x_min": -66.0, "x_max": 214.0, "y_min": -64.0, "y_max": 216.0,
    "cutout": {"x": 86.0, "y": 89.0, "radius": 57.0},  # around the arm base (origin corner)
    "notch": {"x": -25.0, "y": 175.0},  # Signal Tower corner (location 6)
}


def whiteboard_outline(segments: int = 16) -> list[list[float]]:
    """Closed polygon (counter-clockwise) of the whiteboard sheet."""
    import math

    w = WHITEBOARD
    c, n = w["cutout"], w["notch"]
    pts = [
        [c["x"], w["y_min"]],
        [w["x_max"], w["y_min"]],
        [w["x_max"], w["y_max"]],
        [n["x"], w["y_max"]],
        [n["x"], n["y"]],
        [w["x_min"], n["y"]],
        [w["x_min"], c["y"]],
    ]
    # rounded corner of the base cut-out: from (cx - r, cy) to (cx, cy - r), centre (cx-r, cy-r)
    cx, cy = c["x"] - c["radius"], c["y"] - c["radius"]
    for i in range(segments + 1):
        a = math.pi / 2 - (math.pi / 2) * i / segments
        pts.append([round(cx + c["radius"] * math.cos(a), 2), round(cy + c["radius"] * math.sin(a), 2)])
    return pts


def whiteboard_screws() -> list[list[float]]:
    w = WHITEBOARD
    inset = 10.0
    return [
        [w["x_min"] + inset, w["cutout"]["y"] + inset],
        [w["x_min"] + inset, w["notch"]["y"] - inset],
        [w["x_max"] - inset, w["y_min"] + inset],
        [w["x_max"] - inset, w["y_max"] - inset],
        [w["cutout"]["x"] + inset, w["y_min"] + inset],
    ]


def point_on_whiteboard(x: float, y: float) -> bool:
    w = WHITEBOARD
    if not (w["x_min"] <= x <= w["x_max"] and w["y_min"] <= y <= w["y_max"]):
        return False
    if x < w["notch"]["x"] and y > w["notch"]["y"]:
        return False
    c = w["cutout"]
    if x < c["x"] and y < c["y"]:
        cx, cy = c["x"] - c["radius"], c["y"] - c["radius"]
        if x <= cx or y <= cy:
            return False
        return (x - cx) ** 2 + (y - cy) ** 2 > c["radius"] ** 2
    return True
