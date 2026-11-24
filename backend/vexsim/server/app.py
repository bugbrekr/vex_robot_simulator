"""FastAPI app: scenario REST endpoints + simulation WebSocket + built frontend.

Everything is served under one base path (default ``/vex_cte``, env ``VEXSIM_BASE_PATH``):

    <base>/              the simulator page (built frontend)
    <base>/api/...       REST
    <base>/ws/<platform> simulation WebSocket

The frontend only uses *relative* URLs, so a reverse proxy may put any prefix in front
(e.g. nginx ``location /vexsimulator/ { proxy_pass http://127.0.0.1:8000/; }`` serves it at
``/vexsimulator/vex_cte/``). Redirects are relative too, so they survive the prefix.
"""

from __future__ import annotations

import contextlib
import json
import os
from pathlib import Path

from fastapi import APIRouter, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles

from vexsim.core.config import list_examples, list_scenarios, load_example, load_scenario
from vexsim.server.sandbox import SandboxConfig
from vexsim.server.sessions import Session
from vexsim.server.stats import STATS

BASE_PATH = "/" + os.environ.get("VEXSIM_BASE_PATH", "/vex_cte").strip("/")
FRONTEND_DIST = Path(os.environ.get("VEXSIM_FRONTEND_DIST",
                                    Path(__file__).resolve().parents[3] / "frontend" / "dist"))

def _build_id() -> str | None:
    try:
        return json.loads((FRONTEND_DIST / "build.json").read_text())["build"]
    except (OSError, ValueError, KeyError):
        return None


class _Frontend(StaticFiles):
    """Built frontend. HTML is always revalidated (so a reload picks up a new build);
    the hashed assets under assets/ may be cached."""

    def file_response(self, *args, **kwargs):
        resp = super().file_response(*args, **kwargs)
        if resp.media_type == "text/html":
            resp.headers["Cache-Control"] = "no-cache"
        return resp


SANDBOX = SandboxConfig.from_env()


@contextlib.asynccontextmanager
async def _lifespan(_app):
    if SANDBOX.mode == "docker":
        code, out = await SANDBOX._docker("image", "inspect", "--format", "{{.Id}} {{.Created}}",
                                          SANDBOX.image)
        info = out.strip()[:80] if code == 0 else f"NOT FOUND ({out.strip()[:120]})"
        print(f"vexsim: sandbox via '{SANDBOX.docker}', image {SANDBOX.image}: {info}")
        ok, msg = await SANDBOX.self_check()
        print(f"vexsim: {msg}" if ok else f"vexsim: SANDBOX CHECK FAILED - {msg}", flush=True)
    removed = await SANDBOX.cleanup_leftovers()  # containers orphaned by a crashed server
    if removed:
        print(f"vexsim: removed {removed} leftover worker container(s)")
    STATS.start()
    yield
    await STATS.stop()


app = FastAPI(title="VEX Simulator", docs_url=f"{BASE_PATH}/api/docs",
              openapi_url=f"{BASE_PATH}/api/openapi.json", redirect_slashes=False, lifespan=_lifespan)
router = APIRouter(prefix=BASE_PATH)


@router.get("/api/platforms/{platform}/scenarios")
def scenarios(platform: str) -> list[dict]:
    out = []
    for sid in list_scenarios(platform):
        s = load_scenario(platform, sid)
        out.append({"id": sid, "name": s.get("name", sid), "description": s.get("description", "")})
    return out


@router.get("/api/platforms/{platform}/scenarios/{sid}")
def scenario(platform: str, sid: str) -> dict:
    try:
        s = load_scenario(platform, sid)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    return {"id": sid, "name": s.get("name", sid), "description": s.get("description", "")}


@router.get("/api/platforms/{platform}/examples")
def examples(platform: str) -> list[dict]:
    return list_examples(platform)


@router.get("/api/platforms/{platform}/examples/{eid}")
def example(platform: str, eid: str) -> dict:
    try:
        return load_example(platform, eid)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.get("/api/health")
def health() -> dict:
    return {"ok": True, "base_path": BASE_PATH, "frontend": FRONTEND_DIST.is_dir(), "build": _build_id(),
            "sandbox": SANDBOX.mode}


@router.get("/api/stats")
def stats(response: Response) -> dict:
    """Public server statistics: aggregate counts and host load only (see server/stats.py)."""
    response.headers["Cache-Control"] = "no-store"
    return STATS.snapshot(SANDBOX.mode)


@router.websocket("/ws/{platform}")
async def ws_session(ws: WebSocket, platform: str) -> None:
    await ws.accept()
    # tell the page which frontend build is being served (stale tabs offer a reload)
    await ws.send_text(json.dumps({"type": "server", "build": _build_id()}))
    session = Session(ws.send_text, platform, SANDBOX)
    # a random per-browser id (localStorage), used only to count distinct browsers
    STATS.open(session.key, platform if platform in ("cte", "iq2") else "other", ws.query_params.get("cid", ""))
    try:
        while True:
            msg = json.loads(await ws.receive_text())
            await session.command(msg)
    except WebSocketDisconnect:
        pass
    finally:
        await session.kill()
        STATS.close(session.key)


app.include_router(router)

_leaf = BASE_PATH.rsplit("/", 1)[-1]


@app.get(BASE_PATH, include_in_schema=False)
def _add_slash() -> RedirectResponse:
    # relative redirect ("vex_cte/") so it also works behind a proxy prefix
    return RedirectResponse(f"{_leaf}/", status_code=308)


if BASE_PATH != "/":

    @app.get("/", include_in_schema=False)
    def _root() -> RedirectResponse:
        return RedirectResponse(f"{BASE_PATH.lstrip('/')}/", status_code=307)


if FRONTEND_DIST.is_dir():
    app.mount(f"{BASE_PATH}/", _Frontend(directory=FRONTEND_DIST, html=True), name="frontend")
else:

    @app.get(f"{BASE_PATH}/", include_in_schema=False)
    def no_frontend() -> HTMLResponse:
        return HTMLResponse("<h1>VEX Simulator API</h1><p>Frontend not built. Run "
                            "<code>npm install && npm run build</code> in <code>frontend/</code>, "
                            "or <code>npm run dev</code> for development.</p>")
