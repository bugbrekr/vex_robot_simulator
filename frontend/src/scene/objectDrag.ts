import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { ClientMsg } from "../net/protocol";
import type { ObjectsView } from "./objectsView";
import type { Viewport } from "./viewport";

const LIFT = 18; // mm a dragged cube floats above whatever is under it

/**
 * Cube manipulation in the 3D view (works any time, even while a project runs):
 *  - drag a cube to move it (drops onto the tile or stacks on another cube)
 *  - drag it off the tile / out of the view to delete it
 *  - drag a new cube in from the Simulation panel's object tray
 */
export class ObjectDrag {
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private floor = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private active: { id: string | null; mesh: THREE.Object3D; offset: THREE.Vector3 } | null = null;
  private pending: THREE.Vector3 | null = null;
  private ghost: THREE.Mesh;
  private badge: HTMLDivElement;
  bounds: [number, number, number, number] = [-91.5, 241.5, -91.5, 241.5];
  /** Other grabbable things (e.g. the arm in Manual Mode) that win if they are closer. */
  competing: () => THREE.Object3D[] = () => [];
  enabled = true;

  constructor(private vp: Viewport, private objects: () => ObjectsView | null, private send: (m: ClientMsg) => void) {
    this.ghost = new THREE.Mesh(
      new RoundedBoxGeometry(25, 25, 25, 4, 2.0),
      new THREE.MeshStandardMaterial({ color: 0x1f5fd6, transparent: true, opacity: 0.6 }),
    );
    this.ghost.visible = false;
    vp.scene.add(this.ghost);
    this.badge = document.createElement("div");
    this.badge.className = "drag-badge";
    this.badge.hidden = true;
    document.body.appendChild(this.badge);

    const el = vp.renderer.domElement;
    el.addEventListener("pointerdown", (e) => this.down(e), true);
    el.addEventListener("pointermove", (e) => this.hover(e));
    window.addEventListener("pointermove", (e) => this.move(e));
    window.addEventListener("pointerup", (e) => this.up(e));
    vp.onTick(() => {
      if (this.active?.id && this.pending) {
        const p = this.pending;
        this.send({ type: "move_object", id: this.active.id, pos: [p.x, p.y, p.z] });
        this.pending = null;
      }
    });
  }

  setGhostColor(c: string): void {
    (this.ghost.material as THREE.MeshStandardMaterial).color.set(c);
  }

  private setNdc(e: PointerEvent): boolean {
    const r = this.vp.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.vp.camera);
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  }

  private floorPoint(): THREE.Vector3 | null {
    return this.ray.ray.intersectPlane(this.floor, new THREE.Vector3());
  }

  private onTile(x: number, y: number): boolean {
    const [x0, x1, y0, y1] = this.bounds;
    return x >= x0 && x <= x1 && y >= y0 && y <= y1;
  }

  /** Top of the highest cube under (x, y), ignoring `except`. */
  private supportAt(x: number, y: number, except: THREE.Object3D | null): number {
    let z = 0;
    for (const m of this.objects()?.meshes ?? []) {
      if (m === except) continue;
      if (Math.abs(m.position.x - x) < 25 && Math.abs(m.position.y - y) < 25) z = Math.max(z, m.position.z + 12.5);
    }
    return z;
  }

  private hover(e: PointerEvent): void {
    if (this.active || !this.enabled || e.buttons) return;
    this.setNdc(e);
    const hit = this.ray.intersectObjects(this.objects()?.meshes ?? [], false)[0];
    if (hit) this.vp.renderer.domElement.style.cursor = "grab";
    else if (this.vp.renderer.domElement.style.cursor === "grab" && !this.competing().length) this.vp.renderer.domElement.style.cursor = "";
  }

  private down(e: PointerEvent): void {
    if (!this.enabled || e.button !== 0) return;
    this.setNdc(e);
    const hit = this.ray.intersectObjects(this.objects()?.meshes ?? [], false)[0];
    if (!hit) return;
    const other = this.ray.intersectObjects(this.competing(), true)[0];
    if (other && other.distance < hit.distance) return; // let the arm drag win
    e.stopImmediatePropagation();
    e.preventDefault();
    const mesh = hit.object;
    const id = mesh.userData.objectId as string;
    const fp = this.floorPoint() ?? mesh.position.clone();
    this.active = { id, mesh, offset: new THREE.Vector3(mesh.position.x - fp.x, mesh.position.y - fp.y, 0) };
    this.vp.controls.enabled = false;
    this.send({ type: "grab_object", id });
    this.vp.renderer.domElement.style.cursor = "grabbing";
    this.move(e);
  }

  /** Start dragging a brand-new cube from the object tray (DOM pointer event). */
  beginSpawn(e: PointerEvent): void {
    this.active = { id: null, mesh: this.ghost, offset: new THREE.Vector3() };
    this.vp.controls.enabled = false;
    this.move(e);
  }

  private move(e: PointerEvent): void {
    if (!this.active) return;
    const inside = this.setNdc(e);
    const fp = inside ? this.floorPoint() : null;
    const isNew = this.active.id === null;
    if (!fp) {
      if (isNew) this.ghost.visible = false;
      this.showBadge(e, isNew ? "Drop on the tile to add" : "Release to delete", !isNew);
      return;
    }
    const x = fp.x + this.active.offset.x, y = fp.y + this.active.offset.y;
    const ok = this.onTile(x, y);
    const z = this.supportAt(x, y, this.active.mesh) + 12.5 + LIFT;
    this.active.mesh.position.set(x, y, z);
    if (isNew) this.ghost.visible = true;
    else this.pending = new THREE.Vector3(x, y, z);
    this.showBadge(e, ok ? (isNew ? "Release to add cube" : "Release to place") : (isNew ? "Drop on the tile to add" : "Release to delete"), !ok && !isNew);
  }

  private up(e: PointerEvent): void {
    if (!this.active) return;
    const a = this.active;
    this.active = null;
    this.pending = null;
    this.vp.controls.enabled = true;
    this.badge.hidden = true;
    this.vp.renderer.domElement.style.cursor = "";
    const inside = this.setNdc(e);
    const fp = inside ? this.floorPoint() : null;
    const x = fp ? fp.x + a.offset.x : 1e4, y = fp ? fp.y + a.offset.y : 1e4;
    const ok = !!fp && this.onTile(x, y);
    if (a.id === null) {
      this.ghost.visible = false;
      // released in the air: it falls onto the tile / stack
      if (ok) this.send({ type: "add_object", kind: "cube", x, y, z: Math.max(0, a.mesh.position.z - 12.5) });
      return;
    }
    this.send({ type: "drop_object", id: a.id, x, y, delete: !ok });
  }

  private showBadge(e: PointerEvent, text: string, danger: boolean): void {
    this.badge.hidden = false;
    this.badge.textContent = text;
    this.badge.classList.toggle("danger", danger);
    this.badge.style.left = `${e.clientX + 14}px`;
    this.badge.style.top = `${e.clientY + 14}px`;
  }
}
