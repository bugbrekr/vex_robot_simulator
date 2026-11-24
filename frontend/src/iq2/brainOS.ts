import type { IQ2Config, IQ2Device, IQ2RobotSnapshot, RunState, ScreenOp } from "../net/protocol";
import * as I from "./brainIcons";
import { BAR, H, Painter, ProgramScreen, UI, W, makeCanvas } from "./brainScreen";
import { DEVICES, SLOT_COUNT, type Slots } from "./store";

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
  eraseAllSlots(): void;
  factoryReset(): void;
  changed(): void;
}

/** A tile in a menu carousel. */
interface Tile {
  name: string; // shown in the bottom bar when selected
  icon?: I.Icon;
  draw?: (p: Painter, x: number, y: number, w: number, h: number, on: boolean) => void;
  select?: () => void;
}

interface Menu { title: string; tiles: () => Tile[]; back?: () => void; sel: number; win: number }

type Page =
  | { kind: "menu"; menu: Menu }
  | { kind: "running" }
  | { kind: "dashboard"; port: number | "inertial"; metric: number }
  | { kind: "info" }
  | { kind: "log"; top: number }
  | { kind: "confirm"; text: string[]; proceed: () => void };

const TILE_Y = 44;
const TILE_H = 64;
const TILE_W = W / 3;
const SHORT: Record<IQ2Device, string> = {
  left_motor: "Motor", right_motor: "Motor", distance: "Distance", optical: "Optical", bumper: "Bumper", touchled: "TouchLED",
};

/**
 * The IQ (2nd gen) brain's own interface (Home, Programs, Devices, Settings) and, while a
 * project runs, its 160x108 output below the status bar. Modelled on the VEX KB screen captures:
 * a light theme, a grey status bar, a title band, a three-tile carousel where Left/Right move the
 * black highlight, and a black bottom bar naming the selection with scroll arrows.
 */
export class BrainOS {
  readonly display = makeCanvas();
  readonly program = new ProgramScreen();
  private p = new Painter(this.display.getContext("2d")!);
  private stack: Page[] = [];
  private runState: RunState = "idle";
  runningSlot: number | null = null;
  private note: { text: string; until: number } | null = null;
  private bootT = performance.now();
  private events: { t: number; text: string; kind: "power" | "program" }[] = [];

  constructor(private host: OSHost) {
    this.stack = [{ kind: "menu", menu: this.homeMenu() }];
    this.logEvent("power on", "power");
    this.render();
  }

  private get page(): Page {
    return this.stack[this.stack.length - 1];
  }

  private push(p: Page): void {
    this.stack.push(p);
  }

  private pop(): void {
    if (this.stack.length > 1) this.stack.pop();
  }

  private logEvent(text: string, kind: "power" | "program"): void {
    this.events.push({ t: performance.now() - this.bootT, text, kind });
    if (this.events.length > 99) this.events.shift();
  }

  // ------------------------------------------------------------ menus
  private menu(title: string, tiles: () => Tile[]): Menu {
    return { title, tiles, sel: 0, win: 0 };
  }

  private homeMenu(): Menu {
    return this.menu("Home", () => [
      { name: "Drive", icon: I.gamepad(UI.blue), select: () => this.push({ kind: "menu", menu: this.driveMenu() }) },
      { name: "Programs", icon: I.programs, select: () => this.push({ kind: "menu", menu: this.programsMenu() }) },
      { name: "Devices", icon: I.port, select: () => this.push({ kind: "menu", menu: this.devicesMenu() }) },
      { name: "Settings", icon: I.settings, select: () => this.push({ kind: "menu", menu: this.settingsMenu() }) },
    ]);
  }

  private driveMenu(): Menu {
    const na = () => this.flash("Needs an IQ Controller");
    return this.menu("Drive", () => [
      { name: "Run", icon: I.play, select: na },
      { name: "Controls", icon: I.people, select: na },
      { name: "Configure", icon: I.config, select: na },
    ]);
  }

  private programsMenu(): Menu {
    return this.menu("Programs", () => Array.from({ length: SLOT_COUNT }, (_, i) => {
      const n = i + 1;
      const s = this.host.slots()[n];
      return s
        ? { name: s.project, icon: I.project, select: () => this.push({ kind: "menu", menu: this.projectMenu(n) }) }
        : { name: `Slot ${n}`, icon: I.emptySlot(n), select: () => this.flash(`Slot ${n} is empty`) };
    }));
  }

  private projectMenu(n: number): Menu {
    const name = this.host.slots()[n]?.project ?? `Slot ${n}`;
    const na = () => this.flash("Not available in the simulator");
    return this.menu(name, () => [
      { name: "Run", icon: I.play, select: () => this.host.runSlot(n) },
      { name: "Controls", icon: I.people, select: na },
      { name: "Configure", icon: I.config, select: na },
    ]);
  }

  private devicesMenu(): Menu {
    return this.menu("Devices", () => {
      const cfg = this.host.config();
      const tiles: Tile[] = [{
        name: "Inertial",
        draw: (p, x, y, w, h, on) => this.deviceTile(p, x, y, w, h, on, "Heading", "inertial", "Degrees"),
        select: () => this.push({ kind: "dashboard", port: "inertial", metric: 0 }),
      }];
      const used = DEVICES.filter((d) => cfg[d].enabled).sort((a, b) => cfg[a].port - cfg[b].port);
      for (const d of used) {
        const port = cfg[d].port;
        const [label, unit] = d.endsWith("motor") ? ["Velocity", "RPM"] : d === "distance" ? ["Distance", "mm"]
          : d === "optical" ? ["Hue", "Degrees"] : d === "bumper" ? ["Bumper", ""] : ["Touch", ""];
        tiles.push({
          name: `${port}:${SHORT[d]}`,
          draw: (p, x, y, w, h, on) => this.deviceTile(p, x, y, w, h, on, label, d, unit),
          select: () => this.push({ kind: "dashboard", port, metric: 0 }),
        });
      }
      return tiles;
    });
  }

  private settingsMenu(): Menu {
    return this.menu("Settings", () => [
      { name: "English", icon: I.globe, select: () => this.flash("English") },
      { name: "Link", icon: I.link, select: () => this.flash("No controller to link") },
      { name: "Calibrate", icon: I.gamepad("#1e1e1e"), select: () => this.flash("Needs an IQ Controller") },
      { name: "System Info", icon: I.info, select: () => this.push({ kind: "info" }) },
      { name: "Log", icon: I.log, select: () => this.push({ kind: "log", top: 0 }) },
      { name: "Delete All", icon: I.trash, select: () => this.push({
        kind: "confirm", text: ["Delete all", "programs"],
        proceed: () => { this.host.eraseAllSlots(); this.flash("All programs deleted"); } }) },
      { name: "Factory Reset", icon: I.reset, select: () => this.push({
        kind: "confirm", text: ["Factory", "reset"],
        proceed: () => { this.host.factoryReset(); this.flash("Brain reset"); } }) },
    ]);
  }

  // ------------------------------------------------------------ events from the app
  applyOps(ops: ScreenOp[]): void {
    if (!ops.length) return;
    this.program.apply(ops);
    if (this.page.kind === "running") this.render();
  }

  /** A project started (from the brain menu or VS Code's Play button). */
  started(slot: number | null): void {
    this.runningSlot = slot;
    this.runState = "running";
    if (this.page.kind !== "running") this.push({ kind: "running" });
    this.logEvent(`program run slot ${slot ?? "-"}`, "program");
    this.render();
  }

  setRunState(state: RunState): void {
    if (this.runState === "running" && state !== "running") this.logEvent("program stop", "program");
    this.runState = state;
    if (state === "running" && this.page.kind !== "running") this.push({ kind: "running" });
    this.render();
  }

  tick(): void {
    const k = this.page.kind;
    if (k === "dashboard" || k === "info" || this.note || (k === "menu" && this.page.menu.title === "Devices")) this.render();
  }

  // ------------------------------------------------------------ buttons
  press(btn: BrainButtonName, down: boolean): void {
    const page = this.page;
    if (page.kind === "running") {
      if (btn === "x") {
        if (!down) return;
        if (this.runState === "running") this.host.stopProgram();
        this.runState = "idle";
        this.pop();
        this.render();
        return;
      }
      if (this.runState === "running") this.host.sendButton(btn, down);
      return;
    }
    if (!down) return;
    if (page.kind === "menu") {
      const m = page.menu;
      const n = m.tiles().length;
      if (btn === "left" && m.sel > 0) m.sel--;
      if (btn === "right" && m.sel < n - 1) m.sel++;
      if (m.sel < m.win) m.win = m.sel;
      if (m.sel > m.win + 2) m.win = m.sel - 2;
      if (btn === "check") m.tiles()[m.sel]?.select?.();
      if (btn === "x") this.pop();
    } else if (page.kind === "dashboard") {
      if (btn === "check") page.metric++;
      if (btn === "x") this.pop();
    } else if (page.kind === "log") {
      if (btn === "left") page.top = Math.min(Math.max(0, this.events.length - 7), page.top + 1);
      if (btn === "right") page.top = Math.max(0, page.top - 1);
      if (btn === "x") this.pop();
    } else if (page.kind === "confirm") {
      if (btn === "check") { this.pop(); page.proceed(); }
      if (btn === "x") this.pop();
    } else if (btn === "x" || btn === "check") {
      this.pop();
    }
    this.render();
  }

  private flash(text: string): void {
    this.note = { text, until: performance.now() + 1400 };
  }

  // ------------------------------------------------------------ drawing
  render(): void {
    const p = this.p;
    const page = this.page;
    p.fill(UI.title);
    if (page.kind === "confirm") this.drawConfirm(page.text);
    else {
      this.statusBar();
      if (page.kind === "menu") this.drawMenu(page.menu);
      else if (page.kind === "running") p.image(this.program.canvas, 0, BAR, W, H - BAR);
      else if (page.kind === "dashboard") this.drawDashboard(page.port, page.metric);
      else if (page.kind === "info") this.drawInfo();
      else if (page.kind === "log") this.drawLog(page.top);
    }
    if (this.note) {
      if (performance.now() > this.note.until) this.note = null;
      else {
        p.rect(12, 52, W - 24, 26, "#ffffff", 3);
        p.stroke(12, 52, W - 24, 26, UI.sel, 3, 1.4);
        p.text(this.note.text, W / 2, 65.5, 9, UI.text, "center", true);
      }
    }
    this.host.changed();
  }

  private statusBar(): void {
    const p = this.p;
    p.fill(UI.status, 0, 0, W, BAR);
    if (this.page.kind === "running" && this.runningSlot) {
      const done = this.runState !== "running";
      p.text(done ? `${this.runState === "stopped" ? "Stopped" : "Done"} · X` : `▶ Slot ${this.runningSlot}`, 4, 10.5, 8.5, done ? "#7a3d00" : UI.text, "left", true);
    }
    I.statusIcons(p.g, this.host.battery(), false);
  }

  private bottomBar(name: string, left: boolean, right: boolean): void {
    const p = this.p;
    p.fill(UI.bar, 0, 108, W, 20);
    p.text(name.length > 15 ? name.slice(0, 14) + "…" : name, W / 2, 118.5, 13, "#ffffff", "center", true);
    if (left) p.tri(8, 118, 9, -1, "#ffffff");
    if (right) p.tri(152, 118, 9, 1, "#ffffff");
  }

  private drawMenu(m: Menu): void {
    const p = this.p;
    const tiles = m.tiles();
    m.sel = Math.min(m.sel, tiles.length - 1);
    p.fill(UI.title, 0, BAR, W, 24);
    p.text(m.title.length > 16 ? m.title.slice(0, 15) + "…" : m.title, 4, 32.5, 15, UI.text, "left", true);
    for (let k = 0; k < 3; k++) {
      const i = m.win + k;
      const x = k * TILE_W;
      const t = tiles[i];
      const on = i === m.sel;
      this.tileFrame(x, on, !!t);
      if (!t) continue;
      if (t.draw) t.draw(p, x, TILE_Y, TILE_W, TILE_H, on);
      else if (t.icon) t.icon(p.g, x + TILE_W / 2, TILE_Y + TILE_H / 2 + 1, on);
    }
    const cur = tiles[m.sel];
    this.bottomBar(cur?.name ?? "", m.sel > 0, m.sel < tiles.length - 1);
  }

  /** Tab-shaped tile: notched top corners, black when selected. */
  private tileFrame(x: number, on: boolean, filled: boolean): void {
    const g = this.p.g;
    const w = TILE_W, y = TILE_Y, h = TILE_H;
    g.fillStyle = on ? UI.sel : filled ? UI.tile : UI.title;
    g.beginPath();
    g.moveTo(x + 0.5, y + 4); g.lineTo(x + 4, y + 0.5); g.lineTo(x + w - 4, y + 0.5); g.lineTo(x + w - 0.5, y + 4);
    g.lineTo(x + w - 0.5, y + h); g.lineTo(x + 0.5, y + h); g.closePath();
    g.fill();
    if (!on) { g.strokeStyle = UI.tileEdge; g.lineWidth = 1; g.stroke(); }
  }

  // ------------------------------------------------------------ devices
  private reading(dev: IQ2Device | "inertial", metric = 0): { label: string; value: string; unit: string; ring?: string; fill?: string } {
    const r = this.host.robot();
    if (!r) return { label: "", value: "-", unit: "" };
    if (dev === "inertial") {
      const opts = [{ label: "Heading", value: r.heading.toFixed(0), unit: "Degrees" }, { label: "Rotation", value: r.rotation.toFixed(0), unit: "Degrees" }];
      return opts[metric % opts.length];
    }
    if (dev === "left_motor" || dev === "right_motor") {
      const m = r.motors[dev];
      const opts = [{ label: "Velocity", value: m.vel.toFixed(0), unit: "RPM" }, { label: "Position", value: m.pos.toFixed(0), unit: "Degrees" },
        { label: "Current", value: m.cur.toFixed(2), unit: "Amps" }];
      return opts[metric % opts.length];
    }
    if (dev === "distance") return { label: "Distance", value: r.distance >= 9999 ? "---" : r.distance.toFixed(0), unit: "mm" };
    if (dev === "optical") {
      const o = r.optical;
      const opts = [{ label: "Hue", value: o.hue.toFixed(0), unit: "Degrees", ring: `hsl(${o.hue}, 85%, 45%)` },
        { label: "Brightness", value: o.brightness.toFixed(0), unit: "%" }, { label: "Proximity", value: o.near ? "Near" : "Far", unit: "" }];
      return opts[metric % opts.length];
    }
    if (dev === "bumper") return { label: "Bumper", value: r.bumper ? "Pressed" : "Released", unit: "" };
    return { label: "Touch", value: r.touchled.pressed ? "Pressed" : "Released", unit: "", fill: r.touchled.color ?? undefined };
  }

  private devAt(port: number): IQ2Device | null {
    const cfg = this.host.config();
    return DEVICES.find((d) => cfg[d].enabled && cfg[d].port === port) ?? null;
  }

  private deviceTile(p: Painter, x: number, y: number, w: number, _h: number, on: boolean, label: string, dev: IQ2Device | "inertial", unit: string): void {
    const rd = this.reading(dev);
    const fg = on ? "#ffffff" : UI.text;
    p.text(label, x + w / 2, y + 8, 8.5, fg, "center", true);
    p.text(unit, x + w / 2, y + 56, 8.5, fg, "center", true);
    const cx = x + w / 2, cy = y + 32;
    if (dev === "inertial") { // dotted compass ring
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
        p.g.fillStyle = i === 0 ? UI.blue : on ? "#777" : "#9a9a9a";
        p.g.fillRect(cx + Math.cos(a) * 15 - 1, cy + Math.sin(a) * 15 - 1, 2, 2);
      }
    } else if (rd.ring) {
      p.g.strokeStyle = "#c40000"; p.g.lineWidth = 3.2;
      p.g.beginPath(); p.g.arc(cx, cy, 14, 0, Math.PI * 2); p.g.stroke();
    } else if (rd.fill) {
      p.g.fillStyle = rd.fill; p.g.beginPath(); p.g.arc(cx, cy, 11, 0, Math.PI * 2); p.g.fill();
    }
    p.text(rd.value, cx, cy + 0.5, rd.value.length > 6 ? 7 : rd.value.length > 4 ? 9 : 12, UI.blue, "center", true);
  }

  private drawDashboard(port: number | "inertial", metric: number): void {
    const p = this.p;
    const dev = port === "inertial" ? "inertial" : this.devAt(port);
    p.fill(UI.title, 0, BAR, W, 88);
    p.stroke(0.5, BAR + 2.5, W - 1, 84, UI.tileEdge, 3, 1);
    if (!dev) { p.text("Unplugged", W / 2, 64, 10, UI.grey, "center", true); this.bottomBar(`${port}`, false, false); return; }
    const r = this.host.robot();
    const rows: [string, string][] = [];
    if (r) {
      if (dev === "inertial") rows.push(["ROT", r.rotation.toFixed(1)], ["HDG", r.heading.toFixed(1)]);
      else if (dev === "optical") rows.push(["LED", r.optical.led.toFixed(0)], ["BRT", r.optical.brightness.toFixed(0)], ["PROX", r.optical.near ? "Near" : "Far"]);
      else if (dev === "distance") rows.push(["DIST", r.distance >= 9999 ? "---" : `${r.distance.toFixed(0)}`], ["OBJ", r.distance_hit ? "Yes" : "No"]);
      else if (dev === "bumper") rows.push(["PRESS", r.bumper ? "1" : "0"]);
      else if (dev === "touchled") rows.push(["PRESS", r.touchled.pressed ? "1" : "0"], ["BRT", `${r.touchled.brightness}`]);
      else { const m = r.motors[dev]; rows.push(["POS", m.pos.toFixed(0)], ["VEL", m.vel.toFixed(0)], ["CUR", m.cur.toFixed(2)]); }
    }
    rows.forEach(([k, v], i) => {
      p.text(k, 6, 36 + i * 15, 10, UI.text, "left", true);
      p.text(`: ${v}`, 38, 36 + i * 15, 10, UI.text, "left", true);
    });
    const rd = this.reading(dev, metric);
    const cx = 122, cy = 66;
    p.text(rd.label, cx, 32, 10, UI.text, "center", true);
    p.g.fillStyle = "#2a2a2a"; p.g.beginPath(); p.g.arc(cx, cy, 19, 0, Math.PI * 2); p.g.fill();
    p.g.strokeStyle = rd.ring ? "#c40000" : rd.fill ?? UI.blue; p.g.lineWidth = 4;
    p.g.beginPath(); p.g.arc(cx, cy, 19, 0, Math.PI * 2); p.g.stroke();
    p.text(rd.value, cx, cy + 0.5, rd.value.length > 6 ? 6.5 : rd.value.length > 4 ? 8.5 : 13, UI.blue, "center", true);
    if (rd.unit) p.text(rd.unit, cx, 97, 8, UI.text, "center", true);
    this.bottomBar(port === "inertial" ? "Inertial" : `${port}:${SHORT[dev as IQ2Device]}`, false, false);
  }

  private drawInfo(): void {
    const p = this.p;
    p.fill(UI.title, 0, BAR, W, 88);
    p.stroke(0.5, BAR + 2.5, W - 1, 84, UI.tileEdge, 3, 1);
    const rows: [string, string][] = [
      ["Version", "sim 1.0"], ["Name", this.host.brainName().slice(0, 12)], ["Team", "000000"],
      ["Battery", `${(7.0 + 0.9 * this.host.battery() / 100).toFixed(2)}V`], ["Brain ID", "51A1B0E2"],
    ];
    rows.forEach(([k, v], i) => {
      p.text(k, 8, 34 + i * 15, 10, UI.text, "left", true);
      p.text(`: ${v}`, 80, 34 + i * 15, 10, UI.text, "left", true);
    });
    this.bottomBar("System Info", false, false);
  }

  private drawLog(top: number): void {
    const p = this.p;
    p.fill(UI.title, 0, BAR, W, 88);
    p.stroke(0.5, BAR + 2.5, W - 1, 84, UI.tileEdge, 3, 1);
    const ev = this.events.map((e, i) => ({ ...e, n: i + 1 })).reverse().slice(top, top + 7);
    const fmt = (ms: number) => {
      const s = Math.floor(ms / 1000);
      return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((v) => String(v).padStart(2, "0")).join(":");
    };
    ev.forEach((e, i) => {
      const c = e.kind === "power" ? "#1f9a3a" : "#1b39d8";
      p.text(String(e.n), 6, 30 + i * 11, 8.5, c, "left", true);
      p.text(`${fmt(e.t)} ${e.text}`, 18, 30 + i * 11, 8.5, c, "left", true);
    });
    this.bottomBar("Log", top + 7 < this.events.length, top > 0);
  }

  private drawConfirm(text: string[]): void {
    const p = this.p;
    p.fill(UI.status, 0, 0, W, BAR);
    I.statusIcons(p.g, this.host.battery(), false);
    p.fill(UI.orange, 0, BAR, W, H - BAR);
    text.forEach((t, i) => p.text(t, W / 2, 52 + i * 20, 15, UI.text, "center", true));
    p.fill(UI.text, 0, 106, W, 1);
    const box = (x: number, mark: "x" | "v") => {
      p.stroke(x, 111, 12, 12, UI.text, 0, 1.2);
      const g = p.g; g.strokeStyle = UI.text; g.lineWidth = 1.3; g.beginPath();
      if (mark === "x") { g.moveTo(x + 2, 113); g.lineTo(x + 10, 121); g.moveTo(x + 10, 113); g.lineTo(x + 2, 121); }
      else { g.moveTo(x + 2, 117); g.lineTo(x + 5, 121); g.lineTo(x + 10, 112); }
      g.stroke();
    };
    box(3, "x");
    p.text("Cancel", 19, 117.5, 10, UI.text, "left", true);
    box(96, "v");
    p.text("Proceed", 112, 117.5, 10, UI.text, "left", true);
  }
}
