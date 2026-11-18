import pytest

from vexsim.runner.worker import Worker


@pytest.fixture
def run():
    """run(code, scenario='arm_only') -> headless summary dict (+ 'worker')."""

    def _run(code: str, scenario: str = "cte_tile", max_time: float = 120.0, tool: str | None = None):
        warnings = []
        w = Worker("cte", scenario, code, max_time=max_time, mounted_tool=tool,
                   emit=lambda m: warnings.append(m["text"]) if m["type"] == "warning" else None)
        s = w.run_headless()
        s["warnings"] = warnings
        s["worker"] = w
        return s

    return _run


HEADER = "from vex import *\nbrain = Brain()\narm = Arm()\ntower = SignalTower(Ports.PORT1)\n"
