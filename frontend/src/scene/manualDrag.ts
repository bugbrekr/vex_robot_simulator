import * as THREE from "three";
import type { Vec3 } from "../net/protocol";
import type { Viewport } from "./viewport";

/**
 * Manual Mode: the motors are powered down, so the arm can be pulled around by hand. Grab the
 * tool tip (orange handle) or any link and drag; hold Shift to lift / lower. Letting go lets the
 * arm sag again under gravity.
 */
export class ManualDrag {
  private enabled = false;
  private dragging = false;
  private plane = new THREE.Plane();
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private grabOffset = new THREE.Vector3();
  private pending: Vec3 | null = null;
  private tcp = new THREE.Vector3();
  readonly handle: THREE.Mesh;
  private ring: THREE.Mesh;
  private grabTargets: THREE.Object3D[] = [];

  constructor(private vp: Viewport, private onDrag: (p: Vec3) => void, private onEnd: () => void = () => {}) {
    this.handle = new THREE.Mesh(
      new THREE.SphereGeometry(9, 24, 16),
      new THREE.MeshStandardMaterial({ color: 0xff8a00, emissive: 0x803c00, transparent: true, opacity: 0.85 }),
    );
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(14, 17, 40),
      new THREE.MeshBasicMaterial({ color: 0xff8a00, transparent: true, opacity: 0.6, side: THREE.DoubleSide }),
    );
    this.handle.visible = this.ring.visible = false;
    vp.scene.add(this.handle, this.ring);

    const el = vp.renderer.domElement;
    el.addEventListener("pointerdown", (e) => this.down(e), true);
    el.addEventListener("pointermove", (e) => this.move(e));
    el.addEventListener("pointerup", (e) => this.up(e));
    el.addEventListener("pointercancel", (e) => this.up(e));
    vp.onTick(() => {
      if (this.pending) { this.onDrag(this.pending); this.pending = null; }
    });
  }

  setGrabTargets(objs: THREE.Object3D[]): void { this.grabTargets = objs; }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.handle.visible = this.ring.visible = on;
    if (!on && this.dragging) this.endDrag();
    this.vp.renderer.domElement.style.cursor = on ? "grab" : "";
  }

  setTcp(p: Vec3): void {
    this.tcp.set(p[0], p[1], p[2]);
    this.handle.position.copy(this.tcp);
    this.ring.position.set(p[0], p[1], 0.6);
  }

  private pick(e: PointerEvent): THREE.Intersection | null {
    const r = this.vp.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.vp.camera);
    const hits = this.ray.intersectObjects([this.handle, ...this.grabTargets], true);
    return hits[0] ?? null;
  }

  private setPlane(vertical: boolean): void {
    if (vertical) {
      const n = new THREE.Vector3().subVectors(this.vp.camera.position, this.tcp);
      n.z = 0;
      if (n.lengthSq() < 1e-6) n.set(1, 0, 0);
      this.plane.setFromNormalAndCoplanarPoint(n.normalize(), this.tcp);
    } else {
      this.plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 0, 1), this.tcp);
    }
  }

  private planePoint(e: PointerEvent): THREE.Vector3 | null {
    const r = this.vp.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.vp.camera);
    const out = new THREE.Vector3();
    return this.ray.ray.intersectPlane(this.plane, out);
  }

  private shift = false;

  private down(e: PointerEvent): void {
    if (!this.enabled || e.button !== 0 || !this.pick(e)) return;
    e.stopPropagation();
    this.dragging = true;
    this.shift = e.shiftKey;
    this.setPlane(this.shift);
    const p = this.planePoint(e);
    this.grabOffset.copy(p ? p.sub(this.tcp) : new THREE.Vector3());
    this.vp.controls.enabled = false;
    this.vp.renderer.domElement.setPointerCapture(e.pointerId);
    this.vp.renderer.domElement.style.cursor = "grabbing";
  }

  private move(e: PointerEvent): void {
    if (!this.dragging) {
      if (this.enabled) this.vp.renderer.domElement.style.cursor = this.pick(e) ? "grab" : "default";
      return;
    }
    if (e.shiftKey !== this.shift) { // switched mode mid-drag: re-anchor
      this.shift = e.shiftKey;
      this.setPlane(this.shift);
      const p0 = this.planePoint(e);
      this.grabOffset.copy(p0 ? p0.sub(this.tcp) : new THREE.Vector3());
    }
    const p = this.planePoint(e);
    if (!p) return;
    p.sub(this.grabOffset);
    const target: Vec3 = this.shift ? [this.tcp.x, this.tcp.y, Math.max(0, p.z)] : [p.x, p.y, this.tcp.z];
    this.pending = target;
  }

  private up(e: PointerEvent): void {
    if (!this.dragging) return;
    this.vp.renderer.domElement.releasePointerCapture(e.pointerId);
    this.endDrag();
  }

  private endDrag(): void {
    if (this.dragging) this.onEnd();
    this.dragging = false;
    this.vp.controls.enabled = true;
    this.vp.renderer.domElement.style.cursor = this.enabled ? "grab" : "";
  }
}
