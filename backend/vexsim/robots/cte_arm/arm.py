"""ArmModel: the simulated CTE 6-Axis Arm (state machine + end effectors).

Two notions of "tool" are kept apart, like on the real arm:

* ``mounted_tool`` - the end effector physically attached (Magnet Pickup Tool or Pen Holder Tool).
  Changed from the Teach Pendant / simulator panel, only while the arm is at the safe position.
  It decides what touches the world (magnet face, marker tip) and what is drawn.
* ``tool`` / ``pen_offset`` - the end effector *configured* in software
  (``set_end_effector_type`` / ``set_pen_offset``). Inverse kinematics positions this TCP.
  Each project starts with MAGNET and pen offset 0 (VEX defaults), so a project that forgets to
  configure the pen puts the real marker tip somewhere else - just like the real arm.

All public methods must be called with ``engine.lock`` held (the API layer does this)."""

from __future__ import annotations

import itertools
import math
from collections.abc import Callable

import numpy as np

from vexsim.core.entity import Entity
from vexsim.core.transforms import matrix_to_quat, rotation_angle
from vexsim.core.world import World
from vexsim.robots.cte_arm.end_effectors import Magnet, Pen
from vexsim.robots.cte_arm.kinematics import (
    MAGNET,
    PEN,
    ArmGeometry,
    Kinematics,
    matrix_to_rpy_deg,
    rpy_deg_to_matrix,
)
from vexsim.robots.cte_arm.trajectory import Planner, Trajectory

CRASH_PENETRATION = 3.0  # mm a held cube / the tool may sink into an obstacle before "crash"
CONTACT_TOL = 0.3  # mm of overlap tolerated for manual / gravity contact
FLOOR_CRASH = 2.0  # mm the physical tool tip may press into the tile before "crash"
# The marker's felt tip and the holder give a little, so code can press the pen down (z = -1..-4
# is common in real drawing programs) without the arm stalling.
PEN_PRESS = 6.0  # mm
SAFE_POS_TOL = 2.0  # mm
SAFE_ANG_TOL = 3.0  # deg

# Manual-mode "power down": the pitch joints (J2, J3, J5) are back-driven by gravity through
# their gearboxes. The gear trains resist back-driving so strongly that the motion is
# *overdamped*: no momentum, no toppling - each joint creeps at a speed proportional to the
# gravity torque on it (tau = D * qdot), minus Coulomb friction. The links therefore sink
# slowly, the motion eases off as the torques shrink, and everything settles where the
# remaining torque can no longer overcome friction or a link/tool rests on the tile or base.
SAG_JOINTS = (1, 2, 4)
GRAVITY = 9810.0  # mm/s^2
# kg ESTIMATE: the J3/J4 drives sit in the heavy elbow housing, the J5/J6 drives in the wrist
LINK_MASS = {"upper": 0.22, "elbow": 0.45, "fore": 0.15, "wrist": 0.25, "tool": 0.10, "cube": 0.03}
# back-drive damping of J2, J3, J5 in kg*mm^2/s (ESTIMATE, tuned for a few-second slump)
GEAR_DAMPING = np.array([2.2e6, 2.6e6, 9.0e5])
# torque the gear friction holds without moving, kg*mm^2/s^2 (ESTIMATE)
GEAR_FRICTION = np.array([4.0e4, 6.0e4, 1.5e4])
SAG_MAX_RATE = math.radians(20)  # rad/s cap
# Back-driven by hand / gravity the joints can go a little past the software limits, up to
# their mechanical stops (deg, ESTIMATE). The elbow stop sits at 82 deg of fold - just before
# the forearm would touch the shoulder housing (contact at ~85 deg with the modelled geometry).
MECH_LIMIT_MARGIN = np.radians([0, 0, 4, 0, 10, 0])
SAG_RELEASE_TIME = 0.6  # s for the holding torque to bleed off as the drives power down
DRAG_JOINTS = (0, 1, 2, 4)
DRAG_STEP = 3.0  # mm per sub-step when dragging (prevents tunnelling through cubes)


class ArmModel(Entity):
    kind = "cte_arm"

    def __init__(self, geom: ArmGeometry, world: World, name: str = "arm"):
        super().__init__(name)
        self.g = geom
        self.kin = Kinematics(geom)
        self.planner = Planner(self.kin)
        self.world = world
        # configured (software) end effector
        self.tool = MAGNET
        self.pen_offset = 0.0
        # physically mounted end effector
        self.mounted_tool = MAGNET
        self.marker_protrusion = geom.marker_protrusion
        self.speed = geom.default_speed
        self.timeout_ms = 0  # 0 = no timeout
        self.magnet = Magnet(world)
        self.pen = Pen()
        self.control_stopped = False
        self.crashed = False
        self.manual_mode = False
        self.dragging = False
        self.sagging = False
        self._sag_v = np.zeros(6)
        self._sag_t = 0.0
        self.traj: Trajectory | None = None
        self.traj_t = 0.0
        self.move_id = 0
        self.last_result: dict[int, bool] = {}
        self._control_stop_cbs: list[tuple[Callable, tuple]] = []
        self._crash_cbs: list[tuple[Callable, tuple]] = []
        r0 = rpy_deg_to_matrix(*geom.start_orientation)
        q = self.kin.ik(np.array(geom.start_position), r0, near=np.zeros(6))
        if q is None:
            raise ValueError("start_position unreachable - check geometry.yaml")
        self.q = q
        self._target_p = np.array(geom.start_position, dtype=float)
        self._target_r = r0

    # ------------------------------------------------------------------ queries
    @property
    def fk(self):
        """FK of the *configured* TCP (what the API reports and IK targets)."""
        return self.kin.fk(self.q, self.tool, self.pen_offset)

    def physical_fk(self, q=None):
        """FK of the *mounted* tool's real tip (magnet face / marker tip)."""
        q = self.q if q is None else q
        off = self.marker_offset if self.mounted_tool == PEN else 0.0
        return self.kin.fk(q, self.mounted_tool, off)

    @property
    def marker_offset(self) -> float:
        """The pen offset that puts the configured TCP on the mounted marker's real tip."""
        return self.marker_protrusion - self.g.pen_holder_length

    def tcp(self) -> np.ndarray:
        return self.fk.tcp

    def rpy(self) -> tuple[float, float, float]:
        return matrix_to_rpy_deg(self.fk.r_ee)

    def is_moving(self) -> bool:
        return self.traj is not None

    def at_safe_position(self) -> bool:
        if self.is_moving() or self.manual_mode:
            return False
        f = self.fk
        r0 = rpy_deg_to_matrix(*self.g.start_orientation)
        return (float(np.linalg.norm(f.tcp - np.array(self.g.start_position))) <= SAFE_POS_TOL
                and math.degrees(rotation_angle(f.r_ee, r0)) <= SAFE_ANG_TOL)

    def can_reach(self, p, r=None) -> bool:
        r = self.fk.r_ee if r is None else r
        if self.control_stopped:
            return False
        return self.planner.plan(self.q, np.asarray(p, float), r, self.speed, self.tool,
                                 self.pen_offset) is not None

    # ------------------------------------------------------------------ commands
    def start_move(self, p, r=None, force_joint: bool = False) -> int | None:
        """Begin a move to TCP pose. Returns a move id, or None if rejected/unreachable."""
        if self.control_stopped or self.manual_mode:
            return None
        r = self.fk.r_ee if r is None else r
        traj = self.planner.plan(self.q, np.asarray(p, float), r, self.speed, self.tool,
                                 self.pen_offset)
        if traj is None and force_joint:
            q_goal = self.kin.ik(np.asarray(p, float), r, near=self.q, tool=self.tool,
                                 pen_offset=self.pen_offset)
            if q_goal is not None:
                traj = self.planner.plan_joint(self.q, q_goal, self.speed, self.tool,
                                               self.pen_offset, check=False)
        if traj is None:
            return None
        self.move_id += 1
        self.traj, self.traj_t = traj, 0.0
        self._target_p, self._target_r = np.asarray(p, float), r
        self.crashed = False
        if traj.duration <= 0:
            self._finish(True)
        return self.move_id

    def target_pose(self) -> tuple[np.ndarray, np.ndarray]:
        """Pose the arm is heading to (or at) - used as the base for *_inc moves."""
        if self.traj is not None:
            return self._target_p.copy(), self._target_r.copy()
        f = self.fk
        return f.tcp, f.r_ee

    def _finish(self, reached: bool) -> None:
        if self.traj is not None:
            self.last_result[self.move_id] = reached
        self.traj = None

    def abort_move(self) -> None:
        self._finish(False)

    def set_tool(self, tool: str) -> None:
        """Configured end effector (software) - does not swap the physical tool."""
        if tool not in (MAGNET, PEN):
            raise ValueError(f"unknown end effector {tool!r}")
        self.tool = tool

    def mount_tool(self, tool: str, force: bool = False) -> bool:
        """Physically swap the end effector (and configure it). Only at the safe position
        (``force`` skips the check when the caller already verified it)."""
        if tool not in (MAGNET, PEN):
            raise ValueError(f"unknown end effector {tool!r}")
        if tool != self.mounted_tool and not force and not self.at_safe_position():
            return False
        if tool != MAGNET:
            self.magnet.on = False
            self.magnet.release()
        self.mounted_tool = tool
        self.tool = tool
        self.move_to_safe()  # re-home so the new tool's TCP sits at the safe position
        return True

    def set_magnet(self, on: bool) -> None:
        self.magnet.on = bool(on) and self.mounted_tool == MAGNET
        if not on:
            self.magnet.release()
        else:
            f = self.physical_fk()
            self.magnet.try_pick(f.tcp, f.r_ee)

    def reset_for_program(self) -> None:
        """Project start: VEX defaults (speed 50 %, MAGNET, pen offset 0, magnet off...)."""
        self.abort_move()
        self.set_manual(False)
        self._control_stop_cbs.clear()
        self._crash_cbs.clear()
        self.speed = self.g.default_speed
        self.timeout_ms = 0
        self.control_stopped = False
        self.crashed = False
        self.tool = MAGNET
        self.pen_offset = 0.0
        self.set_magnet(False)

    # ------------------------------------------------------------------ teach pendant
    def move_to_safe(self) -> int | None:
        """'Move to Safe Position': (120, 0, 100), tool pointing down. Falls back to an
        unchecked joint-space move so it can recover from any pose (e.g. after Manual Mode)."""
        p = np.array(self.g.start_position, dtype=float)
        r = rpy_deg_to_matrix(*self.g.start_orientation)
        return self.start_move(p, r, force_joint=True)

    def set_manual(self, enabled: bool) -> None:
        """Manual Mode: the joint motors power down - the arm sags under gravity and can be
        pulled around by its tool tip."""
        if enabled:
            self._finish(False)
            self.sagging = True
            self._sag_v = np.zeros(6)
            self._sag_t = 0.0
        self.manual_mode = enabled
        self.dragging = False
        if not enabled:
            self.sagging = False
            # re-powered: hold where we are
            f = self.fk
            self._target_p, self._target_r = f.tcp, f.r_ee

    # -- physical constraints used by sag + drag
    def _pose_ok(self, q) -> bool:
        lo, hi = self.g.joint_min - MECH_LIMIT_MARGIN, self.g.joint_max + MECH_LIMIT_MARGIN
        if np.any(q < lo - 1e-9) or np.any(q > hi + 1e-9):
            return False
        f = self.physical_fk(q)
        g = self.g
        if f.tcp[2] < g.floor_z - 0.5:
            return False
        if f.elbow[2] < g.floor_z + g.link_floor_margin or f.wrist[2] < g.floor_z + g.link_floor_margin:
            return False
        if self._hits_base(f.tcp) or self._hits_base(f.wrist, 15.0):
            return False
        held = self.magnet.held
        held_c = None
        if held is not None:
            # predicted held-cube position under the new pose
            held_c = f.tcp + f.r_ee @ self.magnet._p_rel
            if held_c[2] - held.half_height < g.floor_z - 0.5:
                return False
        return not self._body_hits_objects(f, CONTACT_TOL, held_c)

    def _body_points(self, f) -> tuple[np.ndarray, np.ndarray]:
        """The arm's solid parts as sampled spheres (centres, radii) for contact with cubes.
        The tool tip itself is a point (radius 0) so it can rest exactly on a cube's top."""
        g = self.g
        axis = f.r_tool[:, 0]  # tool axis, pointing out of the flange towards the tip
        flange = f.frames[5][0]
        caps: list[tuple[np.ndarray, np.ndarray, float]] = []
        if self.mounted_tool == PEN:
            caps.append((f.tcp - axis * 9.5, f.tcp - axis * 40.0, 9.5))  # marker barrel
            caps.append((flange, flange + f.r_tool @ np.array([0.0, 0.0, g.pen_lateral]), 10.0))
        else:
            caps.append((f.tcp - axis * 15.0, flange, 15.0))  # magnet block, 31 mm wide
        r3 = f.frames[2][1]
        caps.append((f.wrist, flange, 18.0))  # wrist block
        caps.append((f.elbow + r3 @ np.array([12.0, 0.0, g.forearm_offset]), f.wrist, 15.0))  # forearm
        pts, rad = [f.tcp], [0.0]
        for a, b, r in caps:
            n = max(2, int(np.linalg.norm(b - a) / 5.0) + 1)
            for t in np.linspace(0.0, 1.0, n):
                pts.append(a + (b - a) * t)
                rad.append(r)
        return np.array(pts), np.array(rad)

    def _body_hits_objects(self, f, tol: float, held_c=None) -> bool:
        """Does the tool / wrist / forearm (or the carried cube) push into a resting cube?
        Touching a face is fine - that's how you rest the tool on top of a cube."""
        objs = [o for o in self.world.objects.values() if not (o.held or o.user_grab)]
        if not objs:
            return False
        held = self.magnet.held
        pts, rad = self._body_points(f)
        for o in objs:
            h = o.half_height
            c = o.position
            if held_c is not None:
                hh = held.half_height
                if (abs(held_c[0] - c[0]) < h + hh - 1.0 and abs(held_c[1] - c[1]) < h + hh - 1.0
                        and abs(held_c[2] - c[2]) < h + hh - tol):
                    return True
            d = np.abs(pts - c) - h  # signed distance to the cube (axis-aligned box)
            outside = np.linalg.norm(np.maximum(d, 0.0), axis=1)
            inside = np.minimum(d.max(axis=1), 0.0)
            if np.any(outside + inside < rad - tol):
                return True
        return False

    def _hits_base(self, pt, clearance: float = 0.0) -> bool:
        """Contact with the real base shape (flange + body), not the planner's keep-out."""
        b = self.g.raw["base"]
        r = math.hypot(pt[0], pt[1]) - clearance
        return ((r < b["flange_radius"] and pt[2] < b["flange_height"] + 2.4)
                or (r < b["body_radius"] and pt[2] < b["body_height"]))

    def _mass_points(self, q) -> tuple[np.ndarray, np.ndarray]:
        """Point masses (positions, masses) approximating the links for the fall dynamics."""
        f = self.physical_fk(q)
        m = LINK_MASS
        r3 = f.frames[2][1]
        a = f.elbow + r3 @ np.array([0.0, 0.0, self.g.forearm_offset])
        pts = [
            f.shoulder + 0.25 * (f.elbow - f.shoulder), f.shoulder + 0.75 * (f.elbow - f.shoulder),
            f.elbow,
            a + 0.25 * (f.wrist - a), a + 0.75 * (f.wrist - a),
            f.wrist,
            f.wrist + 0.5 * (f.tcp - f.wrist),
        ]
        ms = [m["upper"] / 2, m["upper"] / 2, m["elbow"], m["fore"] / 2, m["fore"] / 2, m["wrist"], m["tool"]]
        if self.magnet.held is not None:
            pts.append(f.tcp)
            ms.append(m["cube"])
        return np.array(pts), np.array(ms)

    def _gravity_torque(self, q) -> np.ndarray:
        """Gravity torque on each sag joint (kg*mm^2/s^2), from the point-mass links."""
        idx = list(SAG_JOINTS)
        p0, ms = self._mass_points(q)
        tau = np.zeros(len(idx))
        h = 1e-4
        for k, i in enumerate(idx):
            qh = q.copy()
            qh[i] += h
            dz = (self._mass_points(qh)[0][:, 2] - p0[:, 2]) / h
            tau[k] = -GRAVITY * float(np.dot(ms, dz))
        return tau

    def _sag_step(self, dt: float) -> None:
        """Overdamped slump: joint speed = (gravity torque - friction) / gearbox damping."""
        idx = list(SAG_JOINTS)
        self._sag_t += dt
        release = min(1.0, self._sag_t / SAG_RELEASE_TIME)
        release = release * release * (3 - 2 * release)  # smooth power-down
        tau = release * self._gravity_torque(self.q)
        net = np.sign(tau) * np.maximum(np.abs(tau) - GEAR_FRICTION, 0.0)
        v = np.clip(net / GEAR_DAMPING, -SAG_MAX_RATE, SAG_MAX_RATE)
        vel = np.zeros(6)
        vel[idx] = v
        q_new = self.q + vel * dt
        if not self._pose_ok(q_new):
            # something touched: keep the largest set of joints that can still move
            q_new = None
            for size in (2, 1):
                for free in itertools.combinations(idx, size):
                    qn = self.q.copy()
                    qn[list(free)] += vel[list(free)] * dt
                    if self._pose_ok(qn):
                        q_new = qn
                        vel[[i for i in idx if i not in free]] = 0.0
                        break
                if q_new is not None:
                    break
            if q_new is None:
                vel[:] = 0.0
                q_new = self.q
        self.q = q_new
        self._sag_v = vel
        self.sagging = bool(np.max(np.abs(vel)) > math.radians(0.1) or self._sag_t < SAG_RELEASE_TIME)

    def drag_to(self, p: np.ndarray, upright: bool = False) -> bool:
        """Manual Mode: pull the physical tool tip towards p.

        ``upright`` - the user holds the tool vertical (e.g. a marker perpendicular to the board):
        orientation-locked IK on the real tip, tool pointing straight down at the current yaw.
        Otherwise the arm is pulled like a limp chain (position-only DLS on J1, J2, J3, J5).
        Either way it moves as far towards p as the constraints allow."""
        if not self.manual_mode:
            return False
        p = np.asarray(p, dtype=float)
        if upright and self.physical_fk().r_ee[2, 2] < 0.995 and self._straighten_to(p):
            self.dragging = True
            return True
        # walk there in small steps so a fast mouse can't tunnel through a cube
        start = self.physical_fk().tcp
        n = max(1, int(math.ceil(np.linalg.norm(p - start) / DRAG_STEP)))
        moved = False
        for i in range(1, n + 1):
            sub = start + (p - start) * (i / n)
            before = self.physical_fk().tcp
            ok = self._drag_upright(sub) if upright else self._drag_limp(sub)
            moved |= ok
            after = self.physical_fk().tcp
            if np.linalg.norm(after - sub) > 1.0 and np.linalg.norm(after - before) < 0.2:
                break  # blocked (contact / reach): stay at the last free position
        self.dragging = True
        return moved

    def _straighten_to(self, p: np.ndarray) -> bool:
        """The tool is grabbed while tilted (e.g. after slumping): swing it upright to p in one
        motion, but only if the joint-space path there touches nothing."""
        tool = self.mounted_tool
        off = self.marker_offset if tool == PEN else 0.0
        f = self.physical_fk()
        yaw = math.degrees(math.atan2(f.r_ee[1, 0], f.r_ee[0, 0]))
        q_t = self.kin.ik(p, rpy_deg_to_matrix(yaw, 0.0, 0.0), near=self.q, tool=tool, pen_offset=off)
        if q_t is None:
            return False
        path = [self.q + (q_t - self.q) * t for t in np.linspace(0.0, 1.0, 25)[1:]]
        if not all(self._pose_ok(q) for q in path):
            return False
        self.q = q_t
        self._sag_v = np.zeros(6)
        return True

    def _drag_limp(self, p: np.ndarray) -> bool:
        if not self.manual_mode:
            return False
        self.dragging = True
        p = np.asarray(p, dtype=float)
        q = self.q.copy()
        idx = list(DRAG_JOINTS)

        def tip(qq):
            return self.physical_fk(qq).tcp

        cur = tip(q)
        best_q, best_err = q.copy(), float(np.linalg.norm(p - cur))
        lam = 8.0
        for _ in range(30):
            e = p - cur
            if np.linalg.norm(e) < 0.3:
                break
            jac = np.zeros((3, len(idx)))
            for k, i in enumerate(idx):
                qh = q.copy()
                qh[i] += 1e-4
                jac[:, k] = (tip(qh) - cur) / 1e-4
            dq = jac.T @ np.linalg.solve(jac @ jac.T + lam * lam * np.eye(3), e)
            n = np.linalg.norm(dq)
            if n > 0.15:
                dq *= 0.15 / n
            stepped = False
            for scale in (1.0, 0.5, 0.25):
                qn = q.copy()
                qn[idx] += dq * scale
                qn = np.clip(qn, self.g.joint_min - MECH_LIMIT_MARGIN, self.g.joint_max + MECH_LIMIT_MARGIN)
                if self._pose_ok(qn):
                    q, cur, stepped = qn, tip(qn), True
                    break
            if not stepped:
                break
            err = float(np.linalg.norm(p - cur))
            if err < best_err:
                best_q, best_err = q.copy(), err
        moved = not np.allclose(best_q, self.q)
        self.q = best_q
        self._sag_v = np.zeros(6)
        return moved

    def _drag_upright(self, p: np.ndarray) -> bool:
        tool = self.mounted_tool
        off = self.marker_offset if tool == PEN else 0.0
        f = self.physical_fk()
        yaw = math.degrees(math.atan2(f.r_ee[1, 0], f.r_ee[0, 0]))
        r = rpy_deg_to_matrix(yaw, 0.0, 0.0)
        start = f.tcp

        def solve(target):
            q = self.kin.ik(target, r, near=self.q, tool=tool, pen_offset=off)
            return q if q is not None and self._pose_ok(q) else None

        q = solve(p)
        if q is None:  # go as far as possible along the pull
            lo, hi = 0.0, 1.0
            for _ in range(10):
                mid = (lo + hi) / 2
                qm = solve(start + mid * (p - start))
                if qm is not None:
                    lo, q = mid, qm
                else:
                    hi = mid
            if q is None:
                # not upright yet (e.g. it fell over): straighten it where it is, slightly lifted
                q = solve(np.array([start[0], start[1], max(start[2], 15.0)]))
        if q is None:
            return False
        self.q = q
        self._sag_v = np.zeros(6)
        return True

    def drag_end(self) -> None:
        self.dragging = False
        if self.manual_mode:
            self.sagging = True

    # ------------------------------------------------------------------ control stop / events
    def engage_control_stop(self) -> None:
        if self.control_stopped:
            return
        self.control_stopped = True
        self._finish(False)
        for fn, args in self._control_stop_cbs:
            self.engine.spawn_callback(fn, args)

    def on_control_stopped(self, fn, args=()) -> None:
        self._control_stop_cbs.append((fn, args))

    def on_crashed(self, fn, args=()) -> None:
        self._crash_cbs.append((fn, args))

    # ------------------------------------------------------------------ stepping
    def _collides(self, f) -> bool:
        """Crash during a programmed move: the real tool tip in the tile, or the tool / wrist /
        forearm / carried cube pushing into a cube."""
        held = self.magnet.held
        press = PEN_PRESS if self.mounted_tool == PEN else FLOOR_CRASH
        if f.tcp[2] < self.world.floor_z - press:
            return True
        if held is not None and held.bottom_z < self.world.floor_z - CRASH_PENETRATION:
            return True
        return self._body_hits_objects(f, CRASH_PENETRATION,
                                       held.position.copy() if held is not None else None)

    def step(self, t: float, dt: float) -> None:
        if self.traj is not None:
            self.traj_t += dt
            prev = self.q
            self.q = self.traj.q_at(self.traj_t)
            pf = self.physical_fk()
            self.magnet.carry(pf.tcp, pf.r_ee)
            if self._collides(pf):
                self.q = prev
                pf = self.physical_fk()
                self.magnet.carry(pf.tcp, pf.r_ee)
                self.crashed = True
                self._finish(False)
                for fn, args in self._crash_cbs:
                    self.engine.spawn_callback(fn, args)
            elif self.traj_t >= self.traj.duration:
                f = self.fk
                err = np.linalg.norm(f.tcp - self._target_p)
                ang = math.degrees(rotation_angle(f.r_ee, self._target_r))
                self._finish(err <= self.g.position_tolerance and ang <= 1.0)
        elif self.manual_mode and not self.dragging and self.sagging:
            self._sag_step(dt)
        pf = self.physical_fk()
        self.magnet.try_pick(pf.tcp, pf.r_ee)
        self.magnet.carry(pf.tcp, pf.r_ee)
        self.pen.update(pf.tcp, self.mounted_tool == PEN, self.world.drawable)

    # ------------------------------------------------------------------ io
    def snapshot(self) -> dict:
        f = self.fk
        pf = self.physical_fk()
        yaw, roll, pitch = matrix_to_rpy_deg(f.r_ee)
        return {
            "joints": [round(math.degrees(a), 3) for a in self.q],
            "frames": [
                {"p": [round(float(v), 3) for v in p], "q": [round(v, 6) for v in matrix_to_quat(r)]}
                for p, r in f.frames
            ],
            "tcp": [round(float(v), 2) + 0.0 for v in f.tcp],
            "tip": [round(float(v), 2) + 0.0 for v in pf.tcp],
            "rpy": [round(yaw, 2) + 0.0, round(roll, 2) + 0.0, round(pitch, 2) + 0.0],
            "tool": self.tool,
            "mounted_tool": self.mounted_tool,
            "pen_offset": self.pen_offset,
            "marker_protrusion": self.marker_protrusion,
            "marker_offset": round(self.marker_offset, 2) + 0.0,
            "magnet": self.magnet.on,
            "holding": self.magnet.held.id if self.magnet.held else None,
            "moving": self.is_moving(),
            "speed": self.speed,
            "control_stopped": self.control_stopped,
            "crashed": self.crashed,
            "manual": self.manual_mode,
            "sagging": self.manual_mode and self.sagging and not self.dragging,
            "at_safe": self.at_safe_position(),
            "pen_points": self.pen.drain(),
        }

    def describe(self) -> dict:
        g = self.g
        pen = g.raw["tools"]["pen"]
        return {
            "name": self.name,
            "kind": self.kind,
            "geometry": {
                "shoulder_height": g.shoulder_height,
                "shoulder_forward": g.shoulder_forward,
                "upper_arm": g.upper_arm,
                "forearm": g.forearm,
                "forearm_offset": g.forearm_offset,
                "wrist_to_flange": g.wrist_to_flange,
                "magnet_length": g.magnet_length,
                "pen_lateral": g.pen_lateral,
                "marker_length": pen["marker_length"],
                "marker_diameter": pen["marker_diameter"],
                "base": g.raw["base"],
                "joints": g.raw["joints"],
                "safe_position": list(g.start_position),
            },
            "pen_strokes": self.pen.strokes,
        }
