import json
import time

from fastapi.testclient import TestClient

from vexsim.server.app import app


def test_scenarios_endpoint():
    c = TestClient(app)
    ids = [s["id"] for s in c.get("/vex_cte/api/platforms/cte/scenarios").json()]
    # the two base maps first, then the lab-manual experiment maps
    assert ids == ["cte_tile", "whiteboard", "exp4_palletizing", "exp6a_transfer", "exp6b_cube_walls"]
    exs = c.get("/vex_cte/api/platforms/cte/examples").json()
    assert {e["map"] for e in exs} <= set(ids)
    assert "from cte import" in c.get(f"/vex_cte/api/platforms/cte/examples/{exs[0]['id']}").json()["code"]


def test_ws_run_program():
    c = TestClient(app)
    code = "from vex import *\narm = Arm()\narm.move_inc(20, 0, 0)\nprint('done', arm.get_x())\n"
    with c.websocket_connect("/vex_cte/ws/cte") as ws:
        ws.send_text(json.dumps({"type": "speed", "value": 0}))
        ws.send_text(json.dumps({"type": "run", "scenario": "cte_tile", "code": code}))
        seen, console, deadline = set(), "", time.time() + 20
        while time.time() < deadline:
            msg = json.loads(ws.receive_text())
            seen.add(msg["type"])
            if msg["type"] == "console":
                console += msg["text"]
            if msg["type"] == "status" and msg["state"] == "finished":
                break
        assert {"hello", "frame", "status"} <= seen
        ws.send_text(json.dumps({"type": "stop"}))
        # drain until console arrives with the next frame
        while "done" not in console and time.time() < deadline:
            msg = json.loads(ws.receive_text())
            if msg["type"] == "console":
                console += msg["text"]
        assert "done 140.0" in console


def test_ws_pendant_commands_forwarded():
    """Teach Pendant commands must reach the worker (regression: server whitelist)."""
    c = TestClient(app)
    with c.websocket_connect("/vex_cte/ws/cte") as ws:
        ws.send_text(json.dumps({"type": "reset", "scenario": "cte_tile"}))
        ws.send_text(json.dumps({"type": "manual", "enabled": True}))
        ws.send_text(json.dumps({"type": "drag", "pos": [180, 40, 90]}))
        deadline = time.time() + 20
        while time.time() < deadline:
            msg = json.loads(ws.receive_text())
            if (msg["type"] == "frame" and msg["arm"]["manual"]
                    and max(abs(a - b) for a, b in zip(msg["arm"]["tip"], [180, 40, 90])) < 1):
                break
        else:
            raise AssertionError("manual drag never applied")


def test_base_path_redirects_are_relative():
    c = TestClient(app)
    r = c.get("/vex_cte", follow_redirects=False)
    assert r.status_code == 308 and r.headers["location"] == "vex_cte/"
    r = c.get("/", follow_redirects=False)
    assert r.headers["location"] == "vex_cte/"
    assert c.get("/vex_cte/api/health").json()["base_path"] == "/vex_cte"
    assert c.get("/api/platforms/cte/scenarios").status_code == 404  # only under the base path


def test_stats_counts_browsers_and_tabs_without_identifying_them():
    with TestClient(app) as c:
        base = c.get("/vex_cte/api/stats").json()["clients"]  # other tests may have left sessions open
        with c.websocket_connect("/vex_cte/ws/iq2?cid=browserA") as a1, \
                c.websocket_connect("/vex_cte/ws/cte?cid=browserA") as a2, \
                c.websocket_connect("/vex_cte/ws/iq2?cid=browserB") as b1:
            for ws in (a1, a2, b1):
                ws.receive_text()  # server build message
            st = c.get("/vex_cte/api/stats").json()
            delta = {k: st["clients"][k] - base[k] for k in base}
            assert delta == {"browsers": 2, "tabs": 3, "tabs_cte": 1, "tabs_iq2": 2}
            assert "browserA" not in str(st)  # ids are only counted, never returned
            assert set(st) == {"uptime", "cpu", "memory", "clients", "simulations", "totals", "history"}
        assert c.get("/vex_cte/api/stats").json()["clients"]["tabs"] == base["tabs"]
