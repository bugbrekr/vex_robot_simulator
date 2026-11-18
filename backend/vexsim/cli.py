"""Command line entry point: ``vexsim run`` (headless) and ``vexsim serve`` (web UI)."""

from __future__ import annotations

import argparse
import json
import os
import sys


def _run(args) -> int:
    from vexsim.runner.worker import Worker

    with open(args.script, encoding="utf-8") as f:
        code = f.read()

    def emit(msg):
        if msg["type"] == "warning":
            print(f"[sim t={msg.get('t', 0):.2f}s] {msg['text']}", file=sys.stderr)
        elif msg["type"] == "error":
            line = f" (line {msg['line']})" if msg.get("line") else ""
            print(f"[error]{line} {msg['message']}", file=sys.stderr)

    w = Worker(args.platform, args.scenario, code, emit=emit, max_time=args.max_time)
    summary = w.run_headless()
    if args.json:
        summary.pop("arm", None) if not args.verbose else None
        print(json.dumps(summary, indent=2))
    else:
        sys.stdout.write(summary["console"])
        print(f"--- {summary['state']} at t={summary['t']:.2f}s (sim time)")
        arm = summary.get("arm")
        if arm:
            print(f"arm tcp={arm['tcp']} rpy={arm['rpy']} tool={arm['tool']} holding={arm['holding']}")
        for o in summary["objects"]:
            print(f"{o['id']}: pos={o['pos']}")
    return 1 if summary["errors"] else 0


def _serve(args) -> int:
    import os

    import uvicorn

    os.environ["VEXSIM_BASE_PATH"] = args.base_path
    print(f"VEX Simulator: http://{args.host}:{args.port}/{args.base_path.strip('/')}/")
    uvicorn.run("vexsim.server.app:app", host=args.host, port=args.port, reload=args.reload,
                proxy_headers=True, forwarded_allow_ips=args.forwarded_allow_ips)
    return 0


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="vexsim")
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run", help="run a student program headless")
    r.add_argument("script")
    r.add_argument("--platform", default="cte")
    r.add_argument("--scenario", default="cte_tile")
    r.add_argument("--max-time", type=float, default=300.0, help="sim-time limit (s)")
    r.add_argument("--json", action="store_true")
    r.add_argument("--verbose", action="store_true")
    r.add_argument("--headless", action="store_true", help="(default; accepted for clarity)")
    s = sub.add_parser("serve", help="start the web simulator")
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=8000)
    s.add_argument("--reload", action="store_true")
    s.add_argument("--base-path", default=os.environ.get("VEXSIM_BASE_PATH", "/vex_cte"),
                   help="URL path the app is served under (default /vex_cte)")
    s.add_argument("--forwarded-allow-ips", default="127.0.0.1",
                   help="proxies trusted for X-Forwarded-* headers (your nginx)")
    args = ap.parse_args(argv)
    sys.exit(_run(args) if args.cmd == "run" else _serve(args))


if __name__ == "__main__":
    main()
