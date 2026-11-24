import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

/** Procedural VEX IQ parts and textures (no image assets). `seg` scales geometry detail. */

export const COL = {
  beam: 0x55595f, beamEdge: 0x6a6f75, brain: 0x5a5f65, brainTop: 0x6c7177, battery: 0x2e3135,
  motor: 0x41454a, motorCap: 0x5d6268, tyre: 0x1c1c1e, hub: 0xdcdfe2, hubBlue: 0x1f6fd1,
  omniPlate: 0xe6e8ea, roller: 0x1d1d1f, connector: 0xc9ccd0, pin: 0x2f6fd6, sensor: 0x3c4045,
  lens: 0x0d0e10, plunger: 0xd5d8db, port: 0x18191b, button: 0x2b2e32, axle: 0xa6abb0,
};

export function std(color: number, roughness = 0.6, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

function tex(c: HTMLCanvasElement, rx: number, ry: number, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** One 0.5 in pitch cell of an IQ (2nd gen) beam: a round hole in a hex recess. */
function beamCell(scale: number): HTMLCanvasElement {
  const n = 64 * scale;
  const [c, g] = canvas(n, n);
  g.fillStyle = "#585c62";
  g.fillRect(0, 0, n, n);
  // hex recess
  g.fillStyle = "#44484d";
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + (i * Math.PI) / 3;
    const x = n / 2 + Math.cos(a) * n * 0.44, y = n / 2 + Math.sin(a) * n * 0.44;
    if (i) g.lineTo(x, y); else g.moveTo(x, y);
  }
  g.closePath();
  g.fill();
  // through-hole with a highlight on its lower rim
  g.fillStyle = "#1d1f22";
  g.beginPath();
  g.arc(n / 2, n / 2, n * 0.22, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "rgba(255,255,255,0.18)";
  g.lineWidth = n * 0.03;
  g.beginPath();
  g.arc(n / 2, n / 2, n * 0.24, 0.2 * Math.PI, 0.8 * Math.PI);
  g.stroke();
  // faint cell seam
  g.strokeStyle = "rgba(0,0,0,0.18)";
  g.lineWidth = 1;
  g.strokeRect(0.5, 0.5, n - 1, n - 1);
  return c;
}

const cellCache = new Map<number, HTMLCanvasElement>();

/** Beam with drilled faces: holes on the two faces you see from the side. */
export function beam(b: [number, number, number, number, number, number], pitch: number, texScale: number): THREE.Mesh {
  const [cx, cy, cz, sx, sy, sz] = b;
  if (!cellCache.has(texScale)) cellCache.set(texScale, beamCell(texScale));
  const cell = cellCache.get(texScale)!;
  const alongX = sx >= sy;
  const cells = (v: number) => Math.max(1, Math.round(v / pitch));
  const mat = (rx: number, ry: number, tint = 0xffffff) =>
    new THREE.MeshStandardMaterial({ map: tex(cell, rx, ry), roughness: 0.62, color: tint });
  const plain = std(COL.beamEdge, 0.6);
  // BoxGeometry face UVs: +-x faces run (z, y), +-y faces run (x, z), +-z faces run (x, y)
  const mats = alongX
    ? [plain, plain, mat(cells(sx), cells(sz)), mat(cells(sx), cells(sz)), mat(cells(sx), 1, 0xdddddd), plain]
    : [mat(cells(sz), cells(sy)), mat(cells(sz), cells(sy)), plain, plain, mat(1, cells(sy), 0xdddddd), plain];
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mats);
  m.position.set(cx, cy, cz);
  m.castShadow = m.receiveShadow = true;
  return m;
}

export function rbox(size: [number, number, number], mat: THREE.Material | number, pos: [number, number, number], radius = 1.5, seg = 1): THREE.Mesh {
  const r = Math.min(radius, Math.min(...size) / 2 - 0.01);
  const geo = new RoundedBoxGeometry(size[0], size[1], size[2], Math.max(1, Math.round(2 * seg)), Math.max(0.01, r));
  const m = new THREE.Mesh(geo, typeof mat === "number" ? std(mat) : mat);
  m.position.set(...pos);
  m.castShadow = m.receiveShadow = true;
  return m;
}

/** Cylinder whose axis is the robot's y axis (wheel axles). */
export function yCyl(r: number, len: number, mat: THREE.Material | number, segments = 32): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, segments), typeof mat === "number" ? std(mat) : mat);
  m.castShadow = true;
  return m;
}

/** Diamond-tread rubber for the travel tyre (u runs around the tyre). */
function treadTexture(scale: number): THREE.CanvasTexture {
  const w = 64 * scale, h = 64 * scale;
  const [c, g] = canvas(w, h);
  g.fillStyle = "#151516";
  g.fillRect(0, 0, w, h);
  g.fillStyle = "#26272a";
  const d = (x: number, y: number, s: number) => {
    g.beginPath();
    g.moveTo(x, y - s); g.lineTo(x + s, y); g.lineTo(x, y + s); g.lineTo(x - s, y);
    g.closePath();
    g.fill();
  };
  for (let iy = 0; iy < 3; iy++) {
    for (let ix = 0; ix < 2; ix++) d((ix + (iy % 2) * 0.5 + 0.25) * w / 2, (iy + 0.5) * h / 3, w * 0.17);
  }
  return tex(c, 18, 1);
}

/** Travel tyre with rounded shoulders, a grey hub with spoke windows, and a blue hex insert. */
export function travelWheel(r: number, w: number, seg: number, texScale: number): THREE.Group {
  const g = new THREE.Group();
  const n = Math.max(24, Math.round(64 * seg));
  const ri = r * 0.68, sh = Math.min(4, w * 0.2);
  const prof: THREE.Vector2[] = [];
  prof.push(new THREE.Vector2(ri, -w / 2));
  for (let i = 0; i <= 6; i++) { // rounded outer shoulder (lathe points: x = radius, y = along axle)
    const a = (Math.PI / 2) * (i / 6);
    prof.push(new THREE.Vector2(r - sh + Math.sin(a) * sh, -w / 2 + sh - Math.cos(a) * sh));
  }
  for (let i = 0; i <= 6; i++) {
    const a = (Math.PI / 2) * (i / 6);
    prof.push(new THREE.Vector2(r - sh + Math.cos(a) * sh, w / 2 - sh + Math.sin(a) * sh));
  }
  prof.push(new THREE.Vector2(ri, w / 2));
  const tyre = new THREE.Mesh(new THREE.LatheGeometry(prof, n), new THREE.MeshStandardMaterial({ map: treadTexture(texScale), roughness: 0.92 }));
  tyre.castShadow = tyre.receiveShadow = true;
  g.add(tyre);
  // hub: rim disc + spokes + blue insert
  const hubMat = std(COL.hub, 0.45);
  g.add(yCyl(ri, w * 0.55, hubMat, Math.round(n / 2)));
  const face = std(0xc4c8cc, 0.5);
  for (const sgn of [-1, 1]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(ri - 1.5, 1.4, 8, Math.round(n / 2)), hubMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = sgn * w * 0.3;
    g.add(ring);
    for (let i = 0; i < 6; i++) { // dark spoke windows make the rotation visible
      const win = new THREE.Mesh(new THREE.CircleGeometry(ri * 0.2, 12), std(0x6b7076, 0.7));
      const a = (i / 6) * Math.PI * 2;
      win.position.set(Math.cos(a) * ri * 0.6, sgn * (w * 0.275 + 0.1), Math.sin(a) * ri * 0.6);
      win.rotation.x = sgn > 0 ? -Math.PI / 2 : Math.PI / 2;
      g.add(win);
    }
    const cap = yCyl(ri * 0.36, 0.8, face, 24);
    cap.position.y = sgn * w * 0.29;
    g.add(cap);
  }
  g.add(yCyl(r * 0.2, w * 0.72, std(COL.hubBlue, 0.35), 6));
  return g;
}

/** IQ omni wheel: two light side plates, a hub, and two staggered rings of barrel rollers whose
 *  axes run along the rim (so the wheel rolls forward and slides sideways). */
export function omniWheel(r: number, w: number, n: number, seg: number): THREE.Group {
  const g = new THREE.Group();
  const plate = std(COL.omniPlate, 0.45);
  const rr = r * 0.14; // roller radius
  const len = ((2 * Math.PI * (r - rr)) / n) * 0.82;
  // barrel profile along +y, revolved
  const prof: THREE.Vector2[] = [];
  const steps = Math.max(4, Math.round(8 * seg));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = -len / 2 + t * len;
    prof.push(new THREE.Vector2(rr * (0.72 + 0.28 * Math.sin(Math.PI * t)), y));
  }
  prof.unshift(new THREE.Vector2(0.01, -len / 2));
  prof.push(new THREE.Vector2(0.01, len / 2));
  const barrel = new THREE.LatheGeometry(prof, Math.max(8, Math.round(14 * seg)));
  const rollerMat = std(COL.roller, 0.85);
  const up = new THREE.Vector3(0, 1, 0);
  for (let ring = 0; ring < 2; ring++) {
    const off = (ring ? 1 : -1) * w * 0.2;
    for (let i = 0; i < n; i++) {
      const a = ((i + ring * 0.5) / n) * Math.PI * 2;
      const roller = new THREE.Mesh(barrel, rollerMat);
      roller.position.set(Math.cos(a) * (r - rr), off, Math.sin(a) * (r - rr));
      roller.quaternion.setFromUnitVectors(up, new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)));
      roller.castShadow = true;
      g.add(roller);
      // little axle pin through each roller
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, len + 2, 6), std(COL.axle, 0.4, 0.3));
      pin.position.copy(roller.position);
      pin.quaternion.copy(roller.quaternion);
      g.add(pin);
    }
  }
  // side plates (smaller than the rollers' reach) and a centre web
  const segs = Math.max(16, Math.round(40 * seg));
  for (const s of [-1, 1]) {
    const p = yCyl(r * 0.66, 1.8, plate, segs);
    p.position.y = s * w * 0.42;
    g.add(p);
  }
  g.add(yCyl(r * 0.74, 1.6, plate, segs));
  g.add(yCyl(r * 0.36, w * 0.9, std(0xd2d5d8, 0.45), segs));
  g.add(yCyl(r * 0.2, w * 0.95, std(COL.hubBlue, 0.35), 6));
  for (let i = 0; i < 5; i++) { // spoke windows on the outer plates
    const a = (i / 5) * Math.PI * 2;
    for (const s of [-1, 1]) {
      const win = new THREE.Mesh(new THREE.CircleGeometry(r * 0.1, 10), std(0x8d9298, 0.7));
      win.position.set(Math.cos(a) * r * 0.48, s * (w * 0.42 + 0.95), Math.sin(a) * r * 0.48);
      win.rotation.x = s > 0 ? -Math.PI / 2 : Math.PI / 2;
      g.add(win);
    }
  }
  return g;
}

/** A soft dark blob that grounds the robot (cheap contact shadow). */
export function contactShadow(length: number, width: number): THREE.Mesh {
  const [c, g] = canvas(128, 128);
  const grd = g.createRadialGradient(64, 64, 10, 64, 64, 64);
  grd.addColorStop(0, "rgba(0,0,0,0.55)");
  grd.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(length, width), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
  m.position.z = 0.6;
  m.renderOrder = 1;
  return m;
}
