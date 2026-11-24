import * as THREE from "three";
import type { Box6, IQ2Config, IQ2Device, IQ2Geometry, IQ2RobotSnapshot } from "../net/protocol";
import { DEVICES } from "./store";

const COL = {
  beam: 0xb9bdc1, beamDark: 0x7d8288, brain: 0x50555b, brainTop: 0x63686e, battery: 0x2e3135,
  motor: 0x3d4146, tyre: 0x1d1d1f, hub: 0xd9dcdf, hubBlue: 0x1f6fd1, omniHub: 0xe9ebed,
  roller: 0x202022, connector: 0xc7cacd, pin: 0x2f6fd6, sensor: 0x3a3e43, lens: 0x0d0e10,
  plunger: 0xd5d8db, port: 0x1a1c1f, button: 0x2b2e32,
};

function std(color: number, roughness = 0.6, metalness = 0): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

/** Light-grey IQ beam texture: a row of 0.5 in pitch holes. */
function holeTexture(cellsX: number, cellsY: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "#b9bdc1";
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = "#6f747a";
  g.beginPath();
  g.arc(32, 32, 15, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "#cfd2d5";
  g.lineWidth = 3;
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(Math.max(1, Math.round(cellsX)), Math.max(1, Math.round(cellsY)));
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A beam box; `holesOn` = which axis the drilled faces look along ("x" or "y"). */
function beam(b: Box6, pitch: number): THREE.Mesh {
  const [cx, cy, cz, sx, sy, sz] = b;
  const plain = std(COL.beam, 0.7);
  const alongX = sx >= sy;
  const tex = holeTexture((alongX ? sx : sy) / pitch, sz / pitch);
  const drilled = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 });
  // BoxGeometry material order: +x, -x, +y, -y, +z, -z
  const mats = alongX ? [plain, plain, drilled, drilled, plain, plain] : [drilled, drilled, plain, plain, plain, plain];
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mats);
  m.position.set(cx, cy, cz);
  m.castShadow = m.receiveShadow = true;
  return m;
}

function box(size: [number, number, number], color: number | THREE.Material, pos: [number, number, number]): THREE.Mesh {
  const mat = typeof color === "number" ? std(color) : color;
  const m = new THREE.Mesh(new THREE.BoxGeometry(...size), mat);
  m.position.set(...pos);
  m.castShadow = m.receiveShadow = true;
  return m;
}

/** Cylinder whose axis is the robot's y axis (wheel axles). */
function yCyl(r: number, len: number, color: number | THREE.Material, seg = 32): THREE.Mesh {
  const mat = typeof color === "number" ? std(color) : color;
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
  m.castShadow = true;
  return m; // CylinderGeometry's axis is +y already
}

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
  private ledMat: THREE.MeshStandardMaterial;
  private plunger!: THREE.Mesh;
  private plungerX = 0;
  private screenTex: THREE.CanvasTexture;
  private optGlow: THREE.MeshStandardMaterial;
  private labels = new THREE.Group();

  constructor(readonly g: IQ2Geometry, screen: HTMLCanvasElement) {
    const p = g.pitch;
    const r = g.drive.wheel_travel / (2 * Math.PI);
    const halfTrack = g.drive.track_width / 2;
    const body = new THREE.Group();
    this.root.add(body);

    for (const b of g.rails) body.add(beam(b, p));
    for (const b of g.crossbars) body.add(beam(b, p));

    // brain + battery
    const [bx, by, bz] = g.brain.center;
    const [bsx, bsy, bsz] = g.brain.size;
    const brainMats = [std(COL.brain), std(COL.brain), std(COL.brain), std(COL.brain), std(COL.brainTop, 0.45), std(COL.brain)];
    const brain = box([bsx, bsy, bsz], COL.brain, [bx, by, bz]);
    brain.material = brainMats;
    body.add(brain);
    body.add(box(g.battery.size, COL.battery, g.battery.center));
    // screen on top: the image's "up" points forward so it reads upright from behind the robot
    this.screenTex = new THREE.CanvasTexture(screen);
    this.screenTex.colorSpace = THREE.SRGBColorSpace;
    this.screenTex.anisotropy = 4;
    const [sw, sh] = g.brain.screen_size;
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), new THREE.MeshBasicMaterial({ map: this.screenTex, toneMapped: false }));
    scr.rotation.z = -Math.PI / 2;
    scr.position.set(bx - 6, by + 6, bz + bsz / 2 + 0.9);
    body.add(scr);
    const bezel = box([sh + 6, sw + 6, 0.6], 0x1b1d20, [bx - 6, by + 6, bz + bsz / 2 + 0.1]);
    body.add(bezel);
    // buttons (X, check, left, right) beside the screen, and port sockets on the long edges
    const top = bz + bsz / 2 + 1.2;
    for (const [dx, dy] of [[-15, -44], [-15, -31], [3, -44], [3, -31]]) {
      body.add(box([10, 10, 2.4], COL.button, [bx + dx, by + dy, top]));
    }
    for (let i = 0; i < 6; i++) {
      const yy = by + bsy / 2 - 12 - i * 17.4;
      body.add(box([1, 9, 7], COL.port, [bx + bsx / 2 + 0.3, yy, bz - 4]));
      body.add(box([1, 9, 7], COL.port, [bx - bsx / 2 - 0.3, yy, bz - 4]));
    }
    // L corner connectors with blue pins: vertical plate on the brain's long edge, foot on the rail
    for (const [cx, cy] of g.corner_connectors) {
      const front = cx > bx;
      const plateX = cx;
      const railTop = g.rails[0][2] + g.rails[0][5] / 2;
      const plateH = bz - railTop + 6;
      body.add(box([3.2, 25.4, plateH], COL.connector, [plateX, cy, railTop + plateH / 2]));
      const footY = cy + Math.sign(cy) * 8;
      body.add(box([12.7 + 12.7, 25.4, 3.2], COL.connector, [plateX + (front ? -6 : 6), footY, railTop + 1.6]));
      const pinMat = std(COL.pin, 0.4);
      for (const dy of [-6.35, 6.35]) {
        const pin = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 5, 16), pinMat);
        pin.rotation.z = Math.PI / 2;
        pin.position.set(plateX + (front ? 2.5 : -2.5), cy + dy, bz - 2);
        body.add(pin);
      }
      const footPin = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 5, 16), pinMat);
      footPin.rotation.x = Math.PI / 2;
      footPin.position.set(plateX + (front ? -6 : 6), footY, railTop + 4);
      body.add(footPin);
    }

    // drive motors (front, inboard of the rails) + tyre wheels
    const [msx, msy, msz] = g.motor.size;
    for (const side of ["left_motor", "right_motor"] as const) {
      const s = side === "left_motor" ? 1 : -1;
      const railY = g.rails[0][1];
      const motor = new THREE.Group();
      motor.add(box([msx, msy, msz], COL.motor, [0, s * (railY - 3.2 - msy / 2), r]));
      motor.add(box([msx * 0.6, 1, msz * 0.6], 0x5b6066, [0, s * (railY - 3.2 - msy - 0.4), r]));
      this.devices[side] = motor;
      body.add(motor);
      const axle = yCyl(2.2, halfTrack - railY + 10, 0x9ea3a8, 12);
      axle.position.set(0, s * (railY + (halfTrack - railY) / 2), r);
      body.add(axle);
      const w = this.makeWheel(r, g.drive.wheel_width);
      w.position.set(0, s * halfTrack, r);
      if (s < 0) w.scale.y = -1;
      this.wheels[side] = w;
      body.add(w);
    }
    // rear omni wheels (free)
    for (const s of [1, -1]) {
      const w = this.makeOmni(r, g.drive.omni_width, g.drive.omni_rollers);
      w.position.set(-g.drive.wheel_base, s * halfTrack, r);
      this.omnis.push(w);
      body.add(w);
      const axle = yCyl(2.2, halfTrack - g.rails[0][1] + 10, 0x9ea3a8, 12);
      axle.position.set(-g.drive.wheel_base, s * (g.rails[0][1] + (halfTrack - g.rails[0][1]) / 2), r);
      body.add(axle);
    }

    // sensors at their fixed mounts
    const m = g.mounts;
    const dist = new THREE.Group();
    dist.add(box(m.distance.size, COL.sensor, [m.distance.pos[0] - m.distance.size[0] / 2, m.distance.pos[1], m.distance.pos[2]]));
    const lens = box([1, 22, 9], COL.lens, [m.distance.pos[0] + 0.3, m.distance.pos[1], m.distance.pos[2] + 2]);
    (lens.material as THREE.MeshStandardMaterial).roughness = 0.15;
    dist.add(lens);
    dist.add(box([1, 4, 4], 0xff3b30, [m.distance.pos[0] + 0.4, m.distance.pos[1] + 13, m.distance.pos[2] + 2]));
    this.devices.distance = dist;

    const opt = new THREE.Group();
    const [osx, osy, osz] = m.optical.size;
    opt.add(box([osx, osy, osz], COL.sensor, [m.optical.pos[0], m.optical.pos[1], m.optical.pos[2] + osz / 2]));
    this.optGlow = new THREE.MeshStandardMaterial({ color: 0x5a3b7a, emissive: 0x000000, roughness: 0.2 });
    const win = new THREE.Mesh(new THREE.CircleGeometry(6, 24), this.optGlow);
    win.rotation.x = Math.PI;
    win.position.set(m.optical.pos[0], m.optical.pos[1], m.optical.pos[2] - 0.2);
    opt.add(win);
    // bracket up to the front crossbar
    opt.add(box([3.2, 20, g.crossbars[0][2] - m.optical.pos[2] - osz], COL.connector,
      [m.optical.pos[0] + osx / 2, m.optical.pos[1], (g.crossbars[0][2] + m.optical.pos[2] + osz) / 2]));
    this.devices.optical = opt;

    const bump = new THREE.Group();
    const [usx, usy, usz] = m.bumper.size;
    bump.add(box([usx - 6, usy, usz], COL.sensor, [m.bumper.pos[0] - usx / 2 - 3, m.bumper.pos[1], m.bumper.pos[2]]));
    this.plunger = box([6, usy - 4, usz - 4], COL.plunger, [m.bumper.pos[0] - 3, m.bumper.pos[1], m.bumper.pos[2]]);
    this.plungerX = this.plunger.position.x;
    bump.add(this.plunger);
    this.pick.bumper.push(...bump.children);
    this.devices.bumper = bump;

    const tl = new THREE.Group();
    const [tsx, tsy, tsz] = m.touchled.size;
    tl.add(box([tsx, tsy, tsz], COL.sensor, [m.touchled.pos[0], m.touchled.pos[1], m.touchled.pos[2] - tsz / 2]));
    this.ledMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, emissive: 0x000000, roughness: 0.25, transparent: true, opacity: 0.92 });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), this.ledMat);
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

  private makeWheel(r: number, w: number): THREE.Group {
    const g = new THREE.Group();
    const tyre = yCyl(r, w, COL.tyre, 48);
    (tyre.material as THREE.MeshStandardMaterial).roughness = 0.9;
    g.add(tyre);
    const hub = yCyl(r * 0.66, w + 0.8, COL.hub, 32);
    g.add(hub);
    const insert = yCyl(r * 0.3, w + 2, COL.hubBlue, 6);
    g.add(insert);
    for (let i = 0; i < 3; i++) { // spokes make the rotation visible
      const s = box([r * 1.2, 1.5, 3], 0xaeb3b8, [0, w / 2 + 0.9, 0]);
      s.rotation.y = (i * Math.PI) / 3;
      g.add(s);
    }
    return g;
  }

  private makeOmni(r: number, w: number, n: number): THREE.Group {
    const g = new THREE.Group();
    g.add(yCyl(r * 0.72, w * 0.5, COL.omniHub, 24));
    g.add(yCyl(r * 0.3, w * 0.6, COL.hubBlue, 6));
    const rollerMat = std(COL.roller, 0.85);
    const rad = r * 0.13;
    const len = (2 * Math.PI * r) / n * 0.55;
    for (let ring = 0; ring < 2; ring++) {
      for (let i = 0; i < n; i++) {
        const a = ((i + ring * 0.5) / n) * Math.PI * 2;
        const roller = new THREE.Mesh(new THREE.CapsuleGeometry(rad, len, 4, 10), rollerMat);
        // roller axis tangent to the wheel rim (in the x-z plane); outer edge on the rim
        roller.position.set(Math.cos(a) * (r - rad), (ring ? 1 : -1) * w * 0.24, Math.sin(a) * (r - rad));
        roller.rotation.y = -a;
        roller.castShadow = true;
        g.add(roller);
      }
    }
    return g;
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
