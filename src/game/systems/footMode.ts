/**
 * On-foot mode (§11) — Rapier KinematicCharacterController in a LOCAL TANGENT
 * FRAME anchored to the planet surface (origin = ground under the ship,
 * +Y = radial up, X/Z = tangent plane). The frame is body-fixed, so walking
 * inherits the planet's rail motion + spin via the anchor. Within the ~240 m
 * walkable bubble, sphere curvature is sampled INTO the heightfield, so the
 * ground is exact; the spec's per-tick spherical-up re-anchoring becomes
 * relevant only for km-scale treks (future EVA work).
 *
 * Spec §11 numbers: capsule r 0.3 / halfHeight 0.6 (1.8 m), offset 0.01,
 * autostep 0.4/0.2, snapToGround 0.4 (off while ascending), slopes 45°/30°,
 * walk 2.5 / sprint 6.0 m/s, accel 1−exp(−10dt), jump v = √(2·g_ref·1 m)
 * kept constant across bodies (floaty low-g) capped at 4 m equivalent.
 */
import RAPIER from '@dimforge/rapier3d-compat';

export interface FootInput {
  moveX: number;   // -1..1 strafe (right +)
  moveZ: number;   // -1..1 forward (+)
  sprint: boolean;
  jump: boolean;
  lookDX: number;  // raw mouse counts this tick
  lookDY: number;
}

export interface ShipColliderBox {
  pos: [number, number, number];        // local frame, m
  halfExtents: [number, number, number];
}

const GRID = 95;          // heightfield cells per side
const SPAN = 240;         // m walkable bubble
const EYE = 1.62;
const WALK = 2.5;
const SPRINT = 6.0;
const AIR_CONTROL = 0.25;
const JUMP_V = 4.43;      // 1 m at 9.81; constant across bodies (§11)
const MAX_JUMP_H = 4;     // clamp equivalent height on low-g worlds
const SENS = 0.0022;      // rad per mouse count

let rapierReady: Promise<void> | null = null;
export function initRapier(): Promise<void> {
  if (!rapierReady) rapierReady = RAPIER.init() as unknown as Promise<void>;
  return rapierReady;
}

export class FootMode {
  private world: RAPIER.World;
  private body: RAPIER.RigidBody;
  private collider: RAPIER.Collider;
  private cc: RAPIER.KinematicCharacterController;
  private verticalVel = 0;
  private velX = 0;
  private velZ = 0;
  /** view yaw (rad, about +Y) and pitch (rad) */
  yaw = 0;
  pitch = 0;
  grounded = false;

  constructor(
    private g: number,
    heightAt: (x: number, z: number) => number,
    shipBoxes: ShipColliderBox[],
    spawn: [number, number, number],
    private jumpSpeed = Math.min(JUMP_V, Math.sqrt(2 * g * MAX_JUMP_H)),
  ) {
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 }); // gravity is manual (KCC)
    this.world.timestep = 1 / 60;

    // terrain heightfield: (GRID+1)² samples, column-major, spanning SPAN×SPAN
    const n = GRID;
    const heights = new Float32Array((n + 1) * (n + 1));
    for (let c = 0; c <= n; c++) {
      for (let r = 0; r <= n; r++) {
        const x = (c / n - 0.5) * SPAN;
        const z = (r / n - 0.5) * SPAN;
        heights[c * (n + 1) + r] = heightAt(x, z);
      }
    }
    this.world.createCollider(
      RAPIER.ColliderDesc.heightfield(n, n, heights, { x: SPAN, y: 1, z: SPAN }),
    );
    for (const b of shipBoxes) {
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(...b.halfExtents).setTranslation(...b.pos),
      );
    }

    this.body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(...spawn),
    );
    this.collider = this.world.createCollider(RAPIER.ColliderDesc.capsule(0.6, 0.3), this.body);
    this.cc = this.world.createCharacterController(0.01);
    this.cc.setUp({ x: 0, y: 1, z: 0 });
    this.cc.setMaxSlopeClimbAngle((45 * Math.PI) / 180);
    this.cc.setMinSlopeSlideAngle((30 * Math.PI) / 180);
    this.cc.enableAutostep(0.4, 0.2, true);
    this.cc.enableSnapToGround(0.4);
    this.cc.setSlideEnabled(true);
  }

  /** fixed 60 Hz step; returns nothing — read position/eye after */
  step(dt: number, input: FootInput): void {
    // look
    this.yaw -= input.lookDX * SENS;
    this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch - input.lookDY * SENS));

    // planar velocity: exponential approach to target in the yaw frame
    const target = Math.hypot(input.moveX, input.moveZ) > 0 ? (input.sprint ? SPRINT : WALK) : 0;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // forward = -Z rotated by yaw
    const dirX = (input.moveX * cos - input.moveZ * sin);
    const dirZ = (-input.moveZ * cos - input.moveX * sin);
    const norm = Math.hypot(dirX, dirZ) || 1;
    const k = 1 - Math.exp(-(this.grounded ? 10 : 10 * AIR_CONTROL) * dt);
    this.velX += (dirX / norm * target - this.velX) * k;
    this.velZ += (dirZ / norm * target - this.velZ) * k;

    // gravity + jump (§11: snap off while ascending)
    if (this.grounded && input.jump) {
      this.verticalVel = this.jumpSpeed;
      this.cc.disableSnapToGround();
    }
    this.verticalVel -= this.g * dt;
    if (this.grounded && this.verticalVel < 0) this.verticalVel = -0.5;
    if (this.verticalVel <= 0) this.cc.enableSnapToGround(0.4);
    this.verticalVel = Math.max(this.verticalVel, -50);

    const desired = {
      x: this.velX * dt,
      y: this.verticalVel * dt,
      z: this.velZ * dt,
    };
    this.cc.computeColliderMovement(this.collider, desired);
    this.grounded = this.cc.computedGrounded();
    const mv = this.cc.computedMovement();
    const p = this.body.translation();
    this.body.setNextKinematicTranslation({ x: p.x + mv.x, y: p.y + mv.y, z: p.z + mv.z });
    this.world.step();
  }

  /** capsule center, local frame */
  get position(): { x: number; y: number; z: number } {
    return this.body.translation();
  }

  /** eye point, local frame */
  get eye(): { x: number; y: number; z: number } {
    const p = this.body.translation();
    return { x: p.x, y: p.y - 0.9 + EYE, z: p.z }; // capsule center is 0.9 above feet
  }

  get speed(): number {
    return Math.hypot(this.velX, this.velZ);
  }

  dispose(): void {
    this.world.free();
  }
}
