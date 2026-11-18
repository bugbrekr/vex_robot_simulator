// Mirrors backend/vexsim/runner/protocol.py

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number]; // x, y, z, w

export interface LinkFrame { p: Vec3; q: Quat }

export interface ArmSnapshot {
  joints: number[];
  frames: LinkFrame[];
  tcp: Vec3; // configured TCP (what get_x/y/z report)
  tip: Vec3; // physical tip of the mounted tool
  rpy: Vec3; // yaw, roll, pitch
  tool: "magnet" | "pen"; // configured end effector
  mounted_tool: "magnet" | "pen"; // physically attached end effector
  pen_offset: number;
  marker_protrusion: number;
  /** pen offset that matches the mounted marker (0 for the kit default) */
  marker_offset: number;
  at_safe: boolean;
  sagging: boolean;
  magnet: boolean;
  holding: string | null;
  moving: boolean;
  speed: number;
  control_stopped: boolean;
  crashed: boolean;
  manual: boolean;
  /** new pen points; a stroke index of -1 means "board erased" */
  pen_points: [number, [number, number]][];
}

export type LedState = "on" | "off" | "blink";
export interface TowerSnapshot {
  leds: Record<string, LedState>;
  lit: Record<string, boolean>;
  bumper: boolean;
}

export interface ObjectSnapshot {
  id: string; kind: string; pos: Vec3; quat: Quat; held: boolean; grabbed: boolean;
  size: number; color: string; tag_id: number; tag_face: string;
}

export interface FrameMsg {
  type: "frame";
  t: number;
  state: RunState;
  phase: "" | "homing";
  paused: boolean;
  arm?: ArmSnapshot;
  signal_tower?: TowerSnapshot;
  world?: { objects: ObjectSnapshot[] };
}

export interface CubeDesc { id: string; kind: "cube"; size: number; color: string; tag_id: number; tag_face: string }

export interface ArmDesc {
  name: string;
  kind: "cte_arm";
  geometry: {
    shoulder_height: number; shoulder_forward: number; upper_arm: number; forearm: number;
    forearm_offset: number; wrist_to_flange: number; magnet_length: number;
    pen_lateral: number; marker_length: number; marker_diameter: number; safe_position: Vec3;
    base: { flange_radius: number; flange_height: number; body_radius: number; body_height: number; turret_radius: number };
    joints: { name: string; min: number; max: number }[];
  };
  pen_strokes: [number, number][][];
}

export interface TowerDesc { name: string; kind: "signal_tower"; position: [number, number]; colors: string[] }
export interface WorldDesc { name: string; kind: "world"; objects: CubeDesc[] }
export type EntityDesc = ArmDesc | TowerDesc | WorldDesc;

export interface Scene {
  platform: string;
  scenario: { id: string; name: string; description: string };
  tile: {
    size: number; height: number; cell: number; grid: number;
    bounds: [number, number, number, number];
    locations: Record<string, [number, number]>;
    surface: "tile" | "whiteboard";
    whiteboard: { outline: [number, number][]; screws: [number, number][] } | null;
  };
  entities: EntityDesc[];
}

export type RunState = "idle" | "running" | "finished" | "stopped";

export type ServerMsg =
  | { type: "server"; build: string | null }
  | { type: "hello"; scene: Scene }
  | FrameMsg
  | { type: "console"; text: string }
  | { type: "warning"; text: string; t?: number }
  | { type: "error"; message: string; line: number | null; traceback: string }
  | { type: "status"; state: RunState };

export type ClientMsg =
  | { type: "run"; code: string; scenario: string }
  | { type: "reset"; scenario: string; mounted_tool?: "magnet" | "pen"; marker_protrusion?: number }
  | { type: "stop" }
  | { type: "speed"; value: number }
  | { type: "pause"; value: boolean }
  | { type: "bumper"; pressed: boolean }
  | { type: "jog"; mode: "xyz" | "rpy"; delta: Vec3 }
  | { type: "jog"; mode: "abs"; pos: Vec3 }
  | { type: "tool"; tool?: "magnet" | "pen"; magnet?: boolean; pen_offset?: number; speed?: number }
  | { type: "safe" }
  | { type: "manual"; enabled: boolean }
  | { type: "drag"; pos: Vec3; upright?: boolean }
  | { type: "drag_end" }
  | { type: "erase" }
  | { type: "add_object"; kind: "cube"; x: number; y: number; z?: number; yaw?: number }
  | { type: "grab_object"; id: string }
  | { type: "move_object"; id: string; pos: Vec3 }
  | { type: "drop_object"; id: string; x: number; y: number; delete?: boolean }
  | { type: "remove_object"; id: string }
  | { type: "clear_objects" }
  | { type: "sim_home" }
  | { type: "marker"; protrusion: number };
