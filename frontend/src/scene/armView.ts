import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { ArmDesc, ArmSnapshot } from "../net/protocol";
import type { SimSettings } from "./settings";
import { noiseTexture } from "./textures";

/*
 * Visual model of the CTE 6-Axis Arm, after VEX's renders: white shells, dark-grey joint
 * housings / wrist, charcoal base on a dark base plate. Each link group is posed from the
 * backend's FK frames: [J1 turret, J2 upper arm, J3 forearm, J4 wrist roll, J5 wrist pitch,
 * J6 flange]. Tools hang off the flange frame (tool axis = local +x, ee-forward = local +z).
 */

const DARK = 0x575b61;
const CHARCOAL = 0x3b3f44;
const BLACK = 0x1c1e21;

type Axis = "x" | "y" | "z";

function std(color: number | string, rough = 0.5, metal = 0.05, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
}

function shadow<T extends THREE.Object3D>(o: T): T {
  o.traverse((c) => { if ((c as THREE.Mesh).isMesh) { c.castShadow = true; c.receiveShadow = true; } });
  return o;
}

/** Cylinder along `axis`, from `from` to `from + len` (or centred if from is null). */
function cyl(r: number, len: number, axis: Axis, mat: THREE.Material, from: number | null = 0, seg = 40, r2 = r) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r2, r, len, seg), mat);
  const off = from === null ? 0 : from + len / 2;
  if (axis === "x") { m.rotation.z = -Math.PI / 2; m.position.x = off; }
  else if (axis === "z") { m.rotation.x = Math.PI / 2; m.position.z = off; }
  else { m.position.y = off; }
  return shadow(m);
}

function rbox(sx: number, sy: number, sz: number, mat: THREE.Material, x = 0, y = 0, z = 0, radius = 5) {
  const r = Math.min(radius, sx / 2 - 0.01, sy / 2 - 0.01, sz / 2 - 0.01);
  const m = new THREE.Mesh(new RoundedBoxGeometry(sx, sy, sz, 3, r), mat);
  m.position.set(x, y, z);
  return shadow(m);
}

/** Joint housing: shell cylinder along y with dark end caps and 4 screw heads per side. */
function jointHousing(r: number, width: number, shell: THREE.Material, cap: THREE.Material, screw: THREE.Material) {
  const g = new THREE.Group();
  g.add(cyl(r, width, "y", shell, null));
  for (const side of [-1, 1]) {
    const c = cyl(r * 0.78, 1.6, "y", cap, null);
    c.position.y = side * (width / 2 + 0.6);
    g.add(c);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const s = cyl(1.8, 1.2, "y", screw, null, 12);
      s.position.set(Math.cos(a) * r * 0.55, side * (width / 2 + 1.5), Math.sin(a) * r * 0.55);
      g.add(s);
    }
  }
  return g;
}

/** Flat printed marking (canvas texture on a plane in the XY plane, facing +z). */
function decal(wmm: number, hmm: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void) {
  const scale = 12; // px per mm
  const c = document.createElement("canvas");
  c.width = Math.round(wmm * scale);
  c.height = Math.round(hmm * scale);
  const g = c.getContext("2d")!;
  draw(g, c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(wmm, hmm),
    new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, roughness: 0.6 }),
  );
  m.receiveShadow = true;
  return m;
}

/** Axis arrow like the one printed on the base plate: "+" and the axis letter. */
function axisMark(letter: string, color: string) {
  return decal(22, 12, (g, w, h) => {
    g.strokeStyle = g.fillStyle = color;
    g.lineWidth = h * 0.09;
    g.lineCap = "round";
    g.beginPath(); g.moveTo(w * 0.08, h / 2); g.lineTo(w * 0.62, h / 2); g.stroke();
    g.beginPath(); g.moveTo(w * 0.72, h / 2); g.lineTo(w * 0.52, h * 0.3); g.lineTo(w * 0.52, h * 0.7); g.closePath(); g.fill();
    g.font = `700 ${h * 0.42}px "Open Sans", sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(letter, w * 0.22, h * 0.2 + 1);
    g.fillText("+", w * 0.88, h / 2);
  });
}

/** Joint marking: name + rotation-direction arc, printed on a joint cap. */
function jointMark(name: string, color = "#e9ecef", size = 22) {
  return decal(size, size, (g, w, h) => {
    g.strokeStyle = g.fillStyle = color;
    g.lineWidth = w * 0.045;
    g.lineCap = "round";
    const r = w * 0.36;
    g.beginPath(); g.arc(w / 2, h / 2, r, Math.PI * 0.75, Math.PI * 2.15); g.stroke();
    const a = Math.PI * 2.15, ex = w / 2 + r * Math.cos(a), ey = h / 2 + r * Math.sin(a);
    g.beginPath(); g.moveTo(ex + w * 0.08, ey - w * 0.02); g.lineTo(ex - w * 0.05, ey - w * 0.08); g.lineTo(ex - w * 0.02, ey + w * 0.08); g.closePath(); g.fill();
    g.font = `700 ${w * 0.3}px "Open Sans", sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(name, w / 2, h / 2 + 1);
  });
}

/** Put a decal on the outer face of a joint cap whose axis is y (side = -1 or +1). */
function onCap(m: THREE.Mesh, yFace: number, side: number) {
  m.rotation.x = side < 0 ? Math.PI / 2 : -Math.PI / 2;
  m.position.y = yFace + side * 0.3;
  return m;
}

export class ArmView {
  readonly root = new THREE.Group();
  private links: THREE.Group[] = [];
  private shell: THREE.MeshStandardMaterial;
  private magnetTool = new THREE.Group();
  private penTool = new THREE.Group();
  private magnetFace: THREE.MeshStandardMaterial;
  private marker = new THREE.Group();
  private tcpMarker: THREE.Mesh;
  private cables: THREE.Object3D[] = [];
  private g: ArmDesc["geometry"];

  /** Meshes the user can grab in Manual Mode. */
  get grabbable(): THREE.Object3D[] {
    return this.links.slice(1);
  }

  constructor(desc: ArmDesc, settings: SimSettings) {
    const g = (this.g = desc.geometry);
    const b = g.base;
    this.shell = std(settings.armColor, 0.42, 0.0, { roughnessMap: noiseTexture(11, 3) });
    const shell = this.shell;
    const dark = std(DARK, 0.55, 0.15);
    const charcoal = std(CHARCOAL, 0.6, 0.2);
    const black = std(BLACK, 0.5, 0.3);
    const screw = std(0x222428, 0.35, 0.7);

    // ---------------- static base: base plate, flange ring, body
    const plate = cyl(85, 2.4, "z", std(0x5c6066, 0.85, 0.1), 0, 64);
    plate.receiveShadow = true;
    this.root.add(plate);
    for (const [bx, by] of [[-50, -50], [-50, 50], [50, -50], [50, 50]]) { // bolts at tile locations 1, 3, 13, 15
      const s = cyl(4.6, 2.2, "z", screw, 2.2, 16);
      s.position.x = bx;
      s.position.y = by;
      this.root.add(s);
      const washer = cyl(6.2, 0.8, "z", std(0x3a3d41, 0.5, 0.5), 2.2, 20);
      washer.position.x = bx;
      washer.position.y = by;
      this.root.add(washer);
    }
    // axis directions printed on the base plate (white, like the real one)
    const xm = axisMark("X", "#f1f3f5");
    xm.position.set(77, 0, 2.5);
    xm.rotation.z = 0;
    const ym = axisMark("Y", "#f1f3f5");
    ym.position.set(0, 77, 2.5);
    ym.rotation.z = Math.PI / 2;
    this.root.add(xm, ym);
    const homeMark = decal(12, 12, (g, w) => { g.strokeStyle = "#f1f3f5"; g.lineWidth = w * 0.08; g.beginPath(); g.arc(w / 2, w / 2, w * 0.36, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(w / 2, w / 2, w * 0.08, 0, Math.PI * 2); g.fillStyle = "#f1f3f5"; g.fill(); });
    homeMark.position.set(-56, -56, 2.5); // origin/home mark
    this.root.add(homeMark);
    this.root.add(cyl(b.flange_radius, b.flange_height, "z", charcoal, 2.4, 64));
    this.root.add(cyl(b.body_radius, b.body_height - b.flange_height - 2.4, "z", dark, b.flange_height + 2.4, 64));
    const ring = cyl(b.body_radius + 0.6, 3, "z", std(0x2c2f33, 0.4, 0.4), b.body_height - 6, 64);
    this.root.add(ring);

    for (let i = 0; i < 6; i++) {
      const grp = new THREE.Group();
      this.links.push(grp);
      this.root.add(grp);
    }
    const [turret, upper, fore, wristRoll, wristPitch, flange] = this.links;
    const sh = g.shoulder_height, sf = g.shoulder_forward;

    // ---------------- J1 turret: round lower shell + shoulder housing block
    turret.add(cyl(b.turret_radius, 16, "z", shell, b.body_height, 64));
    turret.add(rbox(66, 84, sh - b.body_height - 6, shell, sf * 0.6, 0, b.body_height + 10 + (sh - b.body_height - 6) / 2 - 4, 10));
    const shoulderHousing = jointHousing(27, 64, shell, dark, screw);
    shoulderHousing.position.set(sf, 0, sh);
    shoulderHousing.add(onCap(jointMark("J2"), -33.4, -1));
    turret.add(shoulderHousing);
    const j1 = jointMark("J1", "#5b6168", 20);
    // facing +x (front), text running along +y, up = +z
    j1.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(
      new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0)));
    j1.position.set(sf * 0.6 + 33.4, 0, b.body_height + 22);
    turret.add(j1);

    // ---------------- J2 upper arm (frame at shoulder axis, link along +z)
    upper.add(rbox(38, 44, g.upper_arm, shell, 0, 0, g.upper_arm / 2, 12));
    const recess = rbox(20, 46, g.upper_arm - 60, std(0xe4e6e8, 0.5), 0, 0, g.upper_arm / 2, 6);
    recess.scale.set(1, 1.01, 1);
    upper.add(recess);
    const elbowHousing = jointHousing(24, 58, shell, dark, screw);
    elbowHousing.position.z = g.upper_arm;
    elbowHousing.add(onCap(jointMark("J3"), -30.4, -1));
    upper.add(elbowHousing);
    const zeroLine = decal(3, 30, (gg, w, h) => { gg.fillStyle = "#8a9097"; gg.fillRect(0, 0, w, h); });
    zeroLine.rotation.x = Math.PI / 2;
    zeroLine.position.set(0, -22.2, g.upper_arm - 40);
    upper.add(zeroLine); // alignment mark on the upper arm

    // ---------------- J3 forearm (frame at elbow axis; tube along +x at z = forearm_offset)
    fore.add(rbox(44, 40, g.forearm_offset + 30, shell, 6, 0, g.forearm_offset / 2, 10));
    const tubeLen = g.forearm - 30;
    fore.add(rbox(tubeLen, 30, 30, shell, 12 + tubeLen / 2, 0, g.forearm_offset, 9));
    const stripe = rbox(tubeLen - 30, 31, 3, std(0x9aa1a8, 0.5), 12 + tubeLen / 2, 0, g.forearm_offset + 15.2, 1.4);
    fore.add(stripe);

    // ---------------- J4 wrist roll actuator (rotates about x at the wrist centre)
    wristRoll.add(cyl(16.5, 22, "x", dark, -36));
    wristRoll.add(cyl(17.5, 3, "x", std(0x2c2f33, 0.4, 0.4), -15));
    const j4 = jointMark("J4", "#e9ecef", 16);
    j4.rotation.x = Math.PI / 2;
    j4.position.set(-27, -16.6, 0);
    wristRoll.add(j4);

    // ---------------- J5 wrist pitch block (dark), pivot along y
    wristPitch.add(rbox(44, 36, 32, dark, -2, 0, 0, 9));
    const j5cap = jointHousing(15, 36, dark, std(0x45494e, 0.5), screw);
    j5cap.add(onCap(jointMark("J5", "#e9ecef", 18), -19.4, -1));
    wristPitch.add(j5cap);
    wristPitch.add(cyl(13, g.wrist_to_flange, "x", dark, 0));

    // ---------------- J6 flange + tools (tool axis = +x)
    flange.add(cyl(14, 3, "x", charcoal, -1.5));
    const j6 = jointMark("J6", "#e9ecef", 14);
    j6.rotation.x = Math.PI / 2;
    j6.position.set(0.5, -14.2, 0);
    flange.add(j6);
    this.buildMagnet(dark, black);
    this.buildPen(dark);
    flange.add(this.magnetTool, this.penTool);

    // ---------------- cables (cosmetic, ride on the links)
    const cableMat = std(0x111214, 0.6, 0.1);
    const loop = (pts: [number, number, number][], parent: THREE.Object3D) => {
      const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
      const m = shadow(new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 2.2, 8, false), cableMat));
      parent.add(m);
      this.cables.push(m);
    };
    loop([[-26, -24, b.body_height + 6], [-38, -30, sh - 14], [-26, -30, sh + 16], [-10, -24, sh + 18]], turret);
    loop([[-18, -22, g.upper_arm - 16], [-27, -28, g.upper_arm + 6], [-12, -28, g.upper_arm + 22], [8, -22, g.upper_arm + 18]], upper);
    loop([[g.forearm - 42, -16, g.forearm_offset + 8], [g.forearm - 26, -24, g.forearm_offset - 12], [g.forearm - 10, -20, g.forearm_offset - 4]], fore);

    this.tcpMarker = new THREE.Mesh(new THREE.SphereGeometry(2.4, 16, 12), new THREE.MeshBasicMaterial({ color: 0xff2d55, depthTest: false }));
    this.tcpMarker.renderOrder = 10;
    this.root.add(this.tcpMarker);
    this.magnetFace = (this.magnetTool.userData.face as THREE.MeshStandardMaterial);
    this.applySettings(settings);
  }

  private buildMagnet(dark: THREE.Material, black: THREE.Material): void {
    const L = this.g.magnet_length;
    const t = this.magnetTool;
    t.add(rbox(L - 4, 31, 31, dark, (L - 4) / 2, 0, 0, 4));
    // vertical seam + two grip dimples like the render
    t.add(rbox(L - 6, 31.6, 1.2, std(0x45494e, 0.6), (L - 4) / 2, 0, 0, 0.5));
    for (const x of [L * 0.3, L * 0.72]) {
      const d = cyl(3.2, 2, "y", black, null, 16);
      d.position.set(x, 15.6, 7);
      t.add(d);
    }
    const face = std(0x2a2c30, 0.3, 0.6, { emissive: 0x000000 });
    t.add(cyl(10, 4, "x", face, L - 4));
    t.userData.face = face;
    // cable from the magnet to the wrist
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(L * 0.55, 15.5, -4), new THREE.Vector3(L * 0.2, 22, -10), new THREE.Vector3(-6, 20, -14), new THREE.Vector3(-18, 16, -12)]);
    t.add(shadow(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 1.3, 6, false), std(0x111214, 0.6))));
  }

  /** Pen Holder Tool: dark bracket under the wrist + C-clamp holding the marker off-axis. */
  private buildPen(dark: THREE.Material): void {
    const t = this.penTool;
    const lat = this.g.pen_lateral;
    // mounting plate on the flange, running out to the clamp
    t.add(rbox(9, 30, lat + 16, dark, 4.5, 0, (lat + 16) / 2 - 12, 2.5));
    // C-clamp: two flat jaws (plates with a round cut-out) hugging the marker, like the render
    const r = this.g.marker_diameter / 2;
    const jawShape = new THREE.Shape();
    jawShape.moveTo(-12, -(r + 4));
    jawShape.lineTo(0, -(r + 4));
    jawShape.absarc(0, 0, r + 4, -Math.PI / 2, Math.PI / 2, false);
    jawShape.lineTo(-12, r + 4);
    jawShape.closePath();
    const hole = new THREE.Path();
    hole.absarc(0, 0, r + 0.4, 0, Math.PI * 2, true);
    jawShape.holes.push(hole);
    const jawGeo = new THREE.ExtrudeGeometry(jawShape, { depth: 4.5, bevelEnabled: true, bevelThickness: 0.6, bevelSize: 0.6, bevelSegments: 2 });
    for (const x of [-1, 14]) {
      const jaw = new THREE.Mesh(jawGeo, dark);
      // shape x -> tool z (towards the base plate), shape y -> tool y, extrusion -> tool x
      jaw.rotation.set(0, Math.PI / 2, 0);
      jaw.rotateZ(Math.PI / 2);
      jaw.position.set(x, 0, lat);
      t.add(shadow(jaw));
    }
    t.add(rbox(16, 6, 6, dark, 8, 0, lat - 11, 1.5)); // spine joining the jaws
    t.add(this.marker);
  }

  /** Rebuild the marker so its tip sits at the physical protrusion (tool-frame x). */
  private buildMarker(protrusion: number): void {
    const m = this.marker;
    m.clear();
    const lat = this.g.pen_lateral;
    const r = this.g.marker_diameter / 2;
    const L = this.g.marker_length;
    const white = std(0xf6f6f6, 0.35);
    const black = std(0x151617, 0.45);
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 3.2, 7, 4), black); // chisel felt
    tip.rotation.z = -Math.PI / 2;
    tip.position.set(protrusion - 3.5, 0, lat);
    m.add(shadow(tip));
    const collar = cyl(4.6, 3, "x", std(0xd9dcdf, 0.4), protrusion - 10);
    collar.position.z = lat;
    m.add(collar);
    const bodyStart = protrusion - 10;
    const body = cyl(r, L - 28, "x", white, bodyStart - (L - 28));
    body.position.z = lat;
    m.add(body);
    const neck = cyl(r * 0.75, 6, "x", white, bodyStart - 3, 24, r); // tapered front
    neck.position.z = lat;
    m.add(neck);
    const cap = cyl(r * 1.05, 26, "x", black, bodyStart - (L - 28) - 24, 32, r * 0.85);
    cap.position.z = lat;
    m.add(cap);
  }

  applySettings(s: SimSettings): void {
    this.shell.color.set(s.armColor);
    this.tcpMarker.visible = s.tcpMarker;
    for (const c of this.cables) c.visible = s.cables;
  }

  private lastProtrusion = NaN;

  update(s: ArmSnapshot): void {
    s.frames.forEach((f, i) => {
      const l = this.links[i];
      l.position.set(f.p[0], f.p[1], f.p[2]);
      l.quaternion.set(f.q[0], f.q[1], f.q[2], f.q[3]);
    });
    this.magnetTool.visible = s.mounted_tool === "magnet";
    this.penTool.visible = s.mounted_tool === "pen";
    if (s.marker_protrusion !== this.lastProtrusion) {
      this.lastProtrusion = s.marker_protrusion;
      this.buildMarker(s.marker_protrusion);
    }
    this.magnetFace.emissive.setHex(s.magnet ? 0x8a1c1c : 0x000000);
    this.tcpMarker.position.set(s.tcp[0], s.tcp[1], s.tcp[2]);
  }
}
