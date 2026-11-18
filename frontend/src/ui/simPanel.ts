import type { ArmSnapshot, ClientMsg, FrameMsg, RunState } from "../net/protocol";
import { ARM_COLORS, CUBE_COLORS, type SettingsStore, type SimSettings } from "../scene/settings";

/**
 * Simulation panel: simulator-only controls that are NOT part of the real VEXcode IDE
 * (objects, resets, physical hardware, appearance). Styled with an orange "SIM" accent.
 */
export class SimPanel {
  private els: Record<string, HTMLElement> = {};
  private arm: ArmSnapshot | null = null;
  private runState: RunState = "idle";
  onSpawnStart: (e: PointerEvent) => void = () => {};
  onResetSim: () => void = () => {};
  onClearTrail: () => void = () => {};

  constructor(root: HTMLElement, private send: (m: ClientMsg) => void, private settings: SettingsStore) {
    const sw = (name: string, map: Record<string, string>) =>
      Object.entries(map).map(([label, hex]) => `<button class="swatch" data-${name}="${hex}" title="${label}" style="--sw:${hex}"></button>`).join("");
    root.innerHTML = `
      <p class="sim-note">Simulator controls - not part of VEXcode.</p>
      <section class="card tp-section sim-sec"><h4>Objects</h4>
        <div class="tray">
          <div class="tray-item" data-el="tray-cube" title="Drag into the 3D view">
            <div class="tray-cube"><span></span></div><div><b>AprilTag cube</b><small>25 mm · ferromagnetic<br>drag onto the tile</small></div>
          </div>
        </div>
        <p class="hint">Drag cubes around the board at any time. Drag a cube off the tile to delete it. Cubes stick to the engaged Magnet Pickup Tool.</p>
        <div class="tp-grid2">
          <button data-el="clear-objects">Delete all objects</button>
          <span class="count" data-el="count">0 objects</span>
        </div>
      </section>

      <section class="card tp-section sim-sec"><h4>Simulation</h4>
        <div class="tp-grid2">
          <button data-el="pause">Pause</button>
          <button data-el="home" title="Teleport the arm to the safe position (no motion)">Snap arm to safe</button>
          <button data-el="erase">Erase whiteboard</button>
          <button data-el="clear-trail">Clear trail</button>
          <button class="danger" data-el="reset" title="Reload the map: arm, objects and drawings">Reset simulation</button>
        </div>
      </section>

      <section class="card tp-section sim-sec"><h4>Hardware</h4>
        <div class="tp-settings">
          <label>Mounted tool</label>
          <div class="tp-seg" data-el="mount"><button data-tool="magnet">Magnet</button><button data-tool="pen">Pen</button></div>
          <label>Marker tip</label>
          <div class="tp-speed"><input type="range" min="5" max="45" step="0.5" data-el="protrusion"><span data-el="protrusion-v"></span></div>
        </div>
        <p class="hint" data-el="hw-hint">Swap tools at the safe position. The marker tip is the real distance from the holder to the tip; projects must match it with <code>arm.set_pen_offset()</code>.</p>
      </section>

      <section class="card tp-section sim-sec"><h4>Appearance</h4>
        <div class="tp-settings">
          <label>Lighting</label>
          <select data-set="environment"><option value="studio">Studio</option><option value="workshop">Workshop</option><option value="night">Night</option></select>
          <label>Table</label>
          <select data-set="table"><option value="wood">Wood</option><option value="laminate">Laminate</option><option value="none">None</option></select>
          <label>Quality</label>
          <select data-set="quality"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select>
          <label>Arm colour</label><div class="swatches">${sw("arm", ARM_COLORS)}</div>
          <label>Cube colour</label><div class="swatches">${sw("cube", CUBE_COLORS)}</div>
        </div>
        <div class="checks">
          ${([
            ["shadows", "Shadows"], ["tileNumbers", "Location numbers"], ["tileGrid", "Dotted cell lines"], ["tileHoles", "Mounting holes"],
            ["axes", "XYZ axes"], ["tcpMarker", "TCP marker"], ["trail", "Tool-tip trail"], ["cables", "Cables"],
          ] as [keyof SimSettings, string][]).map(([k, l]) => `<label><input type="checkbox" data-check="${k}"> ${l}</label>`).join("")}
        </div>
        <button class="btn-link" data-el="defaults">Reset appearance to defaults</button>
      </section>`;
    root.querySelectorAll<HTMLElement>("[data-el]").forEach((e) => (this.els[e.dataset.el!] = e));

    this.els["tray-cube"].addEventListener("pointerdown", (e) => { e.preventDefault(); this.onSpawnStart(e); });
    this.els["clear-objects"].onclick = () => { if (confirm("Delete all objects from the scene?")) this.send({ type: "clear_objects" }); };
    this.els.pause.onclick = () => this.send({ type: "pause", value: this.els.pause.textContent === "Pause" });
    this.els.home.onclick = () => this.send({ type: "sim_home" });
    this.els.erase.onclick = () => this.send({ type: "erase" });
    this.els["clear-trail"].onclick = () => this.onClearTrail();
    this.els.reset.onclick = () => { if (confirm("Reset the simulation? The arm, objects and drawings go back to the map's start.")) this.onResetSim(); };
    this.els.mount.querySelectorAll<HTMLButtonElement>("button").forEach((b) => {
      b.onclick = () => this.send({ type: "tool", tool: b.dataset.tool as "magnet" | "pen", ...(b.dataset.tool === "pen" && this.arm ? { pen_offset: this.arm.marker_protrusion } : {}) });
    });
    const prot = this.els.protrusion as HTMLInputElement;
    prot.oninput = () => (this.els["protrusion-v"].textContent = `${prot.value} mm`);
    prot.onchange = () => this.send({ type: "marker", protrusion: Number(prot.value) });

    root.querySelectorAll<HTMLSelectElement>("[data-set]").forEach((sel) => {
      sel.onchange = () => this.settings.set({ [sel.dataset.set!]: sel.value } as Partial<SimSettings>);
    });
    root.querySelectorAll<HTMLInputElement>("[data-check]").forEach((cb) => {
      cb.onchange = () => this.settings.set({ [cb.dataset.check!]: cb.checked } as Partial<SimSettings>);
    });
    root.querySelectorAll<HTMLButtonElement>("[data-arm]").forEach((b) => (b.onclick = () => this.settings.set({ armColor: b.dataset.arm! })));
    root.querySelectorAll<HTMLButtonElement>("[data-cube]").forEach((b) => (b.onclick = () => this.settings.set({ cubeColor: b.dataset.cube! })));
    this.els.defaults.onclick = () => this.settings.reset();
    settings.onChange(() => this.syncSettings(root));
    this.syncSettings(root);
  }

  private syncSettings(root: HTMLElement): void {
    const s = this.settings.value;
    root.querySelectorAll<HTMLSelectElement>("[data-set]").forEach((sel) => (sel.value = String(s[sel.dataset.set as keyof SimSettings])));
    root.querySelectorAll<HTMLInputElement>("[data-check]").forEach((cb) => (cb.checked = !!s[cb.dataset.check as keyof SimSettings]));
    root.querySelectorAll<HTMLButtonElement>("[data-arm]").forEach((b) => b.classList.toggle("on", b.dataset.arm === s.armColor));
    root.querySelectorAll<HTMLButtonElement>("[data-cube]").forEach((b) => b.classList.toggle("on", b.dataset.cube === s.cubeColor));
    (this.els["tray-cube"].querySelector(".tray-cube") as HTMLElement).style.setProperty("--cube", s.cubeColor);
  }

  setRunState(s: RunState): void { this.runState = s; }

  update(f: FrameMsg): void {
    this.els.count.textContent = `${f.world?.objects.length ?? 0} object${f.world?.objects.length === 1 ? "" : "s"}`;
    this.els.pause.textContent = f.paused ? "Resume" : "Pause";
    const a = (this.arm = f.arm ?? null);
    if (!a) return;
    const canSwap = a.at_safe && this.runState !== "running";
    this.els.mount.querySelectorAll<HTMLButtonElement>("button").forEach((b) => {
      b.classList.toggle("on", b.dataset.tool === a.mounted_tool);
      b.disabled = !canSwap && b.dataset.tool !== a.mounted_tool;
    });
    (this.els.home as HTMLButtonElement).disabled = this.runState === "running";
    const prot = this.els.protrusion as HTMLInputElement;
    if (document.activeElement !== prot) {
      prot.value = String(a.marker_protrusion);
      this.els["protrusion-v"].textContent = `${a.marker_protrusion} mm`;
    }
    prot.disabled = a.mounted_tool !== "pen";
  }
}
