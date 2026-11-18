import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { ObjectSnapshot } from "../net/protocol";
import { tagRows } from "./apriltags";

const FACE_INDEX: Record<string, number> = { "+x": 0, "-x": 1, "+y": 2, "-y": 3, "+z": 4, "-z": 5 };

/** AprilTag face in the cube's colour + white ("blue-white" tags on the kit cubes). */
function tagTexture(id: number, color: string): THREE.Texture {
  const rows = tagRows(id);
  const cells = 10; // 8x8 tag incl. coloured border + 1-cell white quiet zone
  const px = 24;
  const c = document.createElement("canvas");
  c.width = c.height = cells * px;
  const g = c.getContext("2d")!;
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = "#ffffff";
  g.fillRect(px * 0.5, px * 0.5, c.width - px, c.height - px);
  rows?.forEach((row, r) => {
    [...row].forEach((bit, col) => {
      g.fillStyle = bit === "1" ? "#ffffff" : color;
      g.fillRect((col + 1) * px, (r + 1) * px, px, px);
    });
  });
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface CubeEntry { mesh: THREE.Mesh; key: string; }

/** Cubes rendered from frame snapshots: created / removed as objects come and go. */
export class ObjectsView {
  readonly root = new THREE.Group();
  private entries = new Map<string, CubeEntry>();
  private colorOverride: string | null = null;

  setColor(color: string | null): void {
    this.colorOverride = color;
    for (const [id, e] of this.entries) { this.root.remove(e.mesh); this.entries.delete(id); }
  }

  get meshes(): THREE.Mesh[] {
    return [...this.entries.values()].map((e) => e.mesh);
  }

  private create(o: ObjectSnapshot): THREE.Mesh {
    const color = this.colorOverride ?? o.color;
    const body = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.05 });
    const mats: THREE.Material[] = Array.from({ length: 6 }, () => body);
    mats[FACE_INDEX[o.tag_face] ?? 4] = new THREE.MeshStandardMaterial({ map: tagTexture(o.tag_id, color), roughness: 0.55 });
    const geo = new RoundedBoxGeometry(o.size, o.size, o.size, 4, 2.0);
    // RoundedBoxGeometry has no per-face groups: add them so the tag face gets its own material
    addBoxGroups(geo);
    const m = new THREE.Mesh(geo, mats);
    m.castShadow = m.receiveShadow = true;
    m.userData.objectId = o.id;
    return m;
  }

  update(objs: ObjectSnapshot[]): void {
    const seen = new Set<string>();
    for (const o of objs) {
      seen.add(o.id);
      const key = `${o.tag_id}|${o.size}|${o.tag_face}|${this.colorOverride ?? o.color}`;
      let e = this.entries.get(o.id);
      if (!e || e.key !== key) {
        if (e) this.root.remove(e.mesh);
        e = { mesh: this.create(o), key };
        this.entries.set(o.id, e);
        this.root.add(e.mesh);
      }
      e.mesh.position.set(o.pos[0], o.pos[1], o.pos[2]);
      e.mesh.quaternion.set(o.quat[0], o.quat[1], o.quat[2], o.quat[3]);
    }
    for (const [id, e] of this.entries) {
      if (!seen.has(id)) { this.root.remove(e.mesh); this.entries.delete(id); }
    }
  }
}

/** Assign triangle groups by dominant normal so a 6-material array works on rounded boxes. */
function addBoxGroups(geo: THREE.BufferGeometry): void {
  const idx = geo.index;
  const nrm = geo.getAttribute("normal");
  const tri = idx ? idx.count / 3 : nrm.count / 3;
  const faceOf = (i: number) => {
    const a = idx ? idx.getX(i * 3) : i * 3, b = idx ? idx.getX(i * 3 + 1) : i * 3 + 1, c = idx ? idx.getX(i * 3 + 2) : i * 3 + 2;
    const nx = nrm.getX(a) + nrm.getX(b) + nrm.getX(c), ny = nrm.getY(a) + nrm.getY(b) + nrm.getY(c), nz = nrm.getZ(a) + nrm.getZ(b) + nrm.getZ(c);
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    if (ax >= ay && ax >= az) return nx > 0 ? 0 : 1;
    if (ay >= az) return ny > 0 ? 2 : 3;
    return nz > 0 ? 4 : 5;
  };
  // reorder triangles by face so each group is contiguous
  const buckets: number[][] = [[], [], [], [], [], []];
  for (let i = 0; i < tri; i++) {
    const f = faceOf(i);
    for (let k = 0; k < 3; k++) buckets[f].push(idx ? idx.getX(i * 3 + k) : i * 3 + k);
  }
  const all: number[] = [];
  geo.clearGroups();
  buckets.forEach((b, f) => { geo.addGroup(all.length, b.length, f); all.push(...b); });
  geo.setIndex(all);
}
