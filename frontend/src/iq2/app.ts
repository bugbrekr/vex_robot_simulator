import type { ClientMsg, FrameMsg, IQ2Config, IQ2FieldDesc, IQ2RobotDesc, IQ2Scene, RunState, ServerMsg } from "../net/protocol";
import { SimSession } from "../net/session";
import { toast } from "../ui/menus";
import { BrainOS } from "./brainOS";
import {
  type ExampleInfo, KEYS, type Slot, type Slots, loadConfig, loadSlots, presetConfig, saveSlots, store,
} from "./store";

type Events = {
  hello: IQ2Scene;
  frame: FrameMsg;
  status: RunState;
  console: string;
  warning: string;
  error: { message: string; line: number | null; traceback: string };
  config: IQ2Config;
  slots: Slots;
  tab: string;
  examples: ExampleInfo[];
  maps: { id: string; name: string; description: string }[];
  map: string;
};

/** Shared state + server link for the three tabs. */
export class App {
  readonly session = new SimSession("iq2", "../");
  config: IQ2Config = loadConfig();
  slots: Slots = loadSlots();
  scene: IQ2Scene | null = null;
  field: IQ2FieldDesc | null = null;
  robotDesc: IQ2RobotDesc | null = null;
  lastFrame: FrameMsg | null = null;
  runState: RunState = "idle";
  map = store.get<string>(KEYS.map, "blank");
  realistic = store.get<boolean>(KEYS.realistic, true);
  brainName = store.get<string>(KEYS.brainName, "IQ2 Brain");
  examples: ExampleInfo[] = [];
  maps: { id: string; name: string; description: string }[] = [];
  runningSlot: number | null = null;
  connected = false;
  private handlers = new Map<keyof Events, ((v: unknown) => void)[]>();
  readonly os: BrainOS;

  constructor() {
    this.os = new BrainOS({
      slots: () => this.slots,
      config: () => this.config,
      robot: () => this.lastFrame?.robot ?? null,
      brainName: () => this.brainName,
      battery: () => this.lastFrame?.brain?.battery ?? 96,
      runSlot: (n) => this.runSlot(n),
      stopProgram: () => this.stop(),
      sendButton: (name, pressed) => this.send({ type: "brain_button", name, pressed }),
      eraseAllSlots: () => { for (let n = 1; n <= 8; n++) if (this.slots[n]) this.eraseSlot(n); },
      factoryReset: () => {
        for (let n = 1; n <= 8; n++) if (this.slots[n]) this.eraseSlot(n);
        this.brainName = "IQ2 Brain";
        store.set(KEYS.brainName, this.brainName);
      },
      changed: () => this.screenListeners.forEach((f) => f()),
    });
    this.session.onOpen = () => {
      this.connected = true;
      this.send({ type: "reset", scenario: this.map });
    };
    this.session.onClose = () => { this.connected = false; };
    this.session.on((m) => this.onMessage(m));
    void this.loadLists();
  }

  readonly screenListeners: (() => void)[] = [];

  on<K extends keyof Events>(k: K, fn: (v: Events[K]) => void): void {
    const list = this.handlers.get(k) ?? [];
    list.push(fn as (v: unknown) => void);
    this.handlers.set(k, list);
  }

  emit<K extends keyof Events>(k: K, v: Events[K]): void {
    for (const fn of this.handlers.get(k) ?? []) fn(v);
  }

  send(m: ClientMsg): void {
    this.session.send(m);
  }

  private async loadLists(): Promise<void> {
    try {
      this.maps = await (await fetch("../api/platforms/iq2/scenarios")).json();
      this.emit("maps", this.maps);
      this.examples = await (await fetch("../api/platforms/iq2/examples")).json();
      this.emit("examples", this.examples);
    } catch {
      toast("Could not reach the simulator server");
    }
  }

  async exampleCode(id: string): Promise<string> {
    const r = await fetch(`../api/platforms/iq2/examples/${encodeURIComponent(id)}`);
    return (await r.json()).code as string;
  }

  private onMessage(m: ServerMsg): void {
    switch (m.type) {
      case "hello": {
        const scene = m.scene as unknown as IQ2Scene;
        if (scene.platform !== "iq2") return;
        this.scene = scene;
        this.field = scene.entities.find((e) => e.kind === "iq2_field") as IQ2FieldDesc;
        this.robotDesc = scene.entities.find((e) => e.kind === "iq2_robot") as IQ2RobotDesc;
        // the worker starts with defaults: push this browser's robot setup and sensor mode
        this.send({ type: "robot_config", config: this.config });
        this.send({ type: "realism", on: this.realistic });
        this.os.program.clear();
        this.emit("hello", scene);
        break;
      }
      case "frame":
        this.lastFrame = m;
        if (m.brain?.screen.length) this.os.applyOps(m.brain.screen);
        this.os.tick();
        this.emit("frame", m);
        break;
      case "status":
        this.runState = m.state;
        this.os.setRunState(m.state);
        this.emit("status", m.state);
        break;
      case "console":
        this.emit("console", m.text);
        break;
      case "warning":
        this.emit("warning", m.text);
        break;
      case "error":
        this.emit("error", m);
        break;
    }
  }

  // ------------------------------------------------------------ robot setup
  setConfig(cfg: IQ2Config, quiet = false): void {
    if (this.runState === "running") {
      toast("Stop the program before changing the robot's devices");
      return;
    }
    this.config = cfg;
    store.set(KEYS.config, cfg);
    this.send({ type: "robot_config", config: cfg });
    this.emit("config", cfg);
    if (!quiet) toast("Robot devices updated");
  }

  applyPreset(ex: ExampleInfo): void {
    // a lab preset sets devices and ports; the drive layout is part of the build and stays
    this.setConfig({ ...presetConfig(ex.robot), drive: this.config.drive }, true);
  }

  setMap(id: string): void {
    this.map = id;
    store.set(KEYS.map, id);
    this.send({ type: "reset", scenario: id });
    this.emit("map", id);
  }

  setRealistic(on: boolean): void {
    this.realistic = on;
    store.set(KEYS.realistic, on);
    this.send({ type: "realism", on });
  }

  // ------------------------------------------------------------ brain slots
  download(n: number, slot: Slot): void {
    this.slots = { ...this.slots, [n]: slot };
    saveSlots(this.slots);
    this.emit("slots", this.slots);
  }

  eraseSlot(n: number): void {
    const s = { ...this.slots };
    delete s[n];
    this.slots = s;
    saveSlots(s);
    this.emit("slots", s);
  }

  runSlot(n: number): boolean {
    const s = this.slots[n];
    if (!s) { toast(`Slot ${n} is empty: download a program first`); return false; }
    this.runningSlot = n;
    this.os.program.clear();
    this.send({ type: "run", code: s.code, scenario: this.map });
    this.os.started(n);
    return true;
  }

  stop(): void {
    this.send({ type: "stop" });
  }

  switchTab(name: string): void {
    this.emit("tab", name);
  }
}
