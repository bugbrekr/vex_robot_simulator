import type { IQ2Config, IQ2Device } from "../net/protocol";

/** Per-browser persistence (projects, brain slots, robot setup). Never throws. */
export const store = {
  get<T>(k: string, fallback: T): T {
    try {
      const v = localStorage.getItem(k);
      return v == null ? fallback : (JSON.parse(v) as T);
    } catch { return fallback; }
  },
  set(k: string, v: unknown): void {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode / quota */ }
  },
};

export const KEYS = {
  config: "vexsim:iq2:config",
  projects: "vexsim:iq2:projects",
  openProject: "vexsim:iq2:open",
  openFile: "vexsim:iq2:openfile",
  slots: "vexsim:iq2:slots",
  slot: "vexsim:iq2:slot",
  map: "vexsim:iq2:map",
  tab: "vexsim:iq2:tab",
  realistic: "vexsim:iq2:realistic",
  brainName: "vexsim:iq2:brainname",
};

export const DEVICES: IQ2Device[] = ["left_motor", "right_motor", "distance", "optical", "bumper", "touchled"];
export const DEVICE_LABEL: Record<IQ2Device, string> = {
  left_motor: "Left drive motor",
  right_motor: "Right drive motor",
  distance: "Distance Sensor (2nd gen)",
  optical: "Optical Sensor",
  bumper: "Bumper Switch (2nd gen)",
  touchled: "Touch LED",
};
export const DEVICE_SHORT: Record<IQ2Device, string> = {
  left_motor: "Motor", right_motor: "Motor", distance: "Distance", optical: "Optical",
  bumper: "Bumper", touchled: "TouchLED",
};
/** Fixed mounting spot (the chassis can't change). */
export const DEVICE_MOUNT: Record<IQ2Device, string> = {
  left_motor: "front left, drives the left tyre wheel",
  right_motor: "front right, drives the right tyre wheel (mounted mirrored: reverse it in code)",
  distance: "front, facing forward",
  optical: "front underside, facing the floor",
  bumper: "front face",
  touchled: "top rear, behind the brain",
};

/** Lab-manual ports (matches backend geometry.yaml default_ports). */
export function defaultConfig(): IQ2Config {
  return {
    left_motor: { port: 6, enabled: true },
    right_motor: { port: 1, enabled: true },
    distance: { port: 5, enabled: true },
    optical: { port: 3, enabled: true },
    bumper: { port: 11, enabled: true },
    touchled: { port: 4, enabled: true },
  };
}

/** An example's robot preset: listed devices are plugged in, the others are switched OFF. */
export function presetConfig(preset: Partial<Record<IQ2Device, { port?: number }>>): IQ2Config {
  const cfg = defaultConfig();
  for (const d of DEVICES) {
    cfg[d].enabled = d in preset;
    const p = preset[d]?.port;
    if (p) cfg[d].port = p;
  }
  return cfg;
}

export function loadConfig(): IQ2Config {
  const saved = store.get<Partial<IQ2Config>>(KEYS.config, {});
  const cfg = defaultConfig();
  for (const d of DEVICES) if (saved[d]) cfg[d] = { ...cfg[d], ...saved[d] };
  return cfg;
}

/** Ports used by more than one enabled device. */
export function portConflicts(cfg: IQ2Config): Set<number> {
  const seen = new Map<number, number>();
  for (const d of DEVICES) if (cfg[d].enabled) seen.set(cfg[d].port, (seen.get(cfg[d].port) ?? 0) + 1);
  return new Set([...seen].filter(([, n]) => n > 1).map(([p]) => p));
}

// ---------------------------------------------------------------- projects & slots
export interface Project {
  name: string;
  description: string;
  created: string;
  files: Record<string, string>; // path -> content
  main: string; // python file to download
}

export interface Slot { project: string; file: string; code: string; downloaded: string; description: string }
export type Slots = Record<number, Slot>;
export const SLOT_COUNT = 8;

export function loadProjects(): Record<string, Project> {
  return store.get<Record<string, Project>>(KEYS.projects, {});
}
export function saveProjects(p: Record<string, Project>): void {
  store.set(KEYS.projects, p);
}
export function loadSlots(): Slots {
  return store.get<Slots>(KEYS.slots, {});
}
export function saveSlots(s: Slots): void {
  store.set(KEYS.slots, s);
}

export interface ExampleInfo {
  id: string; title: string; file: string; map: string; group: string; exam?: boolean;
  robot: Partial<Record<IQ2Device, { port?: number }>>;
}

const pad = (n: number) => String(n).padStart(2, "0");
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function mainTemplate(name: string, description: string, body: string): string {
  const line = (label: string, v: string) => `# \t${(label + ":").padEnd(14)}${v}`.padEnd(79) + "#";
  return [
    "# ---------------------------------------------------------------------------- #",
    "#                                                                              #",
    line("Module", "main.py"),
    line("Author", "student"),
    line("Created", today()),
    line("Description", (description || name).slice(0, 50)),
    "#                                                                              #",
    "# ---------------------------------------------------------------------------- #",
    "",
    body.trimEnd(),
    "",
  ].join("\n");
}

export const TEMPLATES: { id: string; title: string; tags: string; description: string; body: string }[] = [
  {
    id: "empty",
    title: "Empty Project",
    tags: "empty blank python",
    description: "A project with only the brain configured.",
    body: `# Library imports
from vex import *

# Brain should be defined by default
brain = Brain()

brain.screen.print("Hello IQ")
`,
  },
  {
    id: "drivetrain",
    title: "Drivetrain 2-motor",
    tags: "drivetrain smartdrive basebot motor inertial",
    description: "Two drive motors (left PORT6, right PORT1) and the brain's Inertial sensor as a SmartDrive.",
    body: `# Library imports
from vex import *

# Brain should be defined by default
brain = Brain()

# Robot configuration code
brain_inertial = Inertial()
left_drive_smart = Motor(Ports.PORT6, 1.0, False)
right_drive_smart = Motor(Ports.PORT1, 1.0, True)
drivetrain = SmartDrive(left_drive_smart, right_drive_smart, brain_inertial, 200, 173, 76, MM, 1)


def main():
    drivetrain.drive_for(FORWARD, 300, MM)
    drivetrain.turn_for(RIGHT, 90, DEGREES)


main()
`,
  },
  {
    id: "sensors",
    title: "All sensors",
    tags: "sensors distance optical bumper touchled",
    description: "Every device on the simulated robot, with the lab manual's ports.",
    body: `# Library imports
from vex import *

# Brain should be defined by default
brain = Brain()

# Robot configuration code
brain_inertial = Inertial()
left_drive_smart = Motor(Ports.PORT6, 1.0, False)
right_drive_smart = Motor(Ports.PORT1, 1.0, True)
drivetrain = SmartDrive(left_drive_smart, right_drive_smart, brain_inertial, 200, 173, 76, MM, 1)
distance = Distance(Ports.PORT5)
optical = Optical(Ports.PORT3)
bumper = Bumper(Ports.PORT11)
touch_led = Touchled(Ports.PORT4)

optical.set_light(LedStateType.ON)

while True:
    brain.screen.clear_screen()
    brain.screen.set_cursor(1, 1)
    brain.screen.print("Dist", distance.object_distance(MM))
    brain.screen.next_row()
    brain.screen.print("Bright", optical.brightness())
    brain.screen.next_row()
    brain.screen.print("Bump", bumper.pressing(), " LED", touch_led.pressing())
    wait(100, MSEC)
`,
  },
];

export function newProject(name: string, description: string, body: string): Project {
  const settings = {
    project: {
      version: "1.0",
      name,
      description,
      creationDate: new Date().toISOString(),
      platform: "IQ2",
      language: "python",
      slot: 1,
      sdkVersion: "IQ2_20241105_PYTHON",
      python: { main: "src/main.py" },
    },
  };
  return {
    name, description, created: today(), main: "src/main.py",
    files: {
      ".vscode/vex_project_settings.json": JSON.stringify(settings, null, 2) + "\n",
      ".vscode/settings.json": JSON.stringify({ "python.analysis.typeCheckingMode": "off" }, null, 2) + "\n",
      ".vscode/extensions.json": JSON.stringify({ recommendations: ["VEXRobotics.vexcode", "ms-python.python"] }, null, 2) + "\n",
      "src/main.py": mainTemplate(name, description, body),
    },
  };
}
