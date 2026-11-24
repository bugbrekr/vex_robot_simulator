import type { IQ2Config, IQ2RobotSnapshot, RunState, ScreenOp } from "../net/protocol";
import { H, Painter, ProgramScreen, W, makeCanvas } from "./brainScreen";
import { DEVICES, DEVICE_SHORT, SLOT_COUNT, type Slots } from "./store";

export type BrainButtonName = "x" | "check" | "left" | "right";

export interface OSHost {
  slots(): Slots;
  config(): IQ2Config;
  robot(): IQ2RobotSnapshot | null;
  brainName(): string;
  battery(): number;
  runSlot(n: number): void;
  stopProgram(): void;
  sendButton(name: "check" | "left" | "right", pressed: boolean): void;
  changed(): void;
}

type Mode = "home" | "programs" | "running" | "devices" | "device" | "settings";
const HOME = ["Programs", "Drive", "Devices", "Settings"] as const;
const ACCENT = "#3fa3ff";

/**
 * The brain's own user interface (home menu, program slots, devices, settings), plus the
 * program's screen while a project runs. Everything is drawn onto `display` (160x108).
 */
export class BrainOS {
  readonly display = makeCanvas();
  readonly program = new ProgramScreen();
  private p = new Painter(this.display.getContext("2d")!);
  private mode: Mode = "home";
  private sel = 0;
  private progSel = 0;
  private devSel = 0;
  private runState: RunState = "idle";
  runningSlot: number | null = null;
  private note: { text: string; until: number } | null = null;

  constructor(private host: OSHost) {
    this.render();
  }

  // ------------------------------------------------------------ events from the app
  applyOps(ops: ScreenOp[]): void {
    if (!ops.length) return;
    this.program.apply(ops);
    if (this.mode === "running") this.render();
  }

  /** A project started on the brain (from the brain menu or VS Code's Play button). */
  started(slot: number | null): void {
    this.runningSlot = slot;
    this.mode = "running";
    this.runState = "running";
    this.render();
  }

  setRunState(state: RunState): void {
    this.runState = state;
    if (state === "running" && this.mode !== "running") this.mode = "running";
    this.render();
  }

  tick(): void {
    if (this.mode === "device" || this.mode === "devices" || this.mode === "settings" || this.note) this.render();
  }

  // ------------------------------------------------------------ buttons
  press(btn: BrainButtonName, down: boolean): void {
    if (this.mode === "running") {
      if (btn === "x") {
        if (down) {
          if (this.runState === "running") this.host.stopProgram();
          this.mode = "programs";
          this.runState = "idle";
          this.render();
        }
        return;
      }
      if (this.runState === "running") this.host.sendButton(btn, down);
      return;
    }
    if (!down) return;
    switch (this.mode) {
      case "home":
        if (btn === "left") this.sel = (this.sel + HOME.length - 1) % HOME.length;
        if (btn === "right") this.sel = (this.sel + 1) % HOME.length;
        if (btn === "check") {
          const item = HOME[this.sel];
          if (item === "Programs") this.mode = "programs";
          else if (item === "Devices") { this.mode = "devices"; this.devSel = 0; }
          else if (item === "Settings") this.mode = "settings";
          else this.flash("No controller paired");
        }
        break;
      case "programs":
        if (btn === "left") this.progSel = (this.progSel + SLOT_COUNT - 1) % SLOT_COUNT;
        if (btn === "right") this.progSel = (this.progSel + 1) % SLOT_COUNT;
        if (btn === "x") this.mode = "home";
        if (btn === "check") {
          const n = this.progSel + 1;
          if (this.host.slots()[n]) this.host.runSlot(n);
          else this.flash(`Slot ${n} is empty`);
        }
        break;
      case "devices":
        if (btn === "left") this.devSel = (this.devSel + 11) % 12;
        if (btn === "right") this.devSel = (this.devSel + 1) % 12;
        if (btn === "x") this.mode = "home";
        if (btn === "check" && this.deviceOn(this.devSel + 1)) this.mode = "device";
        break;
      case "device":
        if (btn === "x" || btn === "check") this.mode = "devices";
        if (btn === "left") this.devSel = (this.devSel + 11) % 12;
        if (btn === "right") this.devSel = (this.devSel + 1) % 12;
        break;
      case "settings":
        if (btn === "x") this.mode = "home";
        break;
    }
    this.render();
  }

  private flash(text: string): void {
    this.note = { text, until: performance.now() + 1400 };
  }

  private deviceOn(port: number): string | null {
    const cfg = this.host.config();
    return DEVICES.find((d) => cfg[d].enabled && cfg[d].port === port) ?? null;
  }

  // ------------------------------------------------------------ drawing
  render(): void {
    const p = this.p;
    if (this.mode === "running") {
      p.image(this.program.canvas);
      if (this.runState !== "running") {
        p.rect(0, H - 11, W, 11, "rgba(0,0,0,0.65)");
        p.text(this.runState === "stopped" ? "Stopped - press X" : "Program done - press X", W / 2, H - 5.5, 7, "#ffd166", "center");
      }
      this.host.changed();
      return;
    }
    p.bg();
    this.statusBar();
    if (this.mode === "home") this.drawHome();
    else if (this.mode === "programs") this.drawPrograms();
    else if (this.mode === "devices") this.drawDevices();
    else if (this.mode === "device") this.drawDevice();
    else if (this.mode === "settings") this.drawSettings();
    if (this.note) {
      if (performance.now() > this.note.until) this.note = null;
      else {
        p.rect(14, 42, W - 28, 24, "#2b3036", 4);
        p.stroke(14, 42, W - 28, 24, ACCENT, 4);
        p.text(this.note.text, W / 2, 54, 8, "#fff", "center");
      }
    }
    this.host.changed();
  }

  private statusBar(): void {
    const p = this.p;
    p.rect(0, 0, W, 12, "#22272d");
    p.text(this.host.brainName(), 3, 6.5, 7, "#d6dde6");
    const b = this.host.battery();
    p.stroke(W - 21, 3, 15, 7, "#d6dde6", 1, 0.8);
    p.rect(W - 6, 5, 1.6, 3, "#d6dde6");
    p.rect(W - 20, 4, 13 * b / 100, 5, b > 25 ? "#53d769" : "#ff5f57", 0.5);
    p.text(`${b}%`, W - 24, 6.5, 6, "#d6dde6", "right");
  }

  private drawHome(): void {
    const p = this.p;
    HOME.forEach((name, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const x = 8 + col * 76, y = 17 + row * 45;
      const on = i === this.sel;
      const disabled = name === "Drive";
      p.rect(x, y, 68, 40, on ? "#24476f" : "#22272d", 5);
      if (on) p.stroke(x, y, 68, 40, ACCENT, 5, 1.6);
      const glyph = name === "Programs" ? "▶" : name === "Drive" ? "◎" : name === "Devices" ? "⌁" : "⚙";
      p.text(glyph, x + 34, y + 15, 14, disabled ? "#59616b" : "#ffffff", "center");
      p.text(name, x + 34, y + 31, 8, disabled ? "#59616b" : "#d6dde6", "center", on);
    });
  }

  private drawPrograms(): void {
    const p = this.p;
    const slots = this.host.slots();
    p.text("Programs", 4, 19, 8, ACCENT, "left", true);
    const first = Math.max(0, Math.min(this.progSel - 2, SLOT_COUNT - 5));
    for (let k = 0; k < 5; k++) {
      const i = first + k;
      const s = slots[i + 1];
      const y = 26 + k * 16;
      const on = i === this.progSel;
      p.rect(3, y, W - 6, 14, on ? "#24476f" : "#1c2025", 3);
      if (on) p.stroke(3, y, W - 6, 14, ACCENT, 3);
      p.text(String(i + 1), 9, y + 7.5, 8, "#9fb3c8", "center", true);
      p.text(s ? s.project.slice(0, 22) : "— empty —", 18, y + 7.5, 8, s ? "#ffffff" : "#59616b");
    }
    p.text("◀ ▶ select   ✓ run   X back", W / 2, H - 4, 6, "#8b96a3", "center");
  }

  private drawDevices(): void {
    const p = this.p;
    p.text("Devices", 4, 19, 8, ACCENT, "left", true);
    for (let i = 0; i < 12; i++) {
      const col = i % 4, row = Math.floor(i / 4);
      const x = 4 + col * 39, y = 26 + row * 24;
      const dev = this.deviceOn(i + 1);
      const on = i === this.devSel;
      p.rect(x, y, 36, 21, on ? "#24476f" : dev ? "#22323f" : "#1c2025", 3);
      if (on) p.stroke(x, y, 36, 21, ACCENT, 3);
      p.text(String(i + 1), x + 4, y + 6, 7, "#9fb3c8", "left", true);
      p.text(dev ? DEVICE_SHORT[dev as keyof typeof DEVICE_SHORT] : "—", x + 18, y + 14.5, 6.5, dev ? "#fff" : "#59616b", "center");
    }
  }

  private drawDevice(): void {
    const p = this.p;
    const port = this.devSel + 1;
    const dev = this.deviceOn(port) as keyof typeof DEVICE_SHORT | null;
    p.text(`Port ${port} · ${dev ? DEVICE_SHORT[dev] : "empty"}`, 4, 19, 8, ACCENT, "left", true);
    const r = this.host.robot();
    if (!dev || !r) { p.text("No device", W / 2, 60, 9, "#8b96a3", "center"); return; }
    const rows: [string, string][] = [];
    if (dev === "left_motor" || dev === "right_motor") {
      const m = r.motors[dev];
      rows.push(["Position", `${m.pos.toFixed(0)}°`], ["Velocity", `${m.vel.toFixed(0)} rpm`], ["Current", `${m.cur.toFixed(2)} A`]);
    } else if (dev === "distance") {
      rows.push(["Distance", r.distance >= 9999 ? "---" : `${r.distance.toFixed(0)} mm`], ["Object", r.distance_hit ? "yes" : "no"]);
    } else if (dev === "optical") {
      rows.push(["Brightness", `${r.optical.brightness.toFixed(0)}%`], ["Hue", `${r.optical.hue.toFixed(0)}°`], ["LED", `${r.optical.led.toFixed(0)}%`]);
    } else if (dev === "bumper") {
      rows.push(["Pressed", r.bumper ? "yes" : "no"]);
    } else if (dev === "touchled") {
      rows.push(["Pressed", r.touchled.pressed ? "yes" : "no"], ["Colour", r.touchled.color ?? "off"]);
    }
    rows.forEach(([k, v], i) => {
      p.text(k, 8, 36 + i * 16, 9, "#9fb3c8");
      p.text(v, W - 8, 36 + i * 16, 10, "#fff", "right", true);
    });
  }

  private drawSettings(): void {
    const p = this.p;
    const r = this.host.robot();
    p.text("Settings", 4, 19, 8, ACCENT, "left", true);
    const rows: [string, string][] = [
      ["Name", this.host.brainName()],
      ["Battery", `${this.host.battery()}%`],
      ["Heading", r ? `${r.heading.toFixed(1)}°` : "-"],
      ["VEXos", "sim 1.0"],
    ];
    rows.forEach(([k, v], i) => {
      p.text(k, 8, 33 + i * 16, 8.5, "#9fb3c8");
      p.text(v, W - 8, 33 + i * 16, 8.5, "#fff", "right");
    });
  }
}
