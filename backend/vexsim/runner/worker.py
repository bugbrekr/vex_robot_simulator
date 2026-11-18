"""Simulation worker: one persistent scene that student programs run against.

The scene (arm pose, mounted tool, cubes, whiteboard strokes, tower LEDs) survives program runs,
stops and mode changes. Each Run creates a fresh ``Runtime`` (threads, callbacks, timers),
resets the documented per-project defaults (speed 50 %, MAGNET, pen offset 0, magnet off) and
first homes the arm to the safe position, then starts the student code.

Used as a subprocess by the server (``python -m vexsim.runner.worker``; JSON lines on stdio) or
in-process for headless runs/tests via ``Worker(...).run_headless()``.
"""

from __future__ import annotations

import argparse
import importlib
import json
import queue
import sys
import threading
import time
from typing import Any

import numpy as np

from vexsim.api.common import runtime as rt_mod
from vexsim.api.common.brain import sim_print
from vexsim.api.common.runtime import STUDENT_FILENAME, Runtime, install_time_patch
from vexsim.core.config import load_scenario
from vexsim.core.engine import SimEngine
from vexsim.core.transforms import rpy_to_matrix
from vexsim.robots.cte_arm.kinematics import MAGNET, PEN, matrix_to_rpy_deg

FRAME_INTERVAL = 1 / 30  # wall seconds between frames sent to the UI
PENDANT_CMDS = ("jog", "tool", "safe", "manual", "drag", "drag_end")
OBJECT_CMDS = ("add_object", "grab_object", "move_object", "drop_object", "remove_object",
               "clear_objects")


def build_platform(platform: str, engine: SimEngine, scenario: dict) -> tuple[dict, dict]:
    """Return (devices, scene description) for a platform."""
    if platform == "cte":
        from vexsim.robots.cte_arm.scene import build_scene, describe_tile

        devices = build_scene(engine, scenario)
        scene = {
            "platform": "cte",
            "scenario": {k: scenario.get(k) for k in ("id", "name", "description")},
            "tile": describe_tile(scenario),
            "entities": [e.describe() for e in engine.entities],
        }
        return devices, scene
    raise ValueError(f"unsupported platform {platform!r}")


class Worker:
    def __init__(
        self,
        platform: str,
        scenario: str | dict,
        code: str | None = None,
        speed: float = 1.0,
        emit=None,
        interactive: bool = False,
        max_time: float | None = None,
        mounted_tool: str | None = None,
        marker_protrusion: float | None = None,
    ):
        self.platform = platform
        self.scenario = load_scenario(platform, scenario) if isinstance(scenario, str) else scenario
        # the mounted end effector is hardware, not part of the map: carried over by the caller
        if mounted_tool or marker_protrusion is not None:
            self.scenario = {**self.scenario, "arm": {**(self.scenario.get("arm") or {}),
                                                      "mounted_tool": mounted_tool,
                                                      "marker_protrusion": marker_protrusion}}
        self.code = code
        self.speed = speed
        self.emit = emit or (lambda msg: None)
        self.interactive = interactive
        self.max_time = max_time
        self.engine = SimEngine()
        self.devices, self.scene = build_platform(platform, self.engine, self.scenario)
        self.console: list[str] = []
        self._console_pending: list[str] = []
        self._console_lock = threading.Lock()
        self.rt = self._new_runtime()
        self.state = "idle"
        self.phase = ""  # "homing" while the arm goes to the safe position before a run
        self.quit = False
        self.paused = False
        self.commands: queue.Queue = queue.Queue()
        self._last_frame = 0.0
        self._run_deadline: float | None = None
        install_time_patch()

    # ------------------------------------------------------------------ runtime / console
    def _new_runtime(self) -> Runtime:
        rt = Runtime(self.engine, self.devices, self.platform)
        rt.console_out = self._on_console
        rt.warn_out = lambda s: self.emit({"type": "warning", "text": s, "t": self.engine.t})
        rt.error_out = self._on_error
        return rt

    def _on_console(self, text: str) -> None:
        with self._console_lock:
            self.console.append(text)
            self._console_pending.append(text)

    def _flush_console(self) -> None:
        with self._console_lock:
            pending, self._console_pending = self._console_pending, []
        if pending:
            self.emit({"type": "console", "text": "".join(pending)})

    def _on_error(self, err: dict) -> None:
        self._flush_console()
        self.emit({"type": "error", **err})

    def _warn(self, text: str) -> None:
        self.emit({"type": "warning", "text": text, "t": self.engine.t})

    def _set_state(self, state: str) -> None:
        if self.state != state:
            self._flush_console()  # keep console output ordered before the status change
            self.state = state
            self.emit({"type": "status", "state": state})

    # ------------------------------------------------------------------ program lifecycle
    def _program_main(self, code: str) -> None:
        code_obj = compile(code, STUDENT_FILENAME, "exec")
        ns: dict[str, Any] = {"__name__": "__main__", "print": sim_print}
        exec(code_obj, ns)  # noqa: S102 - running student code is the point

    def start_program(self, code: str | None = None) -> None:
        """Begin a project run: reset per-project state, home the arm, then run the code."""
        code = self.code if code is None else code
        if code is None:
            return
        if self.state == "running":
            self.stop_program(quiet=True)
        self.code = code
        self.rt = self._new_runtime()
        sys.modules["vex"] = importlib.import_module(f"vexsim.api.{self.platform}")
        rt_mod.install(self.rt)
        self._run_deadline = None if self.max_time is None else self.engine.t + self.max_time
        try:
            compile(code, STUDENT_FILENAME, "exec")
        except SyntaxError as exc:
            self._set_state("running")
            self.rt.report_error(exc)
            self.rt.errors[-1]["line"] = exc.lineno
            self._set_state("finished")
            return
        with self.engine.lock:
            self.engine.clear_timers()
            for dev in self.devices.values():
                reset = getattr(dev, "reset_for_program", None)
                if reset:
                    reset()
            arm = self.devices.get("arm")
            homing = arm is not None and not arm.at_safe_position()
            if homing and arm.move_to_safe() is None:
                homing = False
        self.phase = "homing" if homing else ""
        self._set_state("running")
        if not homing:
            self._launch()

    def _launch(self) -> None:
        self.phase = ""
        self.rt.start_thread(self._program_main, (self.code,), name="main")

    def _program_done(self) -> bool:
        if self.phase == "homing":
            return False
        arm = self.devices.get("arm")
        moving = arm is not None and arm.is_moving()
        world = self.devices.get("world")
        moving = moving or (world is not None and not world.is_settled())  # cubes still falling
        return (
            self.rt.live_threads() == 0
            and not moving
            and not self.engine.has_timers()
            and (self.rt.callbacks_registered == 0 or not self.interactive)
        )

    def stop_program(self, quiet: bool = False) -> None:
        if self.state != "running":
            return
        self.rt.stop_all()
        self.phase = ""
        with self.engine.lock:
            self.engine.clear_timers()
            arm = self.devices.get("arm")
            if arm is not None:
                arm.abort_move()
        if not quiet:
            self._set_state("stopped")

    # ------------------------------------------------------------------ commands
    def _handle(self, cmd: dict) -> None:
        kind = cmd.get("type")
        if kind == "run":
            self.start_program(cmd.get("code", ""))
        elif kind == "stop":
            self.stop_program()
        elif kind == "quit":
            self.stop_program()
            self.quit = True
        elif kind == "speed":
            self.speed = float(cmd.get("value", 1.0))
        elif kind == "pause":
            self.paused = bool(cmd.get("value", True))
        elif kind == "bumper":
            tower = self.devices.get("signal_tower")
            if tower is not None:
                with self.engine.lock:
                    tower.set_bumper(bool(cmd.get("pressed")))
        elif kind == "erase":
            arm = self.devices.get("arm")
            if arm is not None:
                with self.engine.lock:
                    arm.pen.erase()
        elif kind in OBJECT_CMDS:  # cubes can be manipulated at any time
            self._objects(cmd)
        elif kind == "sim_home":  # simulator-only: teleport the arm to the safe position
            self._sim_home()
        elif kind == "marker":  # simulator-only: physical marker protrusion
            arm = self.devices.get("arm")
            if arm is not None:
                with self.engine.lock:
                    arm.marker_protrusion = float(cmd.get("protrusion", arm.marker_protrusion))
        elif kind in PENDANT_CMDS:
            if self.state == "running" and kind not in ("drag", "drag_end"):
                self._warn("The Teach Pendant is disabled while a project is running")
                return
            if self.state != "running":
                self._pendant(cmd)

    def _sim_home(self) -> None:
        arm = self.devices.get("arm")
        if arm is None or self.state == "running":
            return
        with self.engine.lock:
            arm.set_manual(False)
            arm.abort_move()
            from vexsim.robots.cte_arm.kinematics import rpy_deg_to_matrix

            q = arm.kin.ik(np.array(arm.g.start_position), rpy_deg_to_matrix(*arm.g.start_orientation),
                           near=np.zeros(6), tool=arm.tool, pen_offset=arm.pen_offset)
            if q is not None:
                arm.q = q
                arm.control_stopped = False
                arm.crashed = False

    def _objects(self, cmd: dict) -> None:
        world = self.devices.get("world")
        arm = self.devices.get("arm")
        if world is None:
            return
        kind = cmd["type"]
        with self.engine.lock:
            if kind == "add_object":
                x, y = float(cmd["x"]), float(cmd["y"])
                if world.on_surface(x, y):
                    world.spawn({"kind": cmd.get("kind", "cube"), "x": x, "y": y,
                                 "yaw": float(cmd.get("yaw", 0.0))},
                                drop_from=cmd.get("z"))
                return
            if kind == "clear_objects":
                if arm is not None:
                    arm.magnet.detach()
                world.clear()
                return
            o = world.objects.get(cmd.get("id"))
            if o is None:
                return
            if kind == "grab_object":
                if arm is not None and arm.magnet.held is o:
                    arm.magnet.detach()  # pulled off the magnet by hand
                o.user_grab = True
                world.settle()
            elif kind == "move_object":
                if o.user_grab:
                    o.position = np.array([float(v) for v in cmd["pos"]])
            elif kind == "drop_object":
                o.user_grab = False
                x, y = float(cmd["x"]), float(cmd["y"])
                if cmd.get("delete") or not world.on_surface(x, y):
                    world.remove(o.id)
                else:
                    o.position = np.array([x, y, o.position[2]])
                    world.drop(o)
            elif kind == "remove_object":
                if arm is not None and arm.magnet.held is o:
                    arm.magnet.detach()
                world.remove(o.id)

    def _pendant(self, cmd: dict) -> None:
        """Teach Pendant actions (only when no project is running)."""
        arm = self.devices.get("arm")
        if arm is None:
            return
        kind = cmd["type"]
        with self.engine.lock:
            if kind == "tool":
                if "magnet" in cmd:
                    if arm.mounted_tool != MAGNET and cmd["magnet"]:
                        self._warn("The Magnet Pickup Tool is not mounted")
                    arm.set_magnet(bool(cmd["magnet"]))
                was_safe = arm.at_safe_position()
                if "pen_offset" in cmd:
                    arm.pen_offset = float(cmd["pen_offset"])
                if "tool" in cmd:
                    tool = PEN if cmd["tool"] == "pen" else MAGNET
                    if tool != arm.mounted_tool:
                        if not was_safe:
                            self._warn("Move to Safe Position before changing the end effector")
                        else:
                            arm.mount_tool(tool, force=True)
                if "pen_offset" in cmd and was_safe and not arm.is_moving():
                    arm.move_to_safe()  # the TCP moved: re-home so we stay "at safe position"
                if "speed" in cmd:
                    arm.speed = max(1, min(100, int(cmd["speed"])))
                return
            if kind == "manual":
                enable = bool(cmd.get("enabled"))
                if enable and not arm.manual_mode and not arm.at_safe_position():
                    self._warn("Move to Safe Position before enabling Manual Mode")
                    return
                arm.set_manual(enable)
                return
            if kind == "drag":
                if arm.manual_mode:
                    arm.drag_to(np.array(cmd["pos"], dtype=float), upright=bool(cmd.get("upright")))
                return
            if kind == "drag_end":
                arm.drag_end()
                return
            if kind == "safe":
                arm.set_manual(False)
                if arm.control_stopped:
                    self._warn("Failed to move to safe position: controlled stop enabled")
                elif arm.move_to_safe() is None:
                    self._warn("Failed to move to safe position")
                return
            # jog
            if arm.manual_mode or arm.is_moving():
                return
            p, r = arm.target_pose()
            mode = cmd.get("mode")
            if mode == "abs":
                p = np.array(cmd["pos"], dtype=float)
            elif mode == "rpy":
                d = np.array(cmd.get("delta", [0, 0, 0]), dtype=float)
                y, ro, pi = matrix_to_rpy_deg(r)
                r = rpy_to_matrix(*np.radians([y + d[0], ro + d[1], pi + d[2]]))
            else:
                p = p + np.array(cmd.get("delta", [0, 0, 0]), dtype=float)
            if arm.start_move(p, r) is None:
                why = "controlled stop enabled" if arm.control_stopped else "position unreachable"
                self._warn(f"Unable to move: {why}")

    # ------------------------------------------------------------------ frames
    def frame(self) -> dict:
        with self.engine.lock:
            msg: dict[str, Any] = {"type": "frame", "t": round(self.engine.t, 3),
                                   "state": self.state, "phase": self.phase,
                                   "paused": self.paused}
            for key in ("arm", "signal_tower", "world"):
                dev = self.devices.get(key)
                if dev is not None:
                    msg[key] = dev.snapshot()
        return msg

    def _on_step(self) -> None:
        while True:
            try:
                self._handle(self.commands.get_nowait())
            except queue.Empty:
                break
        if self.state == "running" and self.phase == "homing":
            arm = self.devices.get("arm")
            if arm is None or not arm.is_moving():
                self._launch()
        if self.state == "running" and self._program_done():
            self._set_state("finished")
        if self._run_deadline is not None and self.engine.t >= self._run_deadline:
            if self.state == "running":
                self._warn(f"time limit {self.max_time}s reached")
                self.stop_program()
            self._run_deadline = None
            if not self.interactive:
                self.quit = True
        if not self.interactive and self.state in ("finished", "stopped", "idle"):
            self.quit = True
        now = time.perf_counter()
        if self.interactive and now - self._last_frame >= FRAME_INTERVAL:
            self._last_frame = now
            self._flush_console()
            self.emit(self.frame())

    def _pace(self) -> float:
        # outside a running project (idle, manual mode...) always pace at real time
        if self.state == "running" or not self.interactive:
            return self.speed
        return 1.0

    # ------------------------------------------------------------------ entry points
    def run(self) -> None:
        self.emit({"type": "hello", "scene": self.scene})
        self.emit(self.frame())
        self.start_program()
        if not self.interactive and self.code is None:
            return
        try:
            self.engine.run_loop(
                should_continue=lambda: not self.quit,
                speed=self._pace,
                all_blocked=lambda: self.rt.all_blocked(),
                on_step=self._on_step,
                paused=lambda: self.paused,
            )
        finally:
            self.rt.stop_all()
            self._flush_console()
            self.emit(self.frame())

    def run_headless(self) -> dict:
        """Run to completion as fast as possible; return a summary."""
        self.speed = 0.0
        self.interactive = False
        self.run()
        final = self.frame()
        return {
            "state": self.state,
            "t": self.engine.t,
            "console": "".join(self.console),
            "errors": self.rt.errors,
            "arm": final.get("arm"),
            "objects": (final.get("world") or {}).get("objects", []),
            "signal_tower": final.get("signal_tower"),
        }


# ---------------------------------------------------------------------- subprocess main
def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="vexsim worker (JSON lines on stdio)")
    ap.add_argument("--platform", default="cte")
    ap.add_argument("--scenario", default="cte_tile")
    ap.add_argument("--code-file")
    ap.add_argument("--speed", type=float, default=1.0)
    ap.add_argument("--mounted-tool", choices=["magnet", "pen"])
    ap.add_argument("--marker", type=float)
    args = ap.parse_args(argv)

    proto_out = sys.stdout
    from vexsim.runner.protocol import JsonLineWriter

    writer = JsonLineWriter(proto_out)
    code = None
    if args.code_file:
        with open(args.code_file, encoding="utf-8") as f:
            code = f.read()
    worker = Worker(args.platform, args.scenario, code, args.speed, emit=writer.send,
                    interactive=True, mounted_tool=args.mounted_tool, marker_protrusion=args.marker)

    class _ConsoleStream:  # stray writes to stdout (e.g. from libraries) go to the console
        def write(self, s):
            worker._on_console(s)
            return len(s)

        def flush(self):
            pass

    sys.stdout = _ConsoleStream()

    def read_commands():
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                worker.commands.put(json.loads(line))
            except json.JSONDecodeError:
                continue
        worker.commands.put({"type": "quit"})

    threading.Thread(target=read_commands, daemon=True).start()
    worker.run()


if __name__ == "__main__":
    main()
