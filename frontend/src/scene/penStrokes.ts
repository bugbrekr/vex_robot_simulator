import * as THREE from "three";

const WIDTH = 2.5; // mm, dry-erase marker line width
const Z = 0.9; // just above the tile / whiteboard surface

/** Marker strokes drawn on the dry-erase surface, rendered as flat ribbons. */
export class PenStrokes {
  readonly root = new THREE.Group();
  private strokes: [number, number][][] = [];
  private meshes: THREE.Mesh[] = [];
  private material = new THREE.MeshBasicMaterial({ color: 0x1033aa, side: THREE.DoubleSide });

  reset(initial: [number, number][][] = []): void {
    for (const m of this.meshes) { this.root.remove(m); m.geometry.dispose(); }
    this.meshes = [];
    this.strokes = [];
    initial.forEach((s, i) => s.forEach((p) => this.add(i, p)));
  }

  add(stroke: number, p: [number, number]): void {
    if (stroke < 0) { this.reset(); return; } // board erased
    while (this.strokes.length <= stroke) {
      this.strokes.push([]);
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
      this.meshes.push(mesh);
      this.root.add(mesh);
    }
    this.strokes[stroke].push(p);
    const mesh = this.meshes[stroke];
    mesh.geometry.dispose();
    mesh.geometry = ribbon(this.strokes[stroke]);
  }
}

/** Quad per segment plus a small square at every vertex (round-ish joins, dots for taps). */
function ribbon(pts: [number, number][]): THREE.BufferGeometry {
  const pos: number[] = [];
  const h = WIDTH / 2;
  const quad = (a: number[], b: number[], c: number[], d: number[]) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (const [x, y] of pts) quad([x - h, y - h, Z], [x + h, y - h, Z], [x + h, y + h, Z], [x - h, y + h, Z]);
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    const len = Math.hypot(x1 - x0, y1 - y0) || 1;
    const nx = (-(y1 - y0) / len) * h, ny = ((x1 - x0) / len) * h;
    quad([x0 + nx, y0 + ny, Z], [x1 + nx, y1 + ny, Z], [x1 - nx, y1 - ny, Z], [x0 - nx, y0 - ny, Z]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return g;
}
