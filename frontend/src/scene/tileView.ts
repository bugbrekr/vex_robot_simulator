import * as THREE from "three";
import type { Scene } from "../net/protocol";
import type { SimSettings } from "./settings";
import { noiseTexture } from "./textures";

const CHAMFER = 22; // mm, corner chamfer of the CTE Tile frame
const BORDER = 16.5; // mm, frame border around the 6x6 grid

/** CTE Tile: light-grey plastic, chamfered frame, mounting-hole clusters, optional overlays. */
export function buildTile(scene: Scene, s: SimSettings): THREE.Group {
  const g = new THREE.Group();
  const t = scene.tile;
  const [xmin, xmax, ymin, ymax] = t.bounds;
  const W = xmax - xmin;
  const cx = (xmin + xmax) / 2, cy = (ymin + ymax) / 2;

  // ---------------------------------------------------------------- top texture
  const px = 1536;
  const k = px / W;
  const c = document.createElement("canvas");
  c.width = c.height = px;
  const ctx = c.getContext("2d")!;
  const P = (x: number, y: number): [number, number] => [(x - xmin) * k, (ymax - y) * k];
  // light-grey plastic with a very subtle vignette
  const grd = ctx.createRadialGradient(px / 2, px / 2, px * 0.1, px / 2, px / 2, px * 0.75);
  grd.addColorStop(0, "#d9dbdd");
  grd.addColorStop(1, "#cdd0d3");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, px, px);
  // frame band (separate interlocking frame pieces around the tile)
  const B = BORDER * k;
  ctx.fillStyle = "rgba(0,0,0,0.035)";
  ctx.fillRect(0, 0, px, B); ctx.fillRect(0, px - B, px, B); ctx.fillRect(0, 0, B, px); ctx.fillRect(px - B, 0, B, px);
  ctx.strokeStyle = "rgba(60,66,72,0.55)";
  ctx.lineWidth = 1.6;
  ctx.strokeRect(B, B, px - 2 * B, px - 2 * B);
  // jigsaw seams joining the frame pieces: one knob in the middle of each side, and the
  // separate corner clip pieces cut off ~45 mm from each corner
  const seam = (along: number, side: 0 | 1 | 2 | 3, knob: boolean) => {
    ctx.save();
    ctx.translate(px / 2, px / 2);
    ctx.rotate((side * Math.PI) / 2);
    ctx.translate(-px / 2, -px / 2);
    const x = along;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    if (knob) {
      const r = B * 0.26;
      ctx.lineTo(x, B * 0.22);
      ctx.bezierCurveTo(x - r * 1.6, B * 0.18, x - r * 1.6, B * 0.82, x, B * 0.78);
      ctx.lineTo(x, B);
    } else {
      ctx.lineTo(x, B);
    }
    ctx.stroke();
    ctx.restore();
  };
  for (const side of [0, 1, 2, 3] as const) {
    seam(px / 2, side, true);
    seam((CHAMFER + 26) * k, side, false);
    seam(px - (CHAMFER + 26) * k, side, false);
  }
  const cell = t.cell;
  const locs = Object.entries(t.locations);
  if (s.tileHoles) {
    // mounting holes: 2x2 clusters (12.5 mm apart) at every cell corner, plus pairs in the frame
    const holes = new Set<string>();
    for (const [, [x, y]] of locs) {
      for (const hx of [x - cell / 2, x + cell / 2]) for (const hy of [y - cell / 2, y + cell / 2]) {
        for (const [dx, dy] of [[-6.25, -6.25], [6.25, -6.25], [-6.25, 6.25], [6.25, 6.25]]) holes.add(`${hx + dx},${hy + dy}`);
      }
    }
    for (const h of holes) {
      const [x, y] = h.split(",").map(Number);
      const [u, v] = P(x, y);
      ctx.fillStyle = "#26292c";
      ctx.beginPath(); ctx.arc(u, v, 2.05 * k, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(u, v, 2.3 * k, Math.PI * 0.1, Math.PI * 0.9); ctx.stroke(); // lit lower lip
    }
  }
  if (s.tileGrid) {
    // Dotted cell borders like the real tile: one short dotted line per cell edge, running
    // between the hole clusters at its two corners (not a continuous grid).
    ctx.fillStyle = "rgba(38,42,46,0.85)";
    const edges = new Set<string>();
    for (const [, [x, y]] of locs) {
      const x0 = x - cell / 2, x1 = x + cell / 2, y0 = y - cell / 2, y1 = y + cell / 2;
      edges.add(`${x0},${y0},${x1},${y0}`); edges.add(`${x0},${y1},${x1},${y1}`);
      edges.add(`${x0},${y0},${x0},${y1}`); edges.add(`${x1},${y0},${x1},${y1}`);
    }
    const gap = 12.5; // keep clear of the 2x2 hole clusters at the corners
    for (const e of edges) {
      const [ax, ay, bx, by] = e.split(",").map(Number);
      const len = Math.hypot(bx - ax, by - ay);
      const n = 9;
      for (let i = 0; i < n; i++) {
        const tt = (gap + ((len - 2 * gap) * i) / (n - 1)) / len;
        const [u, v] = P(ax + (bx - ax) * tt, ay + (by - ay) * tt);
        ctx.beginPath(); ctx.arc(u, v, 0.75 * k, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  if (s.tileNumbers) {
    ctx.fillStyle = "rgba(60,70,82,0.72)";
    ctx.font = `600 ${Math.round(12 * k)}px "Open Sans", system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const [n, [x, y]] of locs) {
      const [u, v] = P(x, y);
      ctx.save();
      ctx.translate(u, v);
      ctx.rotate(-Math.PI / 2); // numbers read with +X pointing "down" the tile, like the real one
      ctx.fillText(n, 0, 0);
      ctx.restore();
    }
  }
  const topTex = new THREE.CanvasTexture(c);
  topTex.colorSpace = THREE.SRGBColorSpace;
  topTex.anisotropy = 8;
  topTex.repeat.set(1 / W, 1 / W);
  topTex.offset.set(-xmin / W, -ymin / W);

  // ---------------------------------------------------------------- geometry
  const chamfered = (x0: number, x1: number, y0: number, y1: number, ch: number) => {
    const sh = new THREE.Shape();
    sh.moveTo(x0 + ch, y0); sh.lineTo(x1 - ch, y0); sh.lineTo(x1, y0 + ch); sh.lineTo(x1, y1 - ch);
    sh.lineTo(x1 - ch, y1); sh.lineTo(x0 + ch, y1); sh.lineTo(x0, y1 - ch); sh.lineTo(x0, y0 + ch);
    sh.closePath();
    return sh;
  };
  const rough = noiseTexture(5, 8);
  const topMat = new THREE.MeshStandardMaterial({ map: topTex, roughness: 0.72, roughnessMap: rough, metalness: 0 });
  const sideMat = new THREE.MeshStandardMaterial({ color: 0xd3d5d8, roughness: 0.7, metalness: 0 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x9da2a7, roughness: 0.85, metalness: 0 });
  const SLAB = 11; // thickness of the top deck; the rest of the 28 mm is feet / clips
  const slab = new THREE.Mesh(
    new THREE.ExtrudeGeometry(chamfered(xmin, xmax, ymin, ymax, CHAMFER), { depth: SLAB, bevelEnabled: true, bevelThickness: 1, bevelSize: 1, bevelSegments: 2 }),
    [topMat, sideMat],
  );
  slab.geometry.translate(0, 0, -SLAB - 1);
  slab.castShadow = slab.receiveShadow = true;
  g.add(slab);
  // recessed inner skirt under the deck (shadowed step behind the feet)
  const inner = new THREE.Mesh(
    new THREE.ExtrudeGeometry(chamfered(xmin + 7, xmax - 7, ymin + 7, ymax - 7, CHAMFER - 3), { depth: t.height - SLAB - 1, bevelEnabled: false }),
    darkMat,
  );
  inner.geometry.translate(0, 0, -t.height);
  inner.receiveShadow = true;
  g.add(inner);
  // feet: corner clip pieces + a clip in the middle of every side (lets tiles lock together)
  const footH = t.height - SLAB - 1;
  const addFoot = (shape: THREE.Shape) => {
    const m = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: footH, bevelEnabled: true, bevelThickness: 0.6, bevelSize: 0.6, bevelSegments: 1 }), sideMat);
    m.geometry.translate(0, 0, -t.height + 0.6);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  };
  const L = CHAMFER + 24; // corner clip length along each side
  for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const ox = sx > 0 ? xmax : xmin, oy = sy > 0 ? ymax : ymin;
    const sh = new THREE.Shape();
    sh.moveTo(ox - sx * L, oy);
    sh.lineTo(ox - sx * CHAMFER, oy);
    sh.lineTo(ox, oy - sy * CHAMFER);
    sh.lineTo(ox, oy - sy * L);
    sh.lineTo(ox - sx * BORDER, oy - sy * L);
    sh.lineTo(ox - sx * BORDER, oy - sy * BORDER);
    sh.lineTo(ox - sx * L, oy - sy * BORDER);
    sh.closePath();
    addFoot(sh);
  }
  const F = 34; // mid-side clip width
  for (const [x0, x1, y0, y1] of [
    [cx - F / 2, cx + F / 2, ymin, ymin + BORDER], [cx - F / 2, cx + F / 2, ymax - BORDER, ymax],
    [xmin, xmin + BORDER, cy - F / 2, cy + F / 2], [xmax - BORDER, xmax, cy - F / 2, cy + F / 2],
  ]) {
    const sh = new THREE.Shape();
    sh.moveTo(x0, y0); sh.lineTo(x1, y0); sh.lineTo(x1, y1); sh.lineTo(x0, y1); sh.closePath();
    addFoot(sh);
  }
  return g;
}

/** Dry-Erase Surface: glossy white sheet on the Tile (cut around the arm base and tower). */
export function buildWhiteboard(outline: [number, number][], screws: [number, number][]): THREE.Group {
  const g = new THREE.Group();
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  const sheet = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, { depth: 0.6, bevelEnabled: false }),
    new THREE.MeshPhysicalMaterial({ color: 0xfcfcfc, roughness: 0.18, clearcoat: 0.6, clearcoatRoughness: 0.15 }),
  );
  sheet.receiveShadow = true;
  g.add(sheet);
  const edge = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(outline.map(([x, y]) => new THREE.Vector3(x, y, 0.62))),
    new THREE.LineBasicMaterial({ color: 0xc3c8cd }),
  );
  g.add(edge);
  const screwMat = new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.4, metalness: 0.6 });
  for (const [x, y] of screws) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 1.4, 20), screwMat);
    s.rotation.x = Math.PI / 2;
    s.position.set(x, y, 1.0);
    g.add(s);
  }
  return g;
}
