import * as THREE from "three";
import { FrameInterpolator } from "../net/interp";
import type { FrameMsg, IQ2RobotSnapshot } from "../net/protocol";
import { ConsolePanel } from "../ui/console";
import type { App } from "./app";
import type { BrainButtonName } from "./brainOS";
import { buildField } from "./fieldView";
import { RobotModel } from "./robotModel";
import { DEVICES, DEVICE_SHORT } from "./store";
import { View3D } from "./view3d";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Simulator tab: field + robot 3D view, brain face, device monitor, print console. */
export class SimTab {
  readonly view = new View3D($("sim-view"), 1500);
  readonly console = new ConsolePanel($("sim-console"));
  private root = new THREE.Group();
  private robot: RobotModel | null = null;
  private interp = new FrameInterpolator();
  private follow = false;
  private drag: { dx: number; dy: number; yaw: number; last: number } | null = null;
  private pressing: "touch" | "bumper" | null = null;
  private latest: IQ2RobotSnapshot | null = null;

  constructor(private app: App) {
    this.view.scene.add(this.root);
    $("bf-screen").appendChild(app.os.display);
    app.screenListeners.push(() => this.robot?.screenChanged());

    app.on("hello", () => this.build());
    app.on("frame", (f) => this.onFrame(f));
    app.on("console", (t) => this.console.print(t));
    app.on("warning", (t) => this.console.warn(t));
    app.on("error", (e) => this.console.error(`${e.traceback ?? ""}${e.message}${e.line ? `  (line ${e.line})` : ""}`));
    app.on("status", (s) => {
      if (s === "running") this.console.info("[program started]");
      if (s === "finished") this.console.info("[program finished]");
      if (s === "stopped") this.console.info("[program stopped]");
    });
    app.on("config", (c) => this.robot?.setConfig(c));
    app.on("maps", (maps) => this.fillMaps(maps));
    app.on("map", (id) => { $<HTMLSelectElement>("map").value = id; });

    this.wireToolbar();
    this.wireBrainFace();
    this.wirePointer();
    this.view.onTick((dt) => this.tick(dt));
  }

  // ------------------------------------------------------------ scene
  private build(): void {
    const { field, robotDesc } = this.app;
    this.view.scene.remove(this.root);
    this.root = new THREE.Group();
    this.view.scene.add(this.root);
    this.interp.reset();
    if (field) this.root.add(buildField(field));
    if (robotDesc) {
      this.robot = new RobotModel(robotDesc.geometry, this.app.os.display);
      this.robot.setConfig(this.app.config);
      this.robot.setPose(...robotDesc.start);
      this.root.add(this.robot.root);
    }
    this.homeView();
    const sel = $<HTMLSelectElement>("map");
    if (this.app.scene) sel.value = this.app.scene.scenario.id;
  }

  /** 3D view of the map, looking over the robot's start from behind and to its left. */
  private homeView(): void {
    const [x, y, yaw] = this.app.robotDesc?.start ?? [0, 0, 90];
    const a = THREE.MathUtils.degToRad(yaw);
    const [w, h] = this.app.field?.floor.size ?? [2400, 2400];
    const d = Math.max(w, h) * 0.62;
    const back = a + Math.PI + 0.45;
    // stand behind the start, look across the map's centre
    this.view.look([x + Math.cos(back) * d * 0.7, y + Math.sin(back) * d * 0.7, d * 0.85], [x * 0.4, y * 0.4, 0]);
  }

  private onFrame(f: FrameMsg): void {
    this.interp.push(f);
    if (f.robot) {
      this.latest = f.robot;
      this.renderMonitor(f.robot);
    }
    $("sim-pause").classList.toggle("on", f.paused);
  }

  private tick(dt: number): void {
    this.interp.lagWall = this.drag ? 0.02 : 0.1;
    const f = this.interp.sample(dt);
    if (f?.robot && this.robot) {
      this.robot.update(f.robot);
      if (this.drag) this.robot.setPose(...this.dragPose());
    }
    if (this.follow && this.robot) {
      const r = this.robot.root;
      const yaw = r.rotation.z;
      const back = new THREE.Vector3(-Math.cos(yaw), -Math.sin(yaw), 0);
      const desired = r.position.clone().addScaledVector(back, 520).add(new THREE.Vector3(0, 0, 360));
      this.view.camera.position.lerp(desired, Math.min(1, dt * 4));
      this.view.controls.target.lerp(r.position.clone().add(new THREE.Vector3(Math.cos(yaw) * 120, Math.sin(yaw) * 120, 60)), Math.min(1, dt * 6));
    }
  }

  // ------------------------------------------------------------ toolbar
  private fillMaps(maps: { id: string; name: string; description: string }[]): void {
    const sel = $<HTMLSelectElement>("map");
    sel.innerHTML = maps.map((m) => `<option value="${m.id}" title="${m.description}">${m.name}</option>`).join("");
    sel.value = this.app.map;
  }

  private wireToolbar(): void {
    const sel = $<HTMLSelectElement>("map");
    sel.onchange = () => this.app.setMap(sel.value);
    const speed = $<HTMLSelectElement>("speed");
    speed.onchange = () => this.app.send({ type: "speed", value: Number(speed.value) });
    this.app.session.onOpen = ((prev) => () => { prev(); this.app.send({ type: "speed", value: Number(speed.value) }); })(this.app.session.onOpen);
    const real = $<HTMLInputElement>("realistic");
    real.checked = this.app.realistic;
    real.onchange = () => this.app.setRealistic(real.checked);
    $("robot-home").onclick = () => this.app.send({ type: "reset_robot" });
    $("sim-reset").onclick = () => this.app.setMap(this.app.map);
    let paused = false;
    $("sim-pause").onclick = () => { paused = !paused; this.app.send({ type: "pause", value: paused }); };
    $("sim-console-clear").onclick = () => this.console.clear();
    $("view-3d").onclick = () => { this.follow = false; this.homeView(); };
    $("view-top").onclick = () => {
      this.follow = false;
      const [w, h] = this.app.field?.floor.size ?? [2400, 2400];
      this.view.look([0, -1, Math.max(w, h) * 1.15], [0, 0, 0]);
    };
    $("view-follow").onclick = () => { this.follow = !this.follow; $("view-follow").classList.toggle("on", this.follow); };
  }

  // ------------------------------------------------------------ brain face
  private wireBrainFace(): void {
    const face = $("brain-face");
    face.querySelectorAll<HTMLButtonElement>("[data-btn]").forEach((b) => {
      const name = b.dataset.btn as BrainButtonName;
      b.onpointerdown = (e) => { e.preventDefault(); b.setPointerCapture(e.pointerId); this.app.os.press(name, true); };
      b.onpointerup = () => this.app.os.press(name, false);
      b.onpointercancel = () => this.app.os.press(name, false);
    });
    const keys: Record<string, BrainButtonName> = { ArrowLeft: "left", ArrowRight: "right", Enter: "check", Backspace: "x" };
    const held = new Set<string>();
    const active = () => $("tab-sim").classList.contains("active") && !(document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLSelectElement);
    window.addEventListener("keydown", (e) => {
      const b = keys[e.key];
      if (!b || !active() || held.has(e.key)) return;
      held.add(e.key);
      e.preventDefault();
      this.app.os.press(b, true);
    });
    window.addEventListener("keyup", (e) => {
      const b = keys[e.key];
      if (!b || !held.delete(e.key)) return;
      this.app.os.press(b, false);
    });
  }

  // ------------------------------------------------------------ pointer: press sensors, drag robot
  private hit(e: PointerEvent): "touch" | "bumper" | "chassis" | null {
    if (!this.robot) return null;
    const rc = this.view.raycaster(e);
    const hits = rc.intersectObjects([...this.robot.pick.touchled, ...this.robot.pick.bumper, ...this.robot.pick.chassis], false);
    if (!hits.length) return null;
    const o = hits[0].object;
    if (this.robot.pick.touchled.includes(o) && this.robot.devices.touchled.visible) return "touch";
    if (this.robot.pick.bumper.includes(o) && this.robot.devices.bumper.visible) return "bumper";
    return "chassis";
  }

  private dragPose(): [number, number, number] {
    const d = this.drag!;
    return [d.dx, d.dy, d.yaw];
  }

  private wirePointer(): void {
    const el = this.view.renderer.domElement;
    let grab: { ox: number; oy: number } | null = null;
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const what = this.hit(e);
      if (!what || !this.latest) return;
      e.stopImmediatePropagation();
      this.view.controls.enabled = false;
      el.setPointerCapture(e.pointerId);
      if (what === "touch" || what === "bumper") {
        this.pressing = what;
        this.app.send(what === "touch" ? { type: "touch", pressed: true } : { type: "bumper", pressed: true });
        return;
      }
      const p = this.view.floorPoint(e);
      if (!p) return;
      const [x, y, yaw] = this.latest.pose;
      grab = { ox: x - p.x, oy: y - p.y };
      this.drag = { dx: x, dy: y, yaw, last: 0 };
      el.style.cursor = "grabbing";
    }, { capture: true });
    el.addEventListener("pointermove", (e) => {
      if (!this.drag || !grab) {
        if (!this.pressing) el.style.cursor = this.hit(e) ? "pointer" : "";
        return;
      }
      const p = this.view.floorPoint(e);
      if (!p) return;
      this.drag.dx = p.x + grab.ox;
      this.drag.dy = p.y + grab.oy;
      this.sendPlace(false);
    });
    const end = () => {
      if (this.pressing) {
        this.app.send(this.pressing === "touch" ? { type: "touch", pressed: false } : { type: "bumper", pressed: false });
        this.pressing = null;
      }
      if (this.drag) { this.sendPlace(true); this.drag = null; grab = null; }
      this.view.controls.enabled = true;
      el.style.cursor = "";
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("wheel", (e) => {
      if (!this.drag) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      this.drag.yaw += e.deltaY > 0 ? -5 : 5;
      this.sendPlace(false);
    }, { capture: true, passive: false });
  }

  private sendPlace(force: boolean): void {
    const d = this.drag!;
    const now = performance.now();
    if (!force && now - d.last < 30) return;
    d.last = now;
    this.app.send({ type: "place_robot", x: d.dx, y: d.dy, yaw: d.yaw });
  }

  // ------------------------------------------------------------ monitor
  private renderMonitor(r: IQ2RobotSnapshot): void {
    const rows: string[] = [];
    const cfg = r.config;
    for (const d of DEVICES) {
      if (!cfg[d].enabled) continue;
      let v = "";
      if (d === "left_motor" || d === "right_motor") {
        const m = r.motors[d];
        v = `${m.pos.toFixed(0)}° · ${m.vel.toFixed(0)} rpm`;
      } else if (d === "distance") v = r.distance >= 9999 ? "no object" : `${r.distance.toFixed(0)} mm`;
      else if (d === "optical") v = `${r.optical.brightness.toFixed(0)}% · hue ${r.optical.hue.toFixed(0)}°${r.optical.led ? " · LED" : ""}`;
      else if (d === "bumper") v = r.bumper ? "<b>pressed</b>" : "released";
      else if (d === "touchled") {
        const c = r.touchled.color;
        v = `<span class="swatch" style="background:${c ?? "transparent"}"></span>${c ? c : "off"}${r.touchled.pressed ? " · <b>pressed</b>" : ""}`;
      }
      rows.push(`<tr><td class="port">${cfg[d].port}</td><td>${d === "left_motor" ? "Motor (L)" : d === "right_motor" ? "Motor (R)" : DEVICE_SHORT[d]}</td><td>${v}</td></tr>`);
    }
    rows.push(`<tr><td class="port">–</td><td>Inertial</td><td>heading ${r.heading.toFixed(1)}° · rot ${r.rotation.toFixed(1)}°</td></tr>`);
    if (r.contacts.length) rows.push(`<tr class="warn"><td></td><td colspan="2">Touching: ${r.contacts.join(", ")}</td></tr>`);
    $("monitor").innerHTML = rows.join("");
  }
}
