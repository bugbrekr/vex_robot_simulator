import * as THREE from "three";

/** Fading polyline of recent tool-tip positions (simulator setting). */
export class Trail {
  readonly line: THREE.Line;
  private pts: THREE.Vector3[] = [];
  private max = 600;

  constructor() {
    this.line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xff6a00, transparent: true, opacity: 0.8 }));
    this.line.frustumCulled = false;
  }

  push(p: [number, number, number]): void {
    const v = new THREE.Vector3(...p);
    const last = this.pts[this.pts.length - 1];
    if (last && last.distanceTo(v) < 0.8) return;
    this.pts.push(v);
    if (this.pts.length > this.max) this.pts.shift();
    this.line.geometry.dispose();
    this.line.geometry = new THREE.BufferGeometry().setFromPoints(this.pts);
  }

  clear(): void {
    this.pts = [];
    this.line.geometry.dispose();
    this.line.geometry = new THREE.BufferGeometry();
  }
}
