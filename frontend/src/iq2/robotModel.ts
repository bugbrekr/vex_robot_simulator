import * as THREE from "three";
import type { IQ2Config, IQ2Device, IQ2Geometry, IQ2RobotSnapshot } from "../net/protocol";
import { QUALITY, type Quality, display } from "./display";
import { COL, beam, contactShadow, omniWheel, rbox, std, travelWheel, yCyl } from "./parts";
import { DEVICES } from "./store";

export interface PartInfo { device?: IQ2Device; part: string }

/**
 * The BaseBot-style robot in its own frame (+x forward, +y left, +z up, origin = centre of the
 * drive axle on the floor). `root` is placed at the robot pose.
 */
export class RobotModel {
  readonly root = new THREE.Group();
  readonly devices = {} as Record<IQ2Device, THREE.Group>;
  /** meshes the user can click: Touch LED, bumper, and the chassis (to drag the robot) */
  readonly pick = { touchled: [] as THREE.Object3D[], bumper: [] as THREE.Object3D[], chassis: [] as THREE.Object3D[] };
  private wheels: Record<"left_motor" | "right_motor", THREE.Group> = {} as never;
  private omnis: THREE.Group[] = [];
  private ledMat: THREE.MeshPhysicalMaterial;
  private plunger!: THREE.Mesh;
  private plungerX = 0;
  private screenTex: THREE.CanvasTexture;
  private optGlow: THREE.MeshStandardMaterial;
  private labels = new THREE.Group();

  constructor(readonly g: IQ2Geometry, screen: HTMLCanvasElement, quality: Quality = display.value.quality) {
    const q = QUALITY[quality];
    const seg = q.segments;
    const p = g.pitch;
    const r = g.drive.wheel_travel / (2 * Math.PI);
    const halfTrack = g.drive.track_width / 2;
    const body = new THREE.Group();
    this.root.add(body);
    if (q.contactShadow) {
      const f = g.footprint;
      const cs = contactShadow((f.front - f.rear) * 1.25, f.half_width * 2.5);
      cs.position.x = (f.front + f.rear) / 2;
      this.root.add(cs);
    }

    // chassis: drilled side rails, front/rear crossbars, and two plates under the battery
    for (const b of g.rails) body.add(beam(b, p, q.texture));
    for (const b of g.crossbars) body.add(beam(b, p, q.texture));
    const railY = g.rails[0][1];
    const railTop = g.rails[0][2] + g.rails[0][5] / 2;
    for (const x of [g.brain.center[0] - 25, g.brain.center[0] + 25]) {
      body.add(beam([x, 0, g.rails[0][2] - g.rails[0][5] / 2 + 3, 12.7, railY * 2 - 6.4, 6.4], p, q.texture));
    }

    // brain + battery (rounded housings)
    const [bx, by, bz] = g.brain.center;
    const [bsx, bsy, bsz] = g.brain.size;
    body.add(rbox([bsx, bsy, bsz], std(COL.brain, 0.5), [bx, by, bz], 5, seg));
    body.add(rbox([bsx - 6, bsy - 6, 2], std(COL.brainTop, 0.4), [bx, by, bz + bsz / 2 - 0.4], 4, seg));
    body.add(rbox(g.battery.size, std(COL.battery, 0.55), g.battery.center, 3, seg));
    // screen on top: the image's "up" points forward so it reads upright from behind the robot
    this.screenTex = new THREE.CanvasTexture(screen);
    this.screenTex.colorSpace = THREE.SRGBColorSpace;
    this.screenTex.anisotropy = 4;
    const [sw, sh] = g.brain.screen_size;
    const top = bz + bsz / 2 + 0.6;
    body.add(rbox([sh + 7, sw + 7, 1.2], std(0x17181a, 0.3), [bx - 6, by + 6, top], 2, seg));
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), new THREE.MeshBasicMaterial({ map: this.screenTex, toneMapped: false }));
    scr.rotation.z = -Math.PI / 2;
    scr.position.set(bx - 6, by + 6, top + 0.7);
    body.add(scr);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(sw + 4, sh + 4),
      new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, roughness: 0.05, metalness: 0, clearcoat: 1 }));
    glass.rotation.z = -Math.PI / 2;
    glass.position.set(bx - 6, by + 6, top + 0.9);
    body.add(glass);
    // buttons (X, check, left, right) beside the screen, and port sockets on the long edges
    const btn = std(COL.button, 0.45);
    for (const [dx, dy] of [[-15, -44], [-15, -31], [3, -44], [3, -31]]) {
      body.add(rbox([10, 10, 3], btn, [bx + dx, by + dy, top + 0.6], 2, seg));
    }
    const portMat = std(COL.port, 0.7);
    for (let i = 0; i < 6; i++) {
      const yy = by + bsy / 2 - 12 - i * 17.4;
      body.add(rbox([1.6, 10, 8], portMat, [bx + bsx / 2 + 0.2, yy, bz - 4], 0.6, seg));
      body.add(rbox([1.6, 10, 8], portMat, [bx - bsx / 2 - 0.2, yy, bz - 4], 0.6, seg));
    }
    // L corner connectors with blue pins: vertical plate on the brain's long edge, foot on the rail
    const conn = std(COL.connector, 0.5);
    const pinMat = std(COL.pin, 0.35);
    const pinSeg = Math.max(8, Math.round(16 * seg));
    for (const [cx, cy] of g.corner_connectors) {
      const front = cx > bx;
      const plateH = bz - railTop + 6;
      body.add(rbox([3.6, 25.4, plateH], conn, [cx, cy, railTop + plateH / 2], 1.2, seg));
      const footY = cy + Math.sign(cy) * 8;
      body.add(rbox([25.4, 25.4, 3.6], conn, [cx + (front ? -6 : 6), footY, railTop + 1.8], 1.2, seg));
      for (const dy of [-6.35, 6.35]) {
        const pin = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 5, pinSeg), pinMat);
        pin.rotation.z = Math.PI / 2;
        pin.position.set(cx + (front ? 2.6 : -2.6), cy + dy, bz - 2);
        body.add(pin);
      }
      const footPin = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 5, pinSeg), pinMat);
      footPin.rotation.x = Math.PI / 2;
      footPin.position.set(cx + (front ? -6 : 6), footY, railTop + 4);
      body.add(footPin);
    }

    // drive motors (front, inboard of the rails) + travel wheels
    const [msx, msy, msz] = g.motor.size;
    const axleMat = std(COL.axle, 0.35, 0.4);
    for (const side of ["left_motor", "right_motor"] as const) {
      const s = side === "left_motor" ? 1 : -1;
      const motor = new THREE.Group();
      const my = s * (railY - 3.2 - msy / 2);
      motor.add(rbox([msx, msy, msz], std(COL.motor, 0.5), [0, my, r], 4, seg));
      motor.add(rbox([msx * 0.7, 1.2, msz * 0.7], std(COL.motorCap, 0.4), [0, s * (railY - 3.2 - msy - 0.3), r], 3, seg));
      const led = new THREE.Mesh(new THREE.CircleGeometry(1.6, 12), std(0x2fd25a, 0.3, 0, { emissive: 0x2fd25a, emissiveIntensity: 0.8 }));
      led.position.set(msx * 0.3, s * (railY - 3.2 - msy - 1), r + msz * 0.25);
      led.rotation.x = s > 0 ? Math.PI / 2 : -Math.PI / 2;
      motor.add(led);
      this.devices[side] = motor;
      body.add(motor);
      const axle = yCyl(2.2, halfTrack - railY + 10, axleMat, 12);
      axle.position.set(0, s * (railY + (halfTrack - railY) / 2), r);
      body.add(axle);
      const w = travelWheel(r, g.drive.wheel_width, seg, q.texture);
      w.position.set(0, s * halfTrack, r);
      if (s < 0) w.scale.y = -1;
      this.wheels[side] = w;
      body.add(w);
    }
    // rear omni wheels (free)
    for (const s of [1, -1]) {
      const w = omniWheel(r, g.drive.omni_width, g.drive.omni_rollers, seg);
      w.position.set(-g.drive.wheel_base, s * halfTrack, r);
      this.omnis.push(w);
      body.add(w);
      const axle = yCyl(2.2, halfTrack - railY + 10, axleMat, 12);
      axle.position.set(-g.drive.wheel_base, s * (railY + (halfTrack - railY) / 2), r);
      body.add(axle);
    }

    // sensors at their fixed mounts
    const m = g.mounts;
    const sens = std(COL.sensor, 0.5);
    const dist = new THREE.Group();
    dist.add(rbox(m.distance.size, sens, [m.distance.pos[0] - m.distance.size[0] / 2, m.distance.pos[1], m.distance.pos[2]], 3, seg));
    dist.add(rbox([1.2, 24, 10], std(COL.lens, 0.08, 0.2), [m.distance.pos[0] + 0.2, m.distance.pos[1], m.distance.pos[2] + 2], 2, seg));
    dist.add(rbox([1, 4, 4], std(0xff3b30, 0.3, 0, { emissive: 0xff2a1a, emissiveIntensity: 0.6 }), [m.distance.pos[0] + 0.5, m.distance.pos[1] + 14, m.distance.pos[2] + 2], 0.8, seg));
    this.devices.distance = dist;

    const opt = new THREE.Group();
    const [osx, osy, osz] = m.optical.size;
    opt.add(rbox([osx, osy, osz], sens, [m.optical.pos[0], m.optical.pos[1], m.optical.pos[2] + osz / 2], 3, seg));
    this.optGlow = new THREE.MeshStandardMaterial({ color: 0x5a3b7a, emissive: 0x000000, roughness: 0.15 });
    const win = new THREE.Mesh(new THREE.CircleGeometry(6, 24), this.optGlow);
    win.rotation.x = Math.PI;
    win.position.set(m.optical.pos[0], m.optical.pos[1], m.optical.pos[2] - 0.2);
    opt.add(win);
    opt.add(rbox([3.6, 20, g.crossbars[0][2] - m.optical.pos[2] - osz], conn,
      [m.optical.pos[0] + osx / 2, m.optical.pos[1], (g.crossbars[0][2] + m.optical.pos[2] + osz) / 2], 1, seg));
    this.devices.optical = opt;

    const bump = new THREE.Group();
    const [usx, usy, usz] = m.bumper.size;
    bump.add(rbox([usx - 6, usy, usz], sens, [m.bumper.pos[0] - usx / 2 - 3, m.bumper.pos[1], m.bumper.pos[2]], 3, seg));
    this.plunger = rbox([6, usy - 4, usz - 4], std(COL.plunger, 0.45), [m.bumper.pos[0] - 3, m.bumper.pos[1], m.bumper.pos[2]], 2, seg);
    this.plungerX = this.plunger.position.x;
    bump.add(this.plunger);
    this.pick.bumper.push(...bump.children);
    this.devices.bumper = bump;

    const tl = new THREE.Group();
    const [tsx, tsy, tsz] = m.touchled.size;
    tl.add(rbox([tsx, tsy, tsz], sens, [m.touchled.pos[0], m.touchled.pos[1], m.touchled.pos[2] - tsz / 2], 3, seg));
    this.ledMat = new THREE.MeshPhysicalMaterial({ color: 0xe8e8e8, emissive: 0x000000, roughness: 0.2, transmission: 0.2, thickness: 2, transparent: true, opacity: 0.95, clearcoat: 0.6 });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(10, Math.round(32 * seg), Math.round(16 * seg), 0, Math.PI * 2, 0, Math.PI / 2), this.ledMat);
    dome.rotation.x = Math.PI / 2;
    dome.position.set(m.touchled.pos[0], m.touchled.pos[1], m.touchled.pos[2]);
    dome.scale.z = 0.55;
    tl.add(dome);
    this.pick.touchled.push(...tl.children);
    this.devices.touchled = tl;

    for (const d of ["distance", "optical", "bumper", "touchled"] as const) body.add(this.devices[d]);
    body.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && !this.pick.touchled.includes(o) && !this.pick.bumper.includes(o)) this.pick.chassis.push(o);
    });
    this.root.add(this.labels);
  }

  // ------------------------------------------------------------ updates
  setConfig(cfg: IQ2Config): void {
    for (const d of ["distance", "optical", "bumper", "touchled"] as const) this.devices[d].visible = cfg[d].enabled;
    for (const d of ["left_motor", "right_motor"] as const) {
      this.devices[d].traverse((o) => {
        const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (mat && "opacity" in mat) { mat.transparent = !cfg[d].enabled; mat.opacity = cfg[d].enabled ? 1 : 0.35; }
      });
    }
  }

  screenChanged(): void {
    this.screenTex.needsUpdate = true;
  }

  setPose(x: number, y: number, yawDeg: number): void {
    this.root.position.set(x, y, 0);
    this.root.rotation.z = THREE.MathUtils.degToRad(yawDeg);
  }

  update(s: IQ2RobotSnapshot): void {
    this.setPose(...s.pose);
    for (const side of ["left_motor", "right_motor"] as const) {
      this.wheels[side].rotation.y = THREE.MathUtils.degToRad(s.wheels[side]); // + = rolling forward
    }
    for (const o of this.omnis) o.rotation.y = THREE.MathUtils.degToRad(s.omni);
    const c = s.touchled.color;
    if (c) {
      this.ledMat.color.set(c);
      this.ledMat.emissive.set(c);
      this.ledMat.emissiveIntensity = 0.4 + 0.8 * (s.touchled.brightness / 100);
    } else {
      this.ledMat.color.set(0xe8e8e8);
      this.ledMat.emissive.set(0x000000);
    }
    this.plunger.position.x = this.plungerX - (s.bumper ? 3 : 0);
    this.optGlow.emissive.set(s.optical.led > 0 ? 0xffffff : 0x000000);
    this.optGlow.emissiveIntensity = s.optical.led / 100;
  }

  /** Port-number tags above each device (Build tab). */
  showPortLabels(cfg: IQ2Config | null): void {
    this.labels.clear();
    if (!cfg) return;
    for (const d of DEVICES) {
      if (!cfg[d].enabled) continue;
      const anchor = new THREE.Box3().setFromObject(this.devices[d]).getCenter(new THREE.Vector3());
      this.root.worldToLocal(anchor);
      const sprite = labelSprite(`${cfg[d].port}`);
      const [ox, oy, z] = LABEL_AT[d];
      sprite.position.set(anchor.x + ox, anchor.y + oy, z);
      this.labels.add(sprite);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([anchor, sprite.position.clone().setZ(sprite.position.z - 8)]),
        new THREE.LineBasicMaterial({ color: 0x2960b0 }));
      this.labels.add(line);
    }
  }

  highlight(device: IQ2Device | null): void {
    for (const d of DEVICES) {
      this.devices[d].traverse((o) => {
        const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (mat && mat.emissive && mat !== this.ledMat && mat !== this.optGlow) mat.emissive.set(d === device ? 0x1d5fbf : 0x000000);
      });
    }
  }
}

/** Where each port tag floats (offset from the device x, y; absolute z), so the tags don't overlap. */
const LABEL_AT: Record<IQ2Device, [number, number, number]> = {
  left_motor: [0, 45, 115], right_motor: [0, -45, 115], distance: [45, 45, 125],
  optical: [60, 0, 40], bumper: [45, -50, 85], touchled: [-30, 0, 120],
};

function labelSprite(text: string): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 96; c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "#2960b0";
  g.beginPath();
  g.roundRect(4, 4, 88, 56, 14);
  g.fill();
  g.fillStyle = "#fff";
  g.font = "bold 34px Open Sans, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 48, 34);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
  sprite.scale.set(30, 20, 1);
  sprite.renderOrder = 10;
  return sprite;
}
