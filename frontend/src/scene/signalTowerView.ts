import * as THREE from "three";
import type { TowerDesc, TowerSnapshot } from "../net/protocol";

const BASE = 28; // mm, top of the base housing

export const LED_HEX: Record<string, number> = {
  red: 0xff2a2a, yellow: 0xffd21f, green: 0x22dd55, blue: 0x2a7bff, white: 0xffffff,
};

/** 3D Signal Tower: post + 5 stacked LED segments (red on top) + bumper cap. */
export class SignalTowerView {
  readonly root = new THREE.Group();
  readonly bumper: THREE.Mesh;
  private segs = new Map<string, THREE.Mesh>();

  constructor(desc: TowerDesc) {
    this.root.position.set(desc.position[0], desc.position[1], 0);
    // dark base housing sits straight on the tile (like the kit tower), lens stack on top
    const housing = new THREE.MeshStandardMaterial({ color: 0x4a4e54, roughness: 0.55, metalness: 0.15 });
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(21, 23, 14, 40), housing);
    foot.rotation.x = Math.PI / 2;
    foot.position.z = 7;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(17, 18.5, 14, 40), housing);
    body.rotation.x = Math.PI / 2;
    body.position.z = 21;
    foot.castShadow = body.castShadow = true;
    this.root.add(foot, body);
    const order = [...desc.colors].reverse(); // white at bottom ... red on top
    const h = 16;
    const collar = new THREE.MeshStandardMaterial({ color: 0x3a3e43, roughness: 0.5, metalness: 0.3 });
    order.forEach((c, i) => {
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(15, 15, h - 2.2, 36, 1, true),
        new THREE.MeshPhysicalMaterial({ color: LED_HEX[c], transparent: true, opacity: 0.6, roughness: 0.25, transmission: 0.2, thickness: 2 }),
      );
      m.rotation.x = Math.PI / 2;
      m.position.z = BASE + i * h + h / 2;
      m.castShadow = true;
      this.segs.set(c, m);
      this.root.add(m);
      for (let k = 0; k < 3; k++) { // lens ribs
        const rib = new THREE.Mesh(new THREE.TorusGeometry(15.1, 0.5, 6, 36), m.material);
        rib.position.z = BASE + i * h + 3.5 + k * 4.5;
        this.root.add(rib);
      }
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(15.6, 15.6, 2.2, 36), collar);
      ring.rotation.x = Math.PI / 2;
      ring.position.z = BASE + i * h;
      this.root.add(ring);
    });
    this.bumper = new THREE.Mesh(new THREE.CylinderGeometry(13, 15, 8, 32), new THREE.MeshStandardMaterial({ color: 0xd8262b, roughness: 0.4 }));
    this.bumper.rotation.x = Math.PI / 2;
    this.bumper.position.z = BASE + order.length * h + 4;
    this.root.add(this.bumper);
  }

  update(s: TowerSnapshot): void {
    for (const [c, m] of this.segs) {
      const on = s.lit[c];
      const mm = m.material as THREE.MeshStandardMaterial;
      mm.emissive.setHex(on ? LED_HEX[c] : 0x000000);
      mm.emissiveIntensity = on ? 1.2 : 0;
      mm.opacity = on ? 0.95 : 0.4;
    }
    this.bumper.position.z = BASE + 5 * 16 + (s.bumper ? 2 : 4);
  }
}
