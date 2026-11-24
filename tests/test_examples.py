import pathlib

import pytest
import yaml

ROOT = pathlib.Path("backend/vexsim/examples/cte")
EXAMPLES = yaml.safe_load((ROOT / "index.yaml").read_text())


# known: Exp 6.2's source cell 3 is out of the simulated arm's reach (see the file's header)
KNOWN_WARNINGS = {"exp06b_obstacles": "unreachable"}


@pytest.mark.parametrize("ex", EXAMPLES, ids=[e["id"] for e in EXAMPLES])
def test_example_runs_clean(run, ex):
    s = run((ROOT / ex["file"]).read_text(), scenario=ex["map"], tool=ex.get("tool"))
    assert s["state"] == "finished"
    assert not s["errors"]
    known = KNOWN_WARNINGS.get(ex["id"])
    assert all(known and known in w for w in s["warnings"]), s["warnings"]


def test_lab_pick_and_place_land_in_the_right_cell(run):
    from vexsim.robots.cte_arm.tile import location_to_xy

    for eid, cell in (("exp04_palletizing", 29), ("exp06a_transfer", None)):
        ex = next(e for e in EXAMPLES if e["id"] == eid)
        s = run((ROOT / ex["file"]).read_text(), scenario=ex["map"], tool=ex["tool"])
        x, y, _ = s["objects"][0]["pos"]
        tx, ty = location_to_xy(cell) if cell else (50, 150)
        assert abs(x - tx) < 3 and abs(y - ty) < 3
