/** Display settings for the IQ2 3D views (simulator-only, saved per browser). */

export type Quality = "low" | "medium" | "high";
export type Lighting = "studio" | "classroom" | "night";

export interface DisplaySettings {
  quality: Quality;
  shadows: boolean;
  lighting: Lighting;
}

const KEY = "vexsim:iq2:display";
const DEFAULTS: DisplaySettings = { quality: "medium", shadows: true, lighting: "studio" };

/** Per-quality knobs used by the views and the procedural models. */
export const QUALITY = {
  low: { pixelRatio: 1, shadowMap: 1024, segments: 0.5, texture: 1, contactShadow: false },
  medium: { pixelRatio: 1.5, shadowMap: 2048, segments: 1, texture: 1, contactShadow: true },
  high: { pixelRatio: 2, shadowMap: 4096, segments: 1.6, texture: 2, contactShadow: true },
} as const;

export const LIGHTING: Record<Lighting, {
  top: string; bottom: string; hemiSky: number; hemiGround: number; hemi: number;
  key: number; keyColor: number; fill: number; rim: number; env: number; exposure: number; ground: number;
}> = {
  studio: { top: "#eef3f9", bottom: "#c4cfdb", hemiSky: 0xffffff, hemiGround: 0x8a7d70, hemi: 0.75, key: 2.6, keyColor: 0xfff4e6, fill: 0.55, rim: 0.9, env: 0.55, exposure: 1.0, ground: 0x9da7b1 },
  classroom: { top: "#f6efe2", bottom: "#cbbda6", hemiSky: 0xfff6e8, hemiGround: 0x7d6a55, hemi: 0.85, key: 2.2, keyColor: 0xffe9c9, fill: 0.7, rim: 0.6, env: 0.6, exposure: 1.05, ground: 0xa59886 },
  night: { top: "#273142", bottom: "#0d1117", hemiSky: 0x9fb4d8, hemiGround: 0x101418, hemi: 0.35, key: 2.4, keyColor: 0xd5e2ff, fill: 0.25, rim: 1.4, env: 0.3, exposure: 0.95, ground: 0x2a3038 },
};

type Listener = (s: DisplaySettings, rebuild: boolean) => void;

class DisplayStore {
  value: DisplaySettings;
  private listeners: Listener[] = [];

  constructor() {
    let saved: Partial<DisplaySettings> = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { /* private mode */ }
    this.value = { ...DEFAULTS, ...saved };
  }

  set(patch: Partial<DisplaySettings>): void {
    const rebuild = patch.quality !== undefined && patch.quality !== this.value.quality;
    this.value = { ...this.value, ...patch };
    try { localStorage.setItem(KEY, JSON.stringify(this.value)); } catch { /* ignore */ }
    for (const l of this.listeners) l(this.value, rebuild);
  }

  onChange(fn: Listener): void {
    this.listeners.push(fn);
  }
}

export const display = new DisplayStore();

/** The "Display" popover in the app bar. */
export function mountDisplayMenu(button: HTMLElement, panel: HTMLElement): void {
  const render = () => {
    const v = display.value;
    const opt = <T extends string>(name: string, value: T, label: string, cur: T) =>
      `<button class="seg ${cur === value ? "on" : ""}" data-${name}="${value}">${label}</button>`;
    panel.innerHTML = `
      <div class="dm-title">Display</div>
      <div class="dm-row"><span>Quality</span><div class="segs">${opt("quality", "low", "Low", v.quality)}${opt("quality", "medium", "Medium", v.quality)}${opt("quality", "high", "High", v.quality)}</div></div>
      <div class="dm-row"><span>Lighting</span><div class="segs">${opt("lighting", "studio", "Studio", v.lighting)}${opt("lighting", "classroom", "Classroom", v.lighting)}${opt("lighting", "night", "Night", v.lighting)}</div></div>
      <label class="dm-row"><span>Shadows</span><input type="checkbox" ${v.shadows ? "checked" : ""} data-shadows></label>
      <p class="dm-note">Lower quality if the 3D view feels slow.</p>`;
    panel.querySelectorAll<HTMLElement>("[data-quality]").forEach((b) => { b.onclick = () => { display.set({ quality: b.dataset.quality as Quality }); render(); }; });
    panel.querySelectorAll<HTMLElement>("[data-lighting]").forEach((b) => { b.onclick = () => { display.set({ lighting: b.dataset.lighting as Lighting }); render(); }; });
    panel.querySelector<HTMLInputElement>("[data-shadows]")!.onchange = (e) => display.set({ shadows: (e.target as HTMLInputElement).checked });
  };
  button.onclick = (e) => {
    e.stopPropagation();
    panel.hidden = !panel.hidden;
    if (!panel.hidden) render();
  };
  panel.onclick = (e) => e.stopPropagation();
  document.addEventListener("click", () => { panel.hidden = true; });
}
