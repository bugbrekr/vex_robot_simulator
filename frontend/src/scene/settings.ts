/** Simulator-only visual settings (not part of VEXcode). Persisted per browser. */
export interface SimSettings {
  environment: "studio" | "workshop" | "night";
  table: "wood" | "laminate" | "none";
  shadows: boolean;
  quality: "low" | "medium" | "high";
  armColor: string; // shell colour of the arm links
  cubeColor: string; // cube body; AprilTags are cube-colour + white
  tileNumbers: boolean;
  tileGrid: boolean;
  tileHoles: boolean;
  axes: boolean;
  tcpMarker: boolean;
  trail: boolean;
  cables: boolean;
}

export const DEFAULT_SETTINGS: SimSettings = {
  environment: "studio",
  table: "wood",
  shadows: true,
  quality: "medium",
  armColor: "#f2f3f4",
  cubeColor: "#1f5fd6",
  tileNumbers: true,
  tileGrid: true,
  tileHoles: true,
  axes: true,
  tcpMarker: true,
  trail: false,
  cables: true,
};

export const ARM_COLORS: Record<string, string> = {
  "VEX white": "#f2f3f4", "Graphite": "#7b8188", "Safety orange": "#f07a1f", "Industrial yellow": "#f2c230", "Signal blue": "#3a78d8",
};
export const CUBE_COLORS: Record<string, string> = {
  "Blue (kit)": "#1f5fd6", "Red": "#d33a2f", "Green": "#2f9e44", "Purple": "#7b4fd0", "Black": "#2b2f33",
};

const KEY = "vexsim:settings";

export class SettingsStore {
  value: SimSettings;
  private listeners: ((s: SimSettings, changed: (keyof SimSettings)[]) => void)[] = [];

  constructor() {
    let saved: Partial<SimSettings> = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { /* ignore */ }
    this.value = { ...DEFAULT_SETTINGS, ...saved };
  }

  set(patch: Partial<SimSettings>): void {
    const changed = (Object.keys(patch) as (keyof SimSettings)[]).filter((k) => this.value[k] !== patch[k]);
    if (!changed.length) return;
    this.value = { ...this.value, ...patch };
    try { localStorage.setItem(KEY, JSON.stringify(this.value)); } catch { /* ignore */ }
    for (const l of this.listeners) l(this.value, changed);
  }

  reset(): void {
    this.set({ ...DEFAULT_SETTINGS });
  }

  onChange(fn: (s: SimSettings, changed: (keyof SimSettings)[]) => void): void {
    this.listeners.push(fn);
  }
}
