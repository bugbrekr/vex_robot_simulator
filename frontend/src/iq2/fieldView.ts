import * as THREE from "three";
import type { IQ2FieldDesc } from "../net/protocol";
import { LIGHTING, QUALITY, display } from "./display";
import { std } from "./parts";

/** White foam mat with tape lines (drawn into one canvas texture) and the fixed obstacles. */
export function buildField(f: IQ2FieldDesc): THREE.Group {
  const root = new THREE.Group();
  const [w, h] = f.floor.size;
  const q = QUALITY[display.value.quality];
  // ground around the mat
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(w + 6000, h + 6000), new THREE.MeshStandardMaterial({ color: LIGHTING[display.value.lighting].ground, roughness: 0.95 }));
  ground.position.z = -3;
  ground.receiveShadow = true;
  root.add(ground);

  const px = 0.5 * q.texture; // texture pixels per mm
  const c = document.createElement("canvas");
  c.width = Math.round(w * px);
  c.height = Math.round(h * px);
  const g = c.getContext("2d")!;
  g.fillStyle = f.floor.color;
  g.fillRect(0, 0, c.width, c.height);
  // foam texture: fine speckle, then 1 ft tile seams
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < c.width * c.height * 0.02; i++) {
    const v = rnd() < 0.5 ? 0 : 255;
    g.fillStyle = `rgba(${v},${v},${v},${0.025 + rnd() * 0.03})`;
    g.fillRect(rnd() * c.width, rnd() * c.height, 1.5 * q.texture, 1.5 * q.texture);
  }
  g.strokeStyle = "rgba(0,0,0,0.07)";
  g.lineWidth = 1.2 * q.texture;
  for (let x = -w / 2; x <= w / 2; x += 304.8) { g.beginPath(); g.moveTo((x + w / 2) * px, 0); g.lineTo((x + w / 2) * px, c.height); g.stroke(); }
  for (let y = -h / 2; y <= h / 2; y += 304.8) { g.beginPath(); g.moveTo(0, (h / 2 - y) * px); g.lineTo(c.width, (h / 2 - y) * px); g.stroke(); }
  const tx = (x: number) => (x + w / 2) * px;
  const ty = (y: number) => (h / 2 - y) * px;
  for (const ln of f.lines) {
    g.strokeStyle = ln.color;
    g.lineWidth = ln.width * px;
    g.lineCap = "butt";
    g.lineJoin = "miter";
    g.beginPath();
    ln.points.forEach(([x, y], i) => (i ? g.lineTo(tx(x), ty(y)) : g.moveTo(tx(x), ty(y))));
    if (ln.closed) g.closePath();
    g.stroke();
  }
  g.fillStyle = "rgba(40,60,90,0.55)";
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (const l of f.labels) {
    g.font = `700 ${Math.round(40 * px)}px Open Sans, sans-serif`;
    g.fillText(l.text, tx(l.at[0]), ty(l.at[1]));
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const mat = new THREE.Mesh(new THREE.BoxGeometry(w, h, 3), [
    ...Array(4).fill(new THREE.MeshStandardMaterial({ color: 0xdadad6, roughness: 0.9 })),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }),
    new THREE.MeshStandardMaterial({ color: 0xdadad6 }),
  ]);
  mat.position.z = -1.5;
  mat.receiveShadow = true;
  root.add(mat);

  for (const o of f.obstacles) {
    const m = std(new THREE.Color(o.color).getHex(), o.id.startsWith("wall_") ? 0.75 : 0.55);
    const mesh = o.shape === "cylinder"
      ? new THREE.Mesh(new THREE.CylinderGeometry(o.radius!, o.radius!, o.height, 40), m)
      : new THREE.Mesh(new THREE.BoxGeometry(o.size![0], o.size![1], o.height), m);
    if (o.shape === "cylinder") mesh.rotation.x = Math.PI / 2;
    else mesh.rotation.z = THREE.MathUtils.degToRad(o.yaw);
    mesh.position.set(o.center[0], o.center[1], o.height / 2);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.obstacle = o.id;
    root.add(mesh);
  }
  return root;
}
