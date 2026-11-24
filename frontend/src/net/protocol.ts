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
  robot?: IQ2RobotSnapshot;
  brain?: IQ2BrainSnapshot;
}

// ---------------------------------------------------------------- IQ (2nd gen)
export type IQ2Device = "left_motor" | "right_motor" | "distance" | "optical" | "bumper" | "touchled";
export type IQ2Drive = "fwd" | "rwd";
export type IQ2Config = Record<IQ2Device, { port: number; enabled: boolean }> & { drive?: IQ2Drive };

export interface IQ2MotorSnapshot { pos: number; vel: number; cur: number; mode: string }
export interface IQ2RobotSnapshot {
  pose: [number, number, number]; // x, y (mm), yaw (deg, CCW from +x)
  wheels: Record<"left_motor" | "right_motor", number>; // wheel angle (deg, + = rolling forward)
  omni: number;
  motors: Record<"left_motor" | "right_motor", IQ2MotorSnapshot>;
  heading: number;
  rotation: number;
  distance: number;
  distance_hit: boolean;
  optical: { brightness: number; hue: number; led: number; near: boolean };
  bumper: boolean;
  touchled: { color: string | null; pressed: boolean; brightness: number };
  contacts: string[];
  config: IQ2Config;
}

/** Brain screen drawing op (see backend/vexsim/robots/iq2/brain.py). */
export interface ScreenOp {
  o: "clr" | "t" | "r" | "c" | "l" | "p" | "clip";
  x?: number; y?: number; x2?: number; y2?: number; w?: number; h?: number; r?: number;
  s?: string; f?: string; c?: string; b?: string | null; bl?: number;
  pc?: string | null; fc?: string | null; pw?: number;
}
export interface IQ2BrainSnapshot { buttons: Record<"check" | "left" | "right", boolean>; screen: ScreenOp[]; battery: number }

export interface IQ2Line { points: [number, number][]; width: number; color: string; closed: boolean }
export interface IQ2Obstacle {
  id: string; shape: "box" | "cylinder"; center: [number, number]; height: number; yaw: number; color: string;
  size?: [number, number]; radius?: number;
}
export interface IQ2FieldDesc {
  name: string; kind: "iq2_field";
  floor: { size: [number, number]; color: string };
  lines: IQ2Line[]; obstacles: IQ2Obstacle[]; labels: { text: string; at: [number, number] }[];
}
export type Box6 = [number, number, number, number, number, number];
export interface IQ2Geometry {
  pitch: number;
  drive: { wheel_travel: number; track_width: number; wheel_base: number; wheel_width: number; omni_width: number; omni_rollers: number };
  motor: { size: Vec3 };
  footprint: { front: number; rear: number; half_width: number };
  brain: { center: Vec3; size: Vec3; screen_size: [number, number] };
  battery: { center: Vec3; size: Vec3 };
  rails: Box6[]; crossbars: Box6[]; corner_connectors: [number, number][];
  mounts: Record<"distance" | "optical" | "bumper" | "touchled", { pos: Vec3; dir: Vec3; size: Vec3 }>;
}
export interface IQ2RobotDesc { name: string; kind: "iq2_robot"; geometry: IQ2Geometry; start: [number, number, number]; config: IQ2Config }

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
export type EntityDesc = ArmDesc | TowerDesc | WorldDesc | IQ2FieldDesc | IQ2RobotDesc | { name: string; kind: "iq2_brain" };

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

export interface IQ2Scene {
  platform: "iq2";
  scenario: { id: string; name: string; description: string };
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
  | { type: "marker"; protrusion: number }
  | { type: "brain_button"; name: "check" | "left" | "right"; pressed: boolean }
  | { type: "touch"; pressed: boolean }
  | { type: "place_robot"; x: number; y: number; yaw: number }
  | { type: "reset_robot" }
  | { type: "robot_config"; config: IQ2Config }
  | { type: "realism"; on: boolean };
