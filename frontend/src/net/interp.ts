import type { ArmSnapshot, FrameMsg, ObjectSnapshot, Quat, Vec3 } from "./protocol";

/**
 * Smooth playback of server frames.
 *
 * Frames arrive at ~30 Hz with network jitter (bunched, then gaps). Instead of snapping the 3D
 * view to the newest frame, we keep a short buffer and render a little behind the newest sim
 * time, interpolating between the two frames that bracket the playback time - every display
 * refresh. The playback clock follows the observed sim-time rate (so 0.25x, 4x, max speed and
 * pause all work) and is gently steered to stay `lag` behind the newest frame.
 */
export class FrameInterpolator {
  private buf: FrameMsg[] = [];
  private playT = -1; // sim time being displayed
  private rate = 1; // sim seconds per wall second (EMA)
  private lastArrivalWall = 0;
  private lastArrivalT = 0;
  /** wall-clock delay used to absorb jitter (seconds) */
  lagWall = 0.1;

  reset(): void {
    this.buf = [];
    this.playT = -1;
  }

  push(f: FrameMsg): void {
    const now = performance.now() / 1000;
    const last = this.buf[this.buf.length - 1];
    if (last && (f.t < last.t || f.t - last.t > 2)) this.reset(); // new scene / big jump: snap
    if (this.buf.length && f.t === this.buf[this.buf.length - 1].t) {
      this.buf[this.buf.length - 1] = f; // same sim time (e.g. paused): keep the newest data
    } else {
      this.buf.push(f);
    }
    if (this.lastArrivalWall) {
      const dw = now - this.lastArrivalWall;
      const dt = f.t - this.lastArrivalT;
      if (dw > 0.005 && dt >= 0) this.rate += (Math.min(dt / dw, 200) - this.rate) * 0.2;
    }
    this.lastArrivalWall = now;
    this.lastArrivalT = f.t;
    while (this.buf.length > 2 && this.buf[1].t < this.playT - 0.5) this.buf.shift();
    if (this.buf.length > 120) this.buf.splice(0, this.buf.length - 120);
    if (this.playT < 0) this.playT = f.t;
  }

  /** Advance the playback clock by dt (wall seconds) and return an interpolated frame. */
  sample(dtWall: number): FrameMsg | null {
    const n = this.buf.length;
    if (!n) return null;
    const newest = this.buf[n - 1].t;
    const target = newest - this.lagWall * this.rate;
    // follow the stream's rate, and steer towards `target` (fast if far off, gently otherwise)
    this.playT += dtWall * this.rate;
    const err = target - this.playT;
    this.playT += err * Math.min(1, dtWall * (Math.abs(err) > 0.5 * Math.max(this.rate, 0.2) ? 20 : 3));
    if (this.playT > newest) this.playT = newest;
    if (this.playT < this.buf[0].t) this.playT = this.buf[0].t;
    let i = 0;
    while (i < n - 2 && this.buf[i + 1].t <= this.playT) i++;
    const a = this.buf[i], b = this.buf[Math.min(i + 1, n - 1)];
    if (a === b || b.t <= a.t) return b;
    const s = Math.max(0, Math.min(1, (this.playT - a.t) / (b.t - a.t)));
    return lerpFrame(a, b, s);
  }
}

const lerp = (a: number, b: number, s: number) => a + (b - a) * s;
const lerpV = (a: Vec3, b: Vec3, s: number): Vec3 => [lerp(a[0], b[0], s), lerp(a[1], b[1], s), lerp(a[2], b[2], s)];

function slerp(a: Quat, b: Quat, s: number): Quat {
  let [bx, by, bz, bw] = b;
  let d = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (d < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; d = -d; }
  let ka: number, kb: number;
  if (d > 0.9995) { ka = 1 - s; kb = s; } else {
    const th = Math.acos(Math.min(1, d)), sn = Math.sin(th);
    ka = Math.sin((1 - s) * th) / sn; kb = Math.sin(s * th) / sn;
  }
  const q: Quat = [a[0] * ka + bx * kb, a[1] * ka + by * kb, a[2] * ka + bz * kb, a[3] * ka + bw * kb];
  const l = Math.hypot(...q) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

function lerpArm(a: ArmSnapshot, b: ArmSnapshot, s: number): ArmSnapshot {
  if (a.frames.length !== b.frames.length) return b;
  return {
    ...b, // discrete state (tool, magnet, flags...) from the newer frame
    joints: a.joints.map((v, i) => lerp(v, b.joints[i], s)),
    frames: a.frames.map((fa, i) => ({ p: lerpV(fa.p, b.frames[i].p, s), q: slerp(fa.q, b.frames[i].q, s) })),
    tcp: lerpV(a.tcp, b.tcp, s),
    tip: lerpV(a.tip, b.tip, s),
    rpy: b.rpy,
    pen_points: [], // ink is applied once, on arrival - never from interpolated frames
  };
}

function lerpObjects(a: ObjectSnapshot[], b: ObjectSnapshot[], s: number): ObjectSnapshot[] {
  const prev = new Map(a.map((o) => [o.id, o]));
  return b.map((ob) => {
    const oa = prev.get(ob.id);
    if (!oa) return ob;
    return { ...ob, pos: lerpV(oa.pos, ob.pos, s), quat: slerp(oa.quat, ob.quat, s) };
  });
}

function lerpFrame(a: FrameMsg, b: FrameMsg, s: number): FrameMsg {
  return {
    ...b,
    t: lerp(a.t, b.t, s),
    arm: a.arm && b.arm ? lerpArm(a.arm, b.arm, s) : b.arm,
    world: a.world && b.world ? { objects: lerpObjects(a.world.objects, b.world.objects, s) } : b.world,
  };
}
