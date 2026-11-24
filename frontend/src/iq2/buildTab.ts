import * as THREE from "three";
import type { IQ2Config, IQ2Device } from "../net/protocol";
import { toast } from "../ui/menus";
import type { App } from "./app";
import { makeCanvas } from "./brainScreen";
import { RobotModel } from "./robotModel";
import { DEVICES, DEVICE_LABEL, DEVICE_MOUNT, defaultConfig, portConflicts } from "./store";
import { View3D } from "./view3d";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Build tab: the fixed chassis in 3D, device on/off switches and Smart Port pickers. */
export class BuildTab {
  readonly view = new View3D($("build-view"), 500);
  private robot: RobotModel | null = null;
  private screen = makeCanvas();

  constructor(private app: App) {
    this.view.look([-430, -360, 330], [-40, 0, 50]);
    this.view.controls.autoRotate = false;
    const mat = new THREE.Mesh(new THREE.CylinderGeometry(420, 420, 8, 96), new THREE.MeshStandardMaterial({ color: 0xf2f3f1, roughness: 0.9 }));
    mat.rotation.x = Math.PI / 2;
    mat.position.z = -4;
    mat.receiveShadow = true;
    this.view.scene.add(mat);
    const g = this.screen.getContext("2d")!;
    g.fillStyle = "#adafad"; g.fillRect(0, 0, 160, 20);
    g.fillStyle = "#e6e6e6"; g.fillRect(0, 20, 160, 108);
    g.fillStyle = "#2b2b2b"; g.font = "700 15px Open Sans, sans-serif"; g.textAlign = "center";
    g.fillText(app.brainName, 80, 66);
    g.fillStyle = "#151515"; g.fillRect(0, 108, 160, 20);
    g.fillStyle = "#fff"; g.font = "700 11px Open Sans, sans-serif"; g.fillText("front ▲", 80, 122);

    app.on("hello", () => this.ensureRobot());
    this.view.onDisplay = (_s, rebuild) => {
      if (!rebuild || !this.robot) return;
      this.view.scene.remove(this.robot.root);
      this.robot = null;
      this.ensureRobot();
    };
    app.on("config", () => this.render());
    app.on("examples", () => this.fillPresets());
    $<HTMLButtonElement>("preset-default").onclick = () => this.app.setConfig(defaultConfig());
    document.querySelectorAll<HTMLButtonElement>("[data-drive]").forEach((b) => {
      b.onclick = () => {
        const drive = b.dataset.drive as "fwd" | "rwd";
        if ((this.app.config.drive ?? "fwd") === drive) return;
        this.app.setConfig({ ...this.app.config, drive }, true);
        toast(drive === "rwd" ? "Rear-wheel drive: motors on the rear axle" : "Front-wheel drive: motors on the front axle");
      };
    });
    $("copy-config").onclick = async () => {
      try { await navigator.clipboard.writeText($("config-code").textContent ?? ""); toast("Configuration code copied"); }
      catch { toast("Clipboard unavailable"); }
    };
    this.render();
  }

  private ensureRobot(): void {
    if (this.robot || !this.app.robotDesc) return;
    this.robot = new RobotModel(this.app.robotDesc.geometry, this.screen);
    this.robot.screenChanged();
    this.robot.setPose(60, 0, 0);
    this.robot.setConfig(this.app.config);
    this.view.scene.add(this.robot.root);
    this.render();
  }

  private fillPresets(): void {
    const sel = $<HTMLSelectElement>("preset");
    const labs = this.app.examples.filter((e) => e.group === "Lab Programs");
    sel.innerHTML = `<option value="">Choose…</option>` + labs.map((e) => `<option value="${e.id}">${e.title}</option>`).join("");
    sel.onchange = () => {
      const ex = labs.find((e) => e.id === sel.value);
      if (ex) { this.app.applyPreset(ex); toast(`Robot set up for ${ex.title}`); }
      sel.value = "";
    };
  }

  private render(): void {
    const cfg = this.app.config;
    document.querySelectorAll<HTMLElement>("[data-drive]").forEach((b) => b.classList.toggle("on", b.dataset.drive === (cfg.drive ?? "fwd")));
    const conflicts = portConflicts(cfg);
    const table = $("dev-table");
    table.innerHTML = `<tr><th></th><th>Device</th><th>Port</th></tr>` + DEVICES.map((d) => {
      const c = cfg[d];
      const opts = Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${c.port === i + 1 ? "selected" : ""}>${i + 1}</option>`).join("");
      const bad = c.enabled && conflicts.has(c.port);
      return `<tr data-dev="${d}" class="${c.enabled ? "" : "off"}">
        <td><label class="switch" title="${c.enabled ? "Plugged in" : "Unplugged / not mounted"}"><input type="checkbox" ${c.enabled ? "checked" : ""}><span></span></label></td>
        <td><div class="dev-name">${DEVICE_LABEL[d]}</div><div class="dev-mount">${d === "bumper"
          ? `<select class="mount-sel" ${c.enabled ? "" : "disabled"} title="Where the bumper is mounted">
              <option value="front" ${c.mount !== "rear" ? "selected" : ""}>front face</option>
              <option value="rear" ${c.mount === "rear" ? "selected" : ""}>back face</option></select>`
          : DEVICE_MOUNT[d]}</div></td>
        <td><select ${c.enabled ? "" : "disabled"} class="${bad ? "conflict" : ""}">${opts}</select>${bad ? '<div class="conflict-msg">port used twice</div>' : ""}</td>
      </tr>`;
    }).join("");
    table.querySelectorAll<HTMLTableRowElement>("tr[data-dev]").forEach((tr) => {
      const d = tr.dataset.dev as IQ2Device;
      const next = (): IQ2Config => JSON.parse(JSON.stringify(this.app.config));
      tr.querySelector<HTMLInputElement>("input")!.onchange = (e) => {
        const c = next();
        c[d].enabled = (e.target as HTMLInputElement).checked;
        this.app.setConfig(c, true);
      };
      tr.querySelector<HTMLSelectElement>(".mount-sel")?.addEventListener("change", (e) => {
        const c = next();
        c.bumper.mount = (e.target as HTMLSelectElement).value as "front" | "rear";
        this.app.setConfig(c, true);
      });
      tr.querySelector<HTMLSelectElement>("select:not(.mount-sel)")!.onchange = (e) => {
        const c = next();
        c[d].port = Number((e.target as HTMLSelectElement).value);
        this.app.setConfig(c, true);
      };
      tr.onpointerenter = () => this.robot?.highlight(d);
      tr.onpointerleave = () => this.robot?.highlight(null);
    });
    if (this.robot) {
      this.robot.setConfig(cfg);
      // keep the chassis centred on the turntable whichever axle is driven
      this.robot.setPose(60 - (cfg.drive === "rwd" ? this.robot.g.drive.wheel_base : 0), 0, 0);
      this.robot.showPortLabels(cfg);
    }
    $("config-code").textContent = configCode(cfg);
  }
}

export function configCode(cfg: IQ2Config): string {
  const L: string[] = ["from vex import *", "", "brain = Brain()", "brain_inertial = Inertial()"];
  const lm = cfg.left_motor, rm = cfg.right_motor;
  if (lm.enabled) L.push(`left_motor = Motor(Ports.PORT${lm.port}, False)`);
  if (rm.enabled) L.push(`right_motor = Motor(Ports.PORT${rm.port}, True)  # mounted mirrored`);
  if (lm.enabled && rm.enabled) L.push("drivetrain = SmartDrive(left_motor, right_motor, brain_inertial, 200, 173, 76, MM, 1)");
  if (cfg.distance.enabled) L.push(`distance = Distance(Ports.PORT${cfg.distance.port})`);
  if (cfg.optical.enabled) L.push(`optical = Optical(Ports.PORT${cfg.optical.port})`);
  if (cfg.bumper.enabled) L.push(`bumper = Bumper(Ports.PORT${cfg.bumper.port})`);
  if (cfg.touchled.enabled) L.push(`touch_led = Touchled(Ports.PORT${cfg.touchled.port})`);
  return L.join("\n");
}
