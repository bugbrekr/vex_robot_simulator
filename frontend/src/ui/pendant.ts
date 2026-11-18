import type { ArmSnapshot, ClientMsg, RunState, Vec3 } from "../net/protocol";

type Units = "mm" | "in";
const MM_PER_IN = 25.4;
const INCREMENTS: Record<Units, number[]> = { mm: [1, 5, 10, 25, 50], in: [0.1, 0.25, 0.5, 1, 2] };
const DEFAULT_INC: Record<Units, number> = { mm: 10, in: 0.5 };

/**
 * Teach Pendant, modelled on the VEXcode 6-Axis Arm Teach Pendant:
 * Move to Safe Position / Enable Manual Mode, Status, X/Y/Z dashboard, Arm Jogging,
 * Jogging Increment, Move To, Magnet, settings (Units, Speed, End Effector, Pen Offset).
 */
export class TeachPendant {
  private ready = false; // features unlock after "Move to Safe Position" (like the real pendant)
  private units: Units = "mm";
  private inc = 10;
  private arm: ArmSnapshot | null = null;
  private runState: RunState = "idle";
  private phase = "";
  private connected = false;
  private els: Record<string, HTMLElement> = {};
  onInsertMoveTo: (x: number, y: number, z: number) => void = () => {};
  onCopy: () => void = () => {};

  constructor(private root: HTMLElement, private send: (m: ClientMsg) => void) {
    root.innerHTML = `
      <div class="card">
        <div class="tp-top">
          <button class="btn-primary" data-el="safe">Move to Safe Position</button>
          <button class="btn-secondary" data-el="manual">Enable Manual Mode</button>
        </div>
        <div class="tp-status"><span class="tp-status-label">Status:</span><span class="tp-status-text" data-el="status"></span></div>
        <div class="tp-dash">
          <div class="tp-dash-h">X</div><div class="tp-dash-h">Y</div><div class="tp-dash-h">Z</div>
          <div class="tp-dash-v" data-el="x">–</div><div class="tp-dash-v" data-el="y">–</div><div class="tp-dash-v" data-el="z">–</div>
        </div>
        <div class="tp-dash tp-dash-small">
          <div class="tp-dash-h">Yaw</div><div class="tp-dash-h">Roll</div><div class="tp-dash-h">Pitch</div>
          <div class="tp-dash-v" data-el="yaw">–</div><div class="tp-dash-v" data-el="roll">–</div><div class="tp-dash-v" data-el="pitch">–</div>
        </div>
        <div class="tp-coords">
          <button class="btn-link tp-insert" data-el="insert" title="Insert arm.move_to(...) with the current position at the cursor (M)">Add 'move_to' to Code</button>
          <button class="btn-link" data-el="copy" title="Copy x, y, z to the clipboard (C)">Copy coordinates</button>
        </div>
      </div>

      <section class="card tp-section">
        <h4>Arm Jogging</h4>
        <div class="tp-grid3" data-el="jog">
          <button data-jog="0,1">+X</button><button data-jog="1,1">+Y</button><button data-jog="2,1">+Z</button>
          <button data-jog="0,-1">-X</button><button data-jog="1,-1">-Y</button><button data-jog="2,-1">-Z</button>
        </div>
        <h4>End Effector Jogging</h4>
        <div class="tp-grid3" data-el="jogr">
          <button data-jogr="0,1">+Yaw</button><button data-jogr="1,1">+Roll</button><button data-jogr="2,1">+Pitch</button>
          <button data-jogr="0,-1">-Yaw</button><button data-jogr="1,-1">-Roll</button><button data-jogr="2,-1">-Pitch</button>
        </div>
        <h4>Jogging Increment</h4>
        <div class="tp-seg" data-el="inc"></div>
      </section>

      <section class="card tp-section">
        <h4>Move To</h4>
        <div class="tp-moveto">
          <label>X<input type="number" data-el="mx" value="120"></label>
          <label>Y<input type="number" data-el="my" value="0"></label>
          <label>Z<input type="number" data-el="mz" value="100"></label>
          <button class="btn-primary" data-el="moveto">Move</button>
        </div>
      </section>

      <section class="card tp-section">
        <h4>Magnet</h4>
        <div class="tp-grid2">
          <button data-el="engage">Engage</button><button data-el="release">Release</button>
        </div>
      </section>

      <section class="card tp-section">
        <h4>Teach Pendant Settings</h4>
        <div class="tp-settings">
          <label>Units</label>
          <div class="tp-seg" data-el="units"><button data-u="mm">mm</button><button data-u="in">inches</button></div>
          <label>Speed</label>
          <div class="tp-speed"><input type="range" min="1" max="100" value="50" data-el="speed"><span data-el="speedv">50%</span></div>
          <label>End Effector</label>
          <select data-el="tool"><option value="magnet">Magnet</option><option value="pen">Pen</option></select>
          <label>Pen Offset</label>
          <div class="tp-offset"><input type="number" min="0" max="80" step="1" value="23" data-el="penoff"><span>mm</span></div>
        </div>
      </section>`;
    root.querySelectorAll<HTMLElement>("[data-el]").forEach((e) => (this.els[e.dataset.el!] = e));

    this.els.safe.onclick = () => { this.ready = true; this.send({ type: "safe" }); this.render(); };
    this.els.manual.onclick = () => {
      if (!this.arm) return;
      this.send({ type: "manual", enabled: !this.arm.manual });
    };
    root.querySelectorAll<HTMLButtonElement>("[data-jog]").forEach((b) => {
      b.onclick = () => {
        const [axis, sign] = b.dataset.jog!.split(",").map(Number);
        const d: Vec3 = [0, 0, 0];
        d[axis] = sign * this.toMm(this.inc);
        this.send({ type: "jog", mode: "xyz", delta: d });
      };
    });
    root.querySelectorAll<HTMLButtonElement>("[data-jogr]").forEach((b) => {
      b.onclick = () => {
        const [axis, sign] = b.dataset.jogr!.split(",").map(Number);
        const d: Vec3 = [0, 0, 0];
        d[axis] = sign * (this.units === "mm" ? Math.min(this.inc, 45) : 5);
        this.send({ type: "jog", mode: "rpy", delta: d });
      };
    });
    this.els.moveto.onclick = () => {
      const v = (k: string) => this.toMm(Number((this.els[k] as HTMLInputElement).value));
      this.send({ type: "jog", mode: "abs", pos: [v("mx"), v("my"), v("mz")] });
    };
    this.els.engage.onclick = () => this.send({ type: "tool", magnet: true });
    this.els.release.onclick = () => this.send({ type: "tool", magnet: false });
    this.els.insert.onclick = () => {
      if (this.arm) this.onInsertMoveTo(...(this.arm.tip.map((v) => Math.round(v)) as Vec3));
    };
    this.els.copy.onclick = () => this.onCopy();
    this.els.units.querySelectorAll<HTMLButtonElement>("button").forEach((b) => {
      b.onclick = () => this.setUnits(b.dataset.u as Units);
    });
    const speed = this.els.speed as HTMLInputElement;
    speed.oninput = () => (this.els.speedv.textContent = `${speed.value}%`);
    speed.onchange = () => this.send({ type: "tool", speed: Number(speed.value) });
    this.els.tool.onchange = () => {
      const tool = (this.els.tool as HTMLSelectElement).value as "magnet" | "pen";
      this.send({ type: "tool", tool, ...(tool === "pen" ? { pen_offset: Number((this.els.penoff as HTMLInputElement).value) } : {}) });
    };
    this.els.penoff.onchange = () => this.send({ type: "tool", pen_offset: Number((this.els.penoff as HTMLInputElement).value) });
    this.setUnits("mm");
  }

  private toMm(v: number): number { return this.units === "mm" ? v : v * MM_PER_IN; }
  private fromMm(v: number): number { return this.units === "mm" ? v : v / MM_PER_IN; }
  private fmt(vMm: number): string {
    return this.units === "mm" ? `${Math.round(vMm)} mm` : `${this.fromMm(vMm).toFixed(2)} in`;
  }

  private setUnits(u: Units): void {
    const old = this.units;
    this.units = u;
    this.inc = DEFAULT_INC[u];
    this.els.units.querySelectorAll<HTMLButtonElement>("button").forEach((b) => b.classList.toggle("on", b.dataset.u === u));
    this.els.inc.innerHTML = INCREMENTS[u].map((v) => `<button data-inc="${v}">${v}</button>`).join("") + `<span class="tp-unit">${u}</span>`;
    this.els.inc.querySelectorAll<HTMLButtonElement>("button").forEach((b) => {
      b.onclick = () => { this.inc = Number(b.dataset.inc); this.render(); };
    });
    for (const k of ["mx", "my", "mz"]) {
      const inp = this.els[k] as HTMLInputElement;
      const mm = old === "mm" ? Number(inp.value) : Number(inp.value) * MM_PER_IN;
      inp.value = u === "mm" ? String(Math.round(mm)) : (mm / MM_PER_IN).toFixed(2);
      inp.step = u === "mm" ? "1" : "0.1";
    }
    this.render();
  }

  setConnected(c: boolean): void { this.connected = c; this.render(); }
  setRunState(s: RunState): void { this.runState = s; this.render(); }
  setPhase(p: string): void { if (p !== this.phase) { this.phase = p; this.render(); } }
  update(a: ArmSnapshot): void { this.arm = a; this.render(); }

  /** Can the pendant move the arm right now? */
  get jogEnabled(): boolean {
    return this.connected && this.ready && this.runState !== "running" && !!this.arm && !this.arm.manual;
  }

  private status(): string {
    const a = this.arm;
    if (!this.connected || !a) return "Arm not connected";
    if (this.runState === "running") return this.phase === "homing" ? "Moving to safe position before the project starts…" : "Project running";
    if (a.control_stopped) return "Controlled stop enabled - restart the project";
    if (!this.ready) return "Click 'Move to Safe Position' to continue";
    if (a.manual) return a.sagging ? "Manual Mode Enabled - motors powered down" : "Manual Mode Enabled";
    if (a.crashed) return "Collision detected";
    if (a.moving) return "Moving…";
    return "Ready";
  }

  private render(): void {
    const a = this.arm;
    const idle = this.connected && this.runState !== "running" && !!a;
    (this.els.safe as HTMLButtonElement).disabled = !idle;
    const manualBtn = this.els.manual as HTMLButtonElement;
    const atSafe = !!a?.at_safe;
    manualBtn.disabled = !idle || !this.ready || (!a?.manual && !atSafe);
    manualBtn.title = a?.manual ? "Power the motors back on" : atSafe ? "Power down the motors and move the arm by hand" : "Move to Safe Position first";
    manualBtn.textContent = a?.manual ? "Disable Manual Mode" : "Enable Manual Mode";
    manualBtn.classList.toggle("active", !!a?.manual);
    this.els.status.textContent = this.status();
    if (a) {
      this.els.x.textContent = this.fmt(a.tcp[0]);
      this.els.y.textContent = this.fmt(a.tcp[1]);
      this.els.z.textContent = this.fmt(a.tcp[2]);
      this.els.yaw.textContent = `${Math.round(a.rpy[0])}°`;
      this.els.roll.textContent = `${Math.round(a.rpy[1])}°`;
      this.els.pitch.textContent = `${Math.round(a.rpy[2])}°`;
      const toolSel = this.els.tool as HTMLSelectElement;
      if (document.activeElement !== toolSel) toolSel.value = a.mounted_tool;
    }
    const jog = this.jogEnabled;
    this.root.querySelectorAll<HTMLButtonElement>(".tp-section button, .tp-section input, .tp-section select").forEach((b) => {
      b.disabled = !jog && !b.closest(".tp-settings");
    });
    this.root.querySelectorAll<HTMLButtonElement>(".tp-settings button, .tp-settings input, .tp-settings select").forEach((b) => {
      b.disabled = !idle;
    });
    // the end effector can only be changed at the safe position
    const toolSel = this.els.tool as HTMLSelectElement;
    toolSel.disabled = !idle || !atSafe;
    toolSel.title = atSafe ? "" : "Move to Safe Position to change the end effector";
    // magnet works whenever the pendant is active (also in Manual Mode) and the magnet is mounted
    const magOk = idle && this.ready && a?.mounted_tool === "magnet";
    (this.els.engage as HTMLButtonElement).disabled = !magOk;
    (this.els.release as HTMLButtonElement).disabled = !magOk;
    this.els.inc.querySelectorAll<HTMLButtonElement>("button").forEach((b) => b.classList.toggle("on", Number(b.dataset.inc) === this.inc));
    (this.els.engage as HTMLButtonElement).classList.toggle("on", !!a?.magnet);
    (this.els.insert as HTMLButtonElement).disabled = !a;
    (this.els.copy as HTMLButtonElement).disabled = !a;
  }
}
