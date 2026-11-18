import pathlib

import pytest
import yaml

ROOT = pathlib.Path("backend/vexsim/examples/cte")
EXAMPLES = yaml.safe_load((ROOT / "index.yaml").read_text())


@pytest.mark.parametrize("ex", EXAMPLES, ids=[e["id"] for e in EXAMPLES])
def test_example_runs_clean(run, ex):
    s = run((ROOT / ex["file"]).read_text(), scenario=ex["map"], tool=ex.get("tool"))
    assert s["state"] == "finished"
    assert not s["errors"]
    assert not s["warnings"]
