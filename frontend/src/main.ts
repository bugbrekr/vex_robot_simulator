import "./styles.css";
import * as THREE from "three";
import type { ArmDesc, FrameMsg, RunState, Scene, ServerMsg, TowerDesc, WorldDesc } from "./net/protocol";
import { FrameInterpolator } from "./net/interp";
import { SimSession } from "./net/session";
import { ArmView } from "./scene/armView";
import { ManualDrag } from "./scene/manualDrag";
import { ObjectDrag } from "./scene/objectDrag";
import { ObjectsView } from "./scene/objectsView";
import { SettingsStore, type SimSettings } from "./scene/settings";
import { Trail } from "./scene/trail";
import { PenStrokes } from "./scene/penStrokes";
import { SignalTowerView } from "./scene/signalTowerView";
import { buildTile, buildWhiteboard } from "./scene/tileView";
import { Viewport } from "./scene/viewport";
import { ConsolePanel } from "./ui/console";
import { CodeEditor } from "./ui/editor";
import { renderHelp } from "./ui/help";
import { ICONS } from "./ui/icons";
import { MenuBar, toast } from "./ui/menus";
import { MonitorPanel } from "./ui/monitor";
import { TeachPendant } from "./ui/pendant";
import { SimPanel } from "./ui/simPanel";

const PLATFORM = "cte";
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------------------------------------------------------------- icons
document.querySelectorAll<HTMLElement>("[data-icon]").forEach((el) => {
  el.innerHTML = ICONS[el.dataset.icon as keyof typeof ICONS] ?? "";
});

// ---------------------------------------------------------------- persistence (per-browser)
const store = {
  get(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string): void { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const K = { name: "vexsim:project:name", code: "vexsim:project:code", map: "vexsim:project:map", panel: "vexsim:panel", split: "vexsim:split" };

// ---------------------------------------------------------------- core objects
const session = new SimSession(PLATFORM);
let lastFrame: FrameMsg | null = null;
const settings = new SettingsStore();
const viewport = new Viewport($("viewport"));
viewport.apply(settings.value);
const consolePanel = new ConsolePanel($("console"));
const scenarioSel = $<HTMLSelectElement>("scenario");
const projectName = $<HTMLInputElement>("project-name");
const saveState = $("save-state");
let scenarios: { id: string; name: string; description: string }[] = [];
let runState: RunState = "idle";
let connected = false;

let saveTimer = 0;
const editor = new CodeEditor($("editor"), (code) => {
  saveState.textContent = "Saving…";
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => { store.set(K.code, code); saveState.textContent = "Saved"; }, 400);
}, run);

const pendant = new TeachPendant($("pendant"), (m) => session.send(m));
pendant.onInsertMoveTo = (x, y, z) => insertMoveTo([x, y, z]);
pendant.onCopy = () => void copyCoords();

/** Tool-tip coordinates (magnet face / marker tip), rounded like the pendant dashboard. */
function tipCoords(): [number, number, number] | null {
  const a = lastFrame?.arm;
  return a ? (a.tip.map((v) => Math.round(v)) as [number, number, number]) : null;
}
function insertMoveTo(p: [number, number, number] | null = tipCoords()): void {
  if (!p) return;
  editor.insertAtCursor(`arm.move_to(${p[0]}, ${p[1]}, ${p[2]})`);
  toast(`Inserted arm.move_to(${p.join(", ")})`);
}
async function copyCoords(): Promise<void> {
  const p = tipCoords();
  if (!p) return;
  try { await navigator.clipboard.writeText(p.join(", ")); toast(`Copied ${p.join(", ")}`); }
  catch { toast(`Clipboard unavailable - coordinates: ${p.join(", ")}`); }
}
const monitor = new MonitorPanel($("monitor"), (m) => session.send(m));
renderHelp($("help"));
// cube dragging must register before the manual-mode arm drag (it yields when the arm is closer)
const objectDrag = new ObjectDrag(viewport, () => objectsView, (m) => session.send(m));
objectDrag.setGhostColor(settings.value.cubeColor);
const keepUpright = $<HTMLInputElement>("keep-upright");
let uprightTouched = false; // follow the mounted tool (pen -> on) until the user picks
keepUpright.onchange = () => { uprightTouched = true; };
const drag = new ManualDrag(viewport, (pos) => { draggingArm = true; session.send({ type: "drag", pos, upright: keepUpright.checked }); },
  () => { draggingArm = false; session.send({ type: "drag_end" }); });
const trail = new Trail();
viewport.scene.add(trail.line);
const simPanel = new SimPanel($("sim"), (m) => session.send(m), settings);
simPanel.onSpawnStart = (e) => objectDrag.beginSpawn(e);
simPanel.onResetSim = () => resetSim();
simPanel.onClearTrail = () => trail.clear();

// ---------------------------------------------------------------- scene graph
let sceneRoot = new THREE.Group();
viewport.scene.add(sceneRoot);
let tileGroup = new THREE.Group();
let lastScene: Scene | null = null;
let armView: ArmView | null = null;
let objectsView: ObjectsView | null = null;
let towerView: SignalTowerView | null = null;
const pen = new PenStrokes();

function buildScene(scene: Scene): void {
  viewport.scene.remove(sceneRoot);
  sceneRoot = new THREE.Group();
  viewport.scene.add(sceneRoot);
  lastScene = scene;
  tileGroup = buildTile(scene, settings.value);
  sceneRoot.add(tileGroup);
  objectDrag.bounds = scene.tile.bounds;
  trail.clear();
  objectsView = new ObjectsView();
  objectsView.setColor(settings.value.cubeColor);
  sceneRoot.add(objectsView.root);
  if (scene.tile.surface === "whiteboard" && scene.tile.whiteboard) {
    sceneRoot.add(buildWhiteboard(scene.tile.whiteboard.outline, scene.tile.whiteboard.screws));
  }
  armView = towerView = null;
  monitor.setTower(null);
  pen.reset();
  sceneRoot.add(pen.root);
  for (const e of scene.entities) {
    if (e.kind === "cte_arm") {
      armView = new ArmView(e as ArmDesc, settings.value);
      sceneRoot.add(armView.root);
      pen.reset((e as ArmDesc).pen_strokes);
    } else if (e.kind === "signal_tower") {
      towerView = new SignalTowerView(e as TowerDesc);
      sceneRoot.add(towerView.root);
      monitor.setTower((e as TowerDesc).colors);
    }
  }
  drag.setGrabTargets(armView ? armView.grabbable : []);
  objectDrag.competing = () => (armView && manualOn ? armView.grabbable : []);
  renderInfo(scene);
}

// ---------------------------------------------------------------- frame handling
// Frames are split in two paths:
//  * applyFrame(): on arrival - panels, text readouts, discrete state, ink (exactly once)
//  * render ticks: the 3D view plays an interpolated stream slightly behind the newest frame,
//    which hides network jitter and gives display-rate smooth motion.
const interp = new FrameInterpolator();
let draggingArm = false;

viewport.onTick((dt) => {
  // stay closer to "live" while the user is steering the arm by hand
  interp.lagWall = draggingArm ? 0.04 : 0.1;
  const f = interp.sample(dt);
  if (!f) return;
  if (f.arm && armView) {
    armView.update(f.arm);
    drag.setTcp(f.arm.tip);
    if (settings.value.trail) trail.push(f.arm.tip);
  }
  if (f.world && objectsView) objectsView.update(f.world.objects);
});

function applyFrame(f: FrameMsg): void {
  interp.push(f);
  if (f.arm && armView) {
    for (const [stroke, p] of f.arm.pen_points) pen.add(stroke, p);
    pendant.update(f.arm);
    pendant.setPhase(f.phase);
    const manual = f.arm.manual && runState !== "running";
    manualOn = manual;
    if (!uprightTouched) keepUpright.checked = f.arm.mounted_tool === "pen";
    drag.setEnabled(manual);
    $("manual-banner").hidden = !manual;
    $("sim-tcp").textContent = `x ${f.arm.tcp[0].toFixed(0)}  y ${f.arm.tcp[1].toFixed(0)}  z ${f.arm.tcp[2].toFixed(0)}`;
  }
  simPanel.update(f);
  $("sim-paused").hidden = !f.paused;
  if (f.signal_tower) towerView?.update(f.signal_tower);
  monitor.update(f);
  $("sim-time").textContent = `t = ${f.t.toFixed(2)} s`;
}

function setRunState(s: RunState): void {
  runState = s;
  const pill = $("sim-state");
  pill.textContent = s;
  pill.className = `pill ${s}`;
  $("tb-run").classList.toggle("running", s === "running");
  $<HTMLButtonElement>("tb-stop").disabled = s !== "running";
  pendant.setRunState(s);
  simPanel.setRunState(s);
}

function setConnected(c: boolean): void {
  connected = c;
  $("tb-device").classList.toggle("connected", c);
  $("tb-device").title = c ? "Simulated 6-Axis Arm: connected" : "Simulator disconnected - reconnecting…";
  pendant.setConnected(c);
}

session.on((msg: ServerMsg) => {
  switch (msg.type) {
    case "server":
      // the server is serving a newer build than this tab is running
      if (msg.build && __BUILD_ID__ !== "dev" && msg.build !== __BUILD_ID__) showReloadBanner();
      break;
    case "hello": interp.reset(); buildScene(msg.scene); setConnected(true); break;
    case "frame": applyFrame(msg); break;
    case "console": consolePanel.print(msg.text); break;
    case "warning": consolePanel.warn(msg.text); break;
    case "error":
      consolePanel.error(`${msg.traceback ? msg.traceback : ""}${msg.message}${msg.line ? `  (line ${msg.line})` : ""}`);
      editor.markError(msg.line);
      break;
    case "status":
      setRunState(msg.state);
      if (msg.state === "finished") consolePanel.info("[project finished]");
      if (msg.state === "stopped") consolePanel.info("[project stopped]");
      break;
  }
});
session.onOpen = () => {
  session.send({ type: "speed", value: Number($<HTMLSelectElement>("speed").value) });
  if (scenarioSel.value) session.send({ type: "reset", scenario: scenarioSel.value });
};
session.onClose = () => setConnected(false);

function showReloadBanner(): void {
  if (document.getElementById("reload-banner")) return;
  const b = document.createElement("div");
  b.id = "reload-banner";
  b.className = "reload-banner";
  b.innerHTML = 'A newer version of the simulator is available. <button>Reload</button>';
  b.querySelector("button")!.onclick = () => location.reload();
  document.body.appendChild(b);
}

// ---------------------------------------------------------------- project actions
function run(): void {
  editor.markError(null);
  consolePanel.clear();
  session.send({ type: "run", scenario: scenarioSel.value, code: editor.code });
}
function stop(): void { session.send({ type: "stop" }); }
/** Simulator-only: reload the map from scratch (arm, objects, drawings). */
function resetSim(): void {
  editor.markError(null);
  trail.clear();
  // the mounted end effector is hardware: it stays on across map changes / resets
  const arm = lastFrame?.arm;
  session.send({ type: "reset", scenario: scenarioSel.value, mounted_tool: arm?.mounted_tool, marker_protrusion: arm?.marker_protrusion });
}
function selectMap(id: string): void {
  if (id !== scenarioSel.value || !lastScene || lastScene.scenario.id !== id) {
    scenarioSel.value = id;
    store.set(K.map, id);
    resetSim();
  }
}
interface Example { id: string; title: string; map: string; tool?: string; group?: string }
let examples: Example[] = [];
async function exampleCode(id: string): Promise<{ code: string; map: string; title: string; tool?: string }> {
  const res = await fetch(`api/platforms/${PLATFORM}/examples/${id}`);
  return res.json();
}
async function loadExample(id: string): Promise<void> {
  const ex = await exampleCode(id);
  editor.code = ex.code;
  projectName.value = ex.title.replace(/\W+/g, "");
  store.set(K.name, projectName.value);
  if (ex.map !== scenarioSel.value) {
    selectMap(ex.map);
    toast(`Switched map to ${scenarios.find((s) => s.id === ex.map)?.name ?? ex.map}`);
  }
  const mounted = lastFrame?.arm?.mounted_tool;
  if (ex.tool && mounted && ex.tool !== mounted) {
    consolePanel.warn(`This example uses the ${ex.tool === "pen" ? "Pen Holder Tool" : "Magnet Pickup Tool"}. ` +
      "Move to Safe Position, then change the End Effector in the Teach Pendant (or the Simulation panel).");
  }
}
const NEW_PROJECT = `#region VEXcode Generated Robot Configuration
from cte import *
import math
import random

# Brain should be defined by default
brain = Brain()

# Robot configuration code
arm = Arm()
signal_tower = arm.signal_tower


# Wait for sensor(s) to fully initialize
wait(100, MSEC)

#endregion VEXcode Generated Robot Configuration
# ------------------------------------------
# 
#     Project:      VEXcode Project
#    Author:       VEX
#    Created:
#    Description:  VEXcode CTE Python Project
# 
# ------------------------------------------

# Library imports
from cte import *

# Add project code in "main"
def main():
    arm.move_to(180, 0, 180)

# CTE threads — Do not delete
cte_thread(main)
`;
function newProject(): void {
  if (!confirm("Start a new project? Unsaved changes in the editor will be replaced.")) return;
  editor.code = NEW_PROJECT;
  projectName.value = "ArmProject";
  store.set(K.name, projectName.value);
}
function downloadProject(): void {
  const blob = new Blob([editor.code], { type: "text/x-python" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${projectName.value || "ArmProject"}.py`;
  a.click();
  URL.revokeObjectURL(a.href);
}
const fileOpen = $<HTMLInputElement>("file-open");
fileOpen.onchange = async () => {
  const f = fileOpen.files?.[0];
  if (!f) return;
  editor.code = await f.text();
  projectName.value = f.name.replace(/\.[^.]+$/, "");
  store.set(K.name, projectName.value);
  fileOpen.value = "";
};

// ---------------------------------------------------------------- menus
const menus = new MenuBar($("menubar"));
menus.add("File", () => [
  { label: "New Project", action: newProject },
  { label: "Open…", shortcut: "Ctrl+O", action: () => fileOpen.click() },
  { label: "Load Example", items: examples.filter((e) => !e.group).map((e) => ({ label: e.title, action: () => void loadExample(e.id) })) },
  { label: "Lab Programs", items: examples.filter((e) => e.group === "Lab Programs").map((e) => ({ label: e.title, action: () => void loadExample(e.id) })) },
  { separator: true },
  { label: "Save to your computer", shortcut: "Ctrl+S", action: downloadProject },
]);
menus.add("Edit", () => [
  { label: "Undo", shortcut: "Ctrl+Z", action: () => editor.undo() },
  { label: "Redo", shortcut: "Ctrl+Y", action: () => editor.redo() },
  { separator: true },
  { label: "Select All", shortcut: "Ctrl+A", action: () => editor.selectAll() },
  { label: "Find / Replace", shortcut: "Ctrl+F", action: () => editor.find() },
]);
menus.add("Tools", () => [
  { label: "Move to Safe Position", disabled: runState === "running", action: () => session.send({ type: "safe" }) },
  { label: "Simulation Controls…", action: () => openPanel("sim") },
  { label: "Reset Simulation", action: resetSim },
  { label: "Erase Whiteboard", action: () => session.send({ type: "erase" }) },
  { separator: true },
  { label: "Clear Print Console", action: () => consolePanel.clear() },
]);
menus.add("Help", () => [
  { label: "Python Command Help", action: () => openPanel("help") },
  { label: "VEX CTE Python API ↗", action: () => window.open("https://api.vex.com/cte/home/python/index.html", "_blank", "noopener") },
  { label: "Teach Pendant guide ↗", action: () => window.open("https://kb.vex.com/hc/en-us/articles/27274957624852-Using-the-Teach-Pendant-with-the-6-Axis-Arm", "_blank", "noopener") },
]);

// ---------------------------------------------------------------- toolbar
$("tb-run").onclick = run;
$("tb-stop").onclick = stop;
$("tb-share").onclick = async () => {
  try { await navigator.clipboard.writeText(editor.code); toast("Project code copied to clipboard"); }
  catch { toast("Clipboard not available - use File ▸ Save"); }
};
$("tb-download").onclick = downloadProject;
$("tb-device").onclick = () => toast(connected ? "Simulated 6-Axis Arm is connected" : "Connecting to the simulator…");
projectName.oninput = () => store.set(K.name, projectName.value);
document.addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey;
  // single-key shortcuts (not while typing): C copy xyz, M insert move_to, V keep tool vertical
  const typing = (e.target as HTMLElement).closest?.(".cm-editor, input, textarea, select");
  if (!mod && !e.altKey && !typing && !e.repeat) {
    const k = e.key.toLowerCase();
    if (k === "c") { e.preventDefault(); void copyCoords(); return; }
    if (k === "m") { e.preventDefault(); insertMoveTo(); return; }
    if (k === "v" && manualOn) { e.preventDefault(); keepUpright.checked = !keepUpright.checked; uprightTouched = true; toast(`Keep tool vertical: ${keepUpright.checked ? "on" : "off"}`); return; }
  }
  if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); downloadProject(); }
  if (mod && e.key.toLowerCase() === "o") { e.preventDefault(); fileOpen.click(); }
});

// ---------------------------------------------------------------- simulation bar
scenarioSel.onchange = () => selectMap(scenarioSel.value);
$<HTMLSelectElement>("speed").onchange = (e) => session.send({ type: "speed", value: Number((e.target as HTMLSelectElement).value) });
$("sim-reset").onclick = () => { if (confirm("Reset the simulation? The arm, objects and drawings go back to the map's start.")) resetSim(); };
$("sim-pause").onclick = () => session.send({ type: "pause", value: !$("sim-paused").hidden ? false : true });
$("sim-open").onclick = () => openPanel("sim");
$("sim-erase").onclick = () => session.send({ type: "erase" });
$("view-3d").onclick = () => viewport.resetView();
$("view-top").onclick = () => viewport.topView();
$("view-side").onclick = () => viewport.sideView();
$("console-clear").onclick = () => consolePanel.clear();

// ---------------------------------------------------------------- side panel
const TITLES: Record<string, string> = { pendant: "Teach Pendant", monitor: "Monitor", help: "Help", code: "Map & Info", sim: "Simulation" };
function openPanel(name: string): void {
  $("panel").hidden = false;
  $("strip").hidden = true;
  $("panel-title").textContent = TITLES[name];
  document.querySelectorAll<HTMLElement>(".panel-page").forEach((p) => (p.hidden = p.dataset.page !== name));
  document.querySelectorAll<HTMLElement>(".side-ico").forEach((b) => b.classList.toggle("active", b.dataset.panel === name));
  store.set(K.panel, name);
}
function closePanel(): void {
  $("panel").hidden = true;
  $("strip").hidden = false;
  store.set(K.panel, "");
}
document.querySelectorAll<HTMLElement>("[data-panel]").forEach((b) => (b.onclick = () => openPanel(b.dataset.panel!)));
$("panel-collapse").onclick = closePanel;

function renderInfo(scene: Scene): void {
  const loc = scene.tile.locations;
  const cells: string[] = [];
  // grid as seen from above with +X down the page, +Y to the right (VEX lesson orientation)
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 6; col++) {
      const n = row * 6 + col + 1;
      const [x, y] = loc[String(n)];
      cells.push(`<div class="${n === 8 ? "base" : ""}"><b>${n}</b>${x},${y}</div>`);
    }
  }
  const world = scene.entities.find((e) => e.kind === "world") as WorldDesc | undefined;
  const objs = world?.objects.map((o) => `${o.id} (tag ${o.tag_id}, ${o.size} mm)`).join("<br>") || "none";
  $("info").innerHTML = `
    <section class="card tp-section"><h4>${scene.scenario.name}</h4>
      <p class="hint" style="color:#333">${scene.scenario.description ?? ""}</p>
      <dl class="info-dl" style="margin:0 10px 10px">
        <dt>Surface</dt><dd>${scene.tile.surface === "whiteboard" ? "Dry-Erase Surface (whiteboard)" : "CTE Tile"}</dd>
        <dt>Objects</dt><dd>${objs}</dd>
        <dt>Safe pos.</dt><dd>(120, 0, 100) mm</dd>
      </dl>
    </section>
    <section class="card tp-section"><h4>Tile locations (x, y mm)</h4>
      <div class="loc-grid">${cells.join("")}</div>
      <p class="hint">Arm base = location 8 = origin (0, 0). +X runs down this grid, +Y to the right. z = 0 is the Tile surface.</p>
    </section>
    <section class="card tp-section"><h4>Mouse & keys</h4>
      <dl class="info-dl" style="margin:10px">
        <dt>Orbit / pan / zoom</dt><dd>Left drag / right drag / wheel</dd>
        <dt>Manual Mode</dt><dd>Drag the arm; Shift = up/down</dd>
        <dt>Run</dt><dd>Ctrl/Cmd + Enter</dd>
        <dt>Save</dt><dd>Ctrl/Cmd + S</dd>
      </dl>
    </section>`;
}

// ---------------------------------------------------------------- settings
let manualOn = false;
settings.onChange((v: SimSettings, changed) => {
  viewport.apply(v);
  if (lastScene && changed.some((k) => k === "tileNumbers" || k === "tileGrid" || k === "tileHoles")) {
    sceneRoot.remove(tileGroup);
    tileGroup = buildTile(lastScene, v);
    sceneRoot.add(tileGroup);
  }
  armView?.applySettings(v);
  if (changed.includes("cubeColor")) { objectsView?.setColor(v.cubeColor); objectDrag.setGhostColor(v.cubeColor); }
  trail.line.visible = v.trail;
  if (!v.trail) trail.clear();
});
trail.line.visible = settings.value.trail;

// ---------------------------------------------------------------- splitter
const split = $("split-1");
const edPane = document.querySelector<HTMLElement>(".editor-pane")!;
const savedSplit = store.get(K.split);
if (savedSplit) edPane.style.width = savedSplit;
split.onpointerdown = (e) => {
  split.setPointerCapture(e.pointerId);
  split.classList.add("drag");
  const startX = e.clientX, startW = edPane.getBoundingClientRect().width;
  split.onpointermove = (ev) => { edPane.style.width = `${Math.max(280, startW + ev.clientX - startX)}px`; };
  split.onpointerup = () => {
    split.onpointermove = null;
    split.classList.remove("drag");
    store.set(K.split, edPane.style.width);
  };
};

// ---------------------------------------------------------------- init
async function init(): Promise<void> {
  scenarios = await (await fetch(`api/platforms/${PLATFORM}/scenarios`)).json();
  examples = await (await fetch(`api/platforms/${PLATFORM}/examples`)).json();
  scenarioSel.innerHTML = scenarios.map((s) => `<option value="${s.id}">${s.name}</option>`).join("");
  const map = store.get(K.map);
  if (map && scenarios.some((s) => s.id === map)) scenarioSel.value = map;
  projectName.value = store.get(K.name) || "ArmProject";
  const code = store.get(K.code);
  editor.code = code ?? (await exampleCode(examples.find((e) => e.map === scenarioSel.value && !e.group)?.id ?? examples[0].id)).code;
  saveState.textContent = "Saved";
  const panel = store.get(K.panel);
  if (panel === "") closePanel(); else openPanel(panel && TITLES[panel] ? panel : "pendant");
  setRunState("idle");
  session.send({ type: "reset", scenario: scenarioSel.value });
}
void init();

// Debug/test hook (used by automated UI checks): screen position of the manual-drag handle.
session.on((m) => { if (m.type === "frame") lastFrame = m; });
(window as unknown as { __vexsim: unknown }).__vexsim = {
  frame: () => lastFrame,
  /** tool tip as currently drawn (interpolated) */
  drawnTip: () => drag.handle.position.toArray(),
  camera(pos: [number, number, number], target: [number, number, number]) {
    viewport.camera.position.set(...pos);
    viewport.controls.target.set(...target);
    viewport.controls.update();
  },
  /** Screen position of a world point (mm). */
  screen(p: [number, number, number]): [number, number] {
    const v = new THREE.Vector3(...p).project(viewport.camera);
    const r = viewport.renderer.domElement.getBoundingClientRect();
    return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
  },
  handleScreen(): [number, number] {
    const v = drag.handle.position.clone().project(viewport.camera);
    const r = viewport.renderer.domElement.getBoundingClientRect();
    return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
  },
};
