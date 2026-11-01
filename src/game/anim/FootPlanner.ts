/**
 * Keeps feet planted on the floor and moves them in discrete steps.
 *
 * Each frame the animator supplies where each foot *wants* to be (world XZ +
 * yaw, from the stance pose). A planted foot stays exactly where it is until
 * it drifts too far from its target; then it takes a short arcing step, one
 * foot at a time, leading with the foot on the side of travel (front foot
 * when advancing, rear foot when retreating). This removes foot sliding and
 * produces natural pivots when the fighter turns.
 *
 * Presentation only: it never feeds back into the simulation.
 */
export interface FootTarget {
  x: number;
  z: number;
  /** World yaw of the foot, radians. */
  yaw: number;
}

export interface FootOut {
  x: number;
  z: number;
  yaw: number;
  /** Height of the foot above its planted height (m). */
  lift: number;
  /** 0 while planted, 0..1 through a step. */
  stepT: number;
}

interface FootState {
  px: number;
  pz: number;
  pyaw: number;
  stepping: boolean;
  t: number;
  dur: number;
  sx: number;
  sz: number;
  syaw: number;
  height: number;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class FootPlanner {
  private feet: [FootState, FootState] | null = null;
  readonly out: [FootOut, FootOut] = [
    { x: 0, z: 0, yaw: 0, lift: 0, stepT: 0 },
    { x: 0, z: 0, yaw: 0, lift: 0, stepT: 0 },
  ];
  /** Total steps taken (tests and debugging). */
  steps = 0;

  get active() {
    return this.feet !== null;
  }

  /** Start planting from the given foot positions (usually the currently displayed feet). */
  reset(a: FootTarget, b: FootTarget) {
    const mk = (f: FootTarget): FootState => ({ px: f.x, pz: f.z, pyaw: f.yaw, stepping: false, t: 0, dur: 0.2, sx: f.x, sz: f.z, syaw: f.yaw, height: 0.05 });
    this.feet = [mk(a), mk(b)];
  }

  deactivate() {
    this.feet = null;
  }

  /**
   * @param targets desired foot placement [left, right]
   * @param vx,vz body velocity (m/s), used to step ahead of the motion
   * @param dt seconds since last update (0 freezes everything)
   */
  update(targets: [FootTarget, FootTarget], vx: number, vz: number, dt: number): [FootOut, FootOut] {
    if (!this.feet) this.reset(targets[0], targets[1]);
    const feet = this.feet!;
    const speed = Math.hypot(vx, vz);
    const dur = Math.max(0.12, 0.21 - speed * 0.03);
    const lead = Math.min(0.2, dur * 0.95);
    // Predict where the target will be by the end of a step.
    const goal = targets.map((t) => ({ x: t.x + vx * lead, z: t.z + vz * lead, yaw: t.yaw }));

    // Advance active steps.
    for (let i = 0; i < 2; i++) {
      const f = feet[i];
      if (!f.stepping) continue;
      f.t = Math.min(1, f.t + dt / f.dur);
      if (f.t >= 1) {
        f.stepping = false;
        f.px = goal[i].x;
        f.pz = goal[i].z;
        f.pyaw = goal[i].yaw;
      }
    }

    // Start a new step when a planted foot has drifted too far.
    // Longer strides when moving faster (fewer, bigger steps instead of a shuffle).
    const threshold = speed > 0.3 ? 0.085 + speed * 0.12 : 0.055;
    const yawThreshold = 0.42;
    const err = feet.map((f, i) => (f.stepping ? -1 : Math.hypot(goal[i].x - f.px, goal[i].z - f.pz) + Math.abs(wrap(goal[i].yaw - f.pyaw)) * 0.15));
    const anyStepping = feet.some((f) => f.stepping && f.t < 0.6);
    if (!anyStepping) {
      // Lead with the foot that is furthest from where it should be.
      const order = err[0] >= err[1] ? [0, 1] : [1, 0];
      for (const i of order) {
        const f = feet[i];
        if (f.stepping) continue;
        const dPos = Math.hypot(goal[i].x - f.px, goal[i].z - f.pz);
        const dYaw = Math.abs(wrap(goal[i].yaw - f.pyaw));
        if (dPos > threshold || dYaw > yawThreshold) {
          f.stepping = true;
          f.t = 0;
          f.dur = dur * (dPos > 0.3 ? 1.25 : 1);
          f.sx = f.px;
          f.sz = f.pz;
          f.syaw = f.pyaw;
          f.height = Math.min(0.09, 0.035 + dPos * 0.18);
          this.steps++;
          break;
        }
      }
    }

    for (let i = 0; i < 2; i++) {
      const f = feet[i];
      const o = this.out[i];
      if (f.stepping) {
        // Ease the foot toward the (moving) goal; lift follows a sine arc.
        const e = f.t * f.t * (3 - 2 * f.t);
        o.x = f.sx + (goal[i].x - f.sx) * e;
        o.z = f.sz + (goal[i].z - f.sz) * e;
        o.yaw = f.syaw + wrap(goal[i].yaw - f.syaw) * e;
        o.lift = Math.sin(Math.PI * f.t) * f.height;
        o.stepT = f.t;
      } else {
        o.x = f.px;
        o.z = f.pz;
        o.yaw = f.pyaw;
        o.lift = 0;
        o.stepT = 0;
      }
    }
    return this.out;
  }
}
