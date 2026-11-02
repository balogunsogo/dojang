import * as THREE from 'three';
import { clamp, wrapAngle } from '../math';

const ROOM_HALF = 6.6;
const ROOM_HEIGHT = 4.2;

/**
 * Free third-person orbit camera with optional opponent lock-on.
 *  - Lock-on: orbits the midpoint of both fighters, zooms with their
 *    separation, and (when the player is not steering it) drifts to a
 *    three-quarter side view with the player on the left of the screen.
 *  - Free: orbits the player; framing assistance is off.
 */
export class CameraRig {
  yaw = 0;
  pitch = 0.2;
  zoom = 0;
  lockOn = true;
  /** Framing assistance: drift to the side view when the player is not steering. */
  assist = true;
  /** Seconds since the player last moved the camera. */
  private idle = 10;
  private readonly focus = new THREE.Vector3(0, 1.1, 0);
  private readonly pos = new THREE.Vector3();
  private shake = 0;
  private initialized = false;
  /**
   * Screen fractions covered by UI (HUD at the top, controls at the bottom).
   * Framing keeps both fighters inside the remaining region.
   */
  readonly safe = { top: 0.08, bottom: 0, widthFraction: 0.72 };
  private viewY = 0;
  private viewW = 0;
  private viewH = 0;

  private punch = 0;
  private baseFov = 0;

  addShake(amount: number) {
    this.shake = Math.min(0.12, this.shake + amount);
    // Heavy impacts also give a brief, subtle zoom "punch" (scales with shake, so the comfort setting reduces it too).
    this.punch = Math.min(1, this.punch + amount * 12);
  }

  input(dYaw: number, dPitch: number, dZoom: number) {
    if (dYaw || dPitch) this.idle = 0;
    this.yaw = wrapAngle(this.yaw + dYaw);
    this.pitch = clamp(this.pitch + dPitch, -0.05, 1.1);
    this.zoom = clamp(this.zoom + dZoom, -1.5, 3);
  }

  /** Camera ground-plane forward yaw (used to map stick input to world). */
  get viewYaw(): number {
    return this.yaw;
  }

  update(cam: THREE.PerspectiveCamera, dt: number, px: number, pz: number, ox: number, oz: number, vw = 0, vh = 0) {
    this.idle += dt;
    const ux = ox - px;
    const uz = oz - pz;
    const sep = Math.hypot(ux, uz) || 1;
    const nx = ux / sep;
    const nz = uz / sep;

    let fx: number;
    let fz: number;
    let dist: number;
    if (this.lockOn) {
      fx = (px + ox) / 2;
      fz = (pz + oz) / 2;
      dist = this.fitDistance(cam, sep) + this.zoom;
      // Desired view: camera right ≈ player->opponent, nudged behind the player.
      const k = Math.sin(0.42);
      const c = Math.cos(0.42);
      const dx = nz * c + nx * k;
      const dz = -nx * c + nz * k;
      const desired = Math.atan2(dx, dz);
      const assist = this.assist && this.idle > 1.2 ? 1 - Math.exp(-dt * 2.2) : 0;
      if (!this.initialized) {
        this.yaw = desired;
        this.initialized = true;
      } else this.yaw = wrapAngle(this.yaw + wrapAngle(desired - this.yaw) * assist);
    } else {
      fx = px;
      fz = pz;
      dist = 3.6 + this.zoom;
    }
    // Smooth the focus point.
    const f = 1 - Math.exp(-dt * 8);
    this.focus.x += (fx - this.focus.x) * f;
    this.focus.z += (fz - this.focus.z) * f;
    this.focus.y = 1.05;

    const cp = Math.cos(this.pitch);
    this.pos.set(
      this.focus.x - Math.sin(this.yaw) * cp * dist,
      this.focus.y + Math.sin(this.pitch) * dist + 0.35,
      this.focus.z - Math.cos(this.yaw) * cp * dist,
    );
    // Stay inside the dojang.
    this.pos.x = clamp(this.pos.x, -ROOM_HALF, ROOM_HALF);
    this.pos.z = clamp(this.pos.z, -ROOM_HALF, ROOM_HALF);
    this.pos.y = clamp(this.pos.y, 0.4, ROOM_HEIGHT);

    cam.position.copy(this.pos);
    if (this.shake > 0.0005) {
      cam.position.x += (Math.random() - 0.5) * this.shake;
      cam.position.y += (Math.random() - 0.5) * this.shake;
      this.shake *= Math.exp(-dt * 14);
    }
    cam.lookAt(this.focus);
    if (!this.baseFov) this.baseFov = cam.fov;
    if (this.punch > 0.002 || cam.fov !== this.baseFov) {
      this.punch *= Math.exp(-dt * 10);
      cam.fov = this.baseFov - this.punch * 2.2;
      cam.updateProjectionMatrix();
    }
    this.applyViewOffset(cam, vw, vh);
  }

  /**
   * Distance at which both fighters (plus kick reach) fit the unobstructed
   * width, and a full standing fighter fits the unobstructed height.
   */
  private fitDistance(cam: THREE.PerspectiveCamera, sep: number): number {
    const vfov = (cam.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * cam.aspect);
    const usableH = clamp(1 - this.safe.top - this.safe.bottom * 0.55, 0.45, 1);
    const extent = sep + 1.5; // both bodies plus a leg's reach either side
    const dW = extent / 2 / Math.tan((hfov * this.safe.widthFraction) / 2);
    const dH = 2.1 / 2 / Math.tan((vfov * usableH) / 2);
    return clamp(Math.max(dW, dH), 3.2, 9);
  }

  /** Shift the projection so the focus sits in the middle of the unobstructed region. */
  private applyViewOffset(cam: THREE.PerspectiveCamera, vw: number, vh: number) {
    if (!vw || !vh) return;
    const shift = Math.round(((this.safe.bottom * 0.55 - this.safe.top) / 2) * vh);
    if (shift === this.viewY && vw === this.viewW && vh === this.viewH) return;
    this.viewY = shift;
    this.viewW = vw;
    this.viewH = vh;
    if (shift === 0) cam.clearViewOffset();
    else cam.setViewOffset(vw, vh, 0, shift, vw, vh);
  }
}
