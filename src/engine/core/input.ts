/**
 * Input system (§4.5, §12): device → binding → IntentFrame → simulation.
 * Sim code only ever sees IntentFrame. Mouse deltas accumulate between fixed
 * ticks and are drained atomically in sample(). KeyboardEvent.code only.
 */

export type ActionId =
  | 'ship.pitch' | 'ship.yaw' | 'ship.roll'
  | 'ship.strafeX' | 'ship.strafeY' | 'ship.strafeZ'
  | 'ship.boost' | 'ship.allStop' | 'ship.flightAssistToggle' | 'ship.decoupleToggle'
  | 'ship.warpEngage' | 'ship.cycleTarget' | 'ship.gearToggle' | 'ship.navToggle'
  | 'ship.exitSeat' | 'foot.interact'
  | 'camera.toggleChase' | 'ui.pause';

export interface IntentFrame {
  tick: number;
  /** -1..1 (keys) or accumulated raw deltas scaled (mouse) */
  axes: Partial<Record<ActionId, number>>;
  pressed: Set<ActionId>;
  held: Set<ActionId>;
  /** raw KeyboardEvent.codes pressed this tick (dev shortcuts, map toggle) */
  codes: Set<string>;
  /** raw mouse deltas this tick (FPS look — the ship reticle uses its own path) */
  lookDX: number;
  lookDY: number;
}

interface KeyAxisBinding { neg?: string; pos?: string }

/** key axes: physical codes → -1/+1 */
const KEY_AXES: Record<string, KeyAxisBinding> = {
  'ship.strafeZ': { neg: 'KeyW', pos: 'KeyS' },   // -Z is forward
  'ship.strafeX': { neg: 'KeyA', pos: 'KeyD' },
  'ship.strafeY': { pos: 'Space', neg: 'ControlLeft' },
  'ship.roll': { neg: 'KeyE', pos: 'KeyQ' },       // roll left/right (right-hand rule about -Z fwd)
};

const KEY_ACTIONS: Record<string, ActionId> = {
  ShiftLeft: 'ship.boost',
  KeyX: 'ship.allStop',
  KeyT: 'ship.flightAssistToggle',
  KeyV: 'ship.decoupleToggle',
  KeyB: 'ship.warpEngage',
  KeyG: 'ship.cycleTarget',
  KeyN: 'ship.gearToggle',
  KeyC: 'ship.navToggle',
  KeyY: 'ship.exitSeat',
  KeyF: 'foot.interact',
  F4: 'camera.toggleChase',
  Escape: 'ui.pause',
};

export class InputSystem {
  private keys = new Set<string>();
  private pressedCodes = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  locked = false;
  /** virtual-joystick reticle offset in px (§12.3), clamped to radius */
  reticleX = 0;
  reticleY = 0;
  readonly reticleRadius = 250;

  constructor(private canvas: HTMLElement) {
    window.addEventListener('keydown', e => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressedCodes.add(e.code);
      if (e.code === 'Space' || e.code === 'ControlLeft') e.preventDefault();
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.keys.clear();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) this.keys.clear();
    });
    window.addEventListener('pointermove', e => {
      if (!this.locked) return;
      const events = (e.getCoalescedEvents?.() ?? [e]);
      for (const ev of events) {
        this.mouseDX += ev.movementX;
        this.mouseDY += ev.movementY;
      }
    });
  }

  async lock(): Promise<void> {
    if (this.locked) return;
    try {
      // unadjustedMovement: raw input (no OS accel); NotSupportedError → plain lock
      await (this.canvas.requestPointerLock as any)({ unadjustedMovement: true });
    } catch (e) {
      if ((e as DOMException)?.name === 'NotSupportedError') await this.canvas.requestPointerLock();
    }
  }

  unlock(): void {
    if (this.locked) document.exitPointerLock();
  }

  /** called once per fixed tick — drains mouse, snapshots keys */
  sample(tick: number, dt: number, recenterReticle: boolean): IntentFrame {
    const lookDX = this.mouseDX;
    const lookDY = this.mouseDY;
    // virtual joystick: mouse deltas move the reticle inside a clamped circle
    this.reticleX += this.mouseDX;
    this.reticleY += this.mouseDY;
    this.mouseDX = this.mouseDY = 0;
    const m = Math.hypot(this.reticleX, this.reticleY);
    if (m > this.reticleRadius) {
      this.reticleX *= this.reticleRadius / m;
      this.reticleY *= this.reticleRadius / m;
    }
    // recenter at 3×offset/s when FA on and no mouse input this tick
    if (recenterReticle) {
      const k = Math.min(1, 3 * dt);
      this.reticleX -= this.reticleX * k;
      this.reticleY -= this.reticleY * k;
    }

    const axes: IntentFrame['axes'] = {};
    for (const [action, b] of Object.entries(KEY_AXES)) {
      let v = 0;
      if (b.pos && this.keys.has(b.pos)) v += 1;
      if (b.neg && this.keys.has(b.neg)) v -= 1;
      axes[action as ActionId] = v;
    }
    // rates from reticle: right = +yaw? (nose −Z: yaw left is +) — sign handled in flight sim
    axes['ship.yaw'] = this.reticleX / this.reticleRadius;
    axes['ship.pitch'] = this.reticleY / this.reticleRadius;

    const pressed = new Set<ActionId>();
    const held = new Set<ActionId>();
    for (const [code, action] of Object.entries(KEY_ACTIONS)) {
      if (this.pressedCodes.has(code)) pressed.add(action);
      if (this.keys.has(code)) held.add(action);
    }
    const codes = new Set(this.pressedCodes);
    this.pressedCodes.clear();

    return { tick, axes, pressed, held, codes, lookDX, lookDY };
  }

  get hasMouseInput(): boolean {
    return this.mouseDX !== 0 || this.mouseDY !== 0;
  }
}
