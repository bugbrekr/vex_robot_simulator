import type { ClientMsg, FrameMsg } from "../net/protocol";
import { TowerPanel } from "./towerPanel";

const f1 = (v: number) => v.toFixed(1);

/** Monitor panel: live device values (like VEXcode's Monitor) + Signal Tower with bumper. */
export class MonitorPanel {
  private values: HTMLElement;
  private towerHost: HTMLElement;
  private tower: TowerPanel | null = null;

  constructor(root: HTMLElement, private send: (m: ClientMsg) => void) {
    root.innerHTML = `
      <section class="card tp-section"><h4>6-Axis Arm</h4><div class="mon-values" data-el="values"></div></section>
      <section class="card tp-section"><h4>Signal Tower</h4><div class="mon-tower" data-el="tower"></div>
        <p class="hint">Press and hold the bumper to trigger <code>pressed</code> / <code>released</code> callbacks.</p></section>`;
    this.values = root.querySelector("[data-el=values]")!;
    this.towerHost = root.querySelector("[data-el=tower]")!;
  }

  setTower(colors: string[] | null): void {
    if (!colors) {
      this.towerHost.innerHTML = '<span class="hint">No Signal Tower in this map.</span>';
      this.tower = null;
      return;
    }
    this.tower = new TowerPanel(this.towerHost, colors, this.send);
  }

  update(f: FrameMsg): void {
    if (f.signal_tower) this.tower?.update(f.signal_tower);
    const a = f.arm;
    if (!a) return;
    const rows: [string, string][] = [
      ["timer", `${f.t.toFixed(2)} s`],
      ["get_x / get_y / get_z", a.tcp.map(f1).join(", ")],
      ["get_yaw / roll / pitch", a.rpy.map(f1).join(", ")],
      ["is_done", String(!a.moving)],
      ["end effector (code)", a.tool + (a.tool === "pen" ? ` · offset ${a.pen_offset} mm` : "")],
      ["mounted tool", a.mounted_tool + (a.mounted_tool === "pen" ? ` · tip ${a.marker_protrusion} mm` : "") + (a.mounted_tool !== a.tool ? " ⚠" : "")],
      ["tool tip x / y / z", a.tip.map(f1).join(", ")],
      ["magnet", a.magnet ? (a.holding ? `on · holding ${a.holding}` : "on") : "off"],
      ["speed", `${a.speed}%`],
      ["control stop", String(a.control_stopped)],
      ["is_crashed", String(a.crashed)],
      ["joints J1–J6", a.joints.map((v) => Math.round(v)).join(", ") + "°"],
    ];
    this.values.innerHTML = rows.map(([k, v]) => `<div class="mon-row"><span>${k}</span><b>${v}</b></div>`).join("");
  }
}
