import { describe, expect, it } from 'vitest';
import { Autoland } from './autoland';

const DT = 1 / 60;

/** 1-D radial point-mass sim with gravity, driven by the autoland command */
function simulate(o: {
  alt0: number; vr0: number; vh0?: number; g: number; maxAccel?: number; maxSeconds?: number;
}) {
  const auto = new Autoland();
  auto.engage();
  let alt = o.alt0, vr = o.vr0, vh = o.vh0 ?? 0;
  let t = 0;
  let minAlt = alt;
  let touchdownVr = NaN;
  let gearDownAlt = NaN;
  let sawDust = false;
  const maxT = o.maxSeconds ?? 240;
  while (t < maxT) {
    const cmd = auto.step(DT, {
      altAGL: alt, vRadial: vr,
      vHorizX: vh, vHorizY: 0, vHorizZ: 0,
      gravity: o.g, maxAccel: o.maxAccel ?? 50,
    });
    if (auto.state === 'LANDED') { touchdownVr = vr; break; }
    if (cmd.gearDown && Number.isNaN(gearDownAlt)) gearDownAlt = alt;
    if (cmd.dust > 0.3) sawDust = true;
    vr += (cmd.aRadial - o.g) * DT;
    vh += cmd.aHorizX * DT;
    alt += vr * DT;
    minAlt = Math.min(minAlt, alt);
    t += DT;
  }
  return { auto, alt, vr, vh, t, minAlt, touchdownVr, gearDownAlt, sawDust };
}

describe('Autoland state machine', () => {
  it('lands from 1 km on Mars gravity: soft touchdown, gear beat, dust beat', () => {
    const r = simulate({ alt0: 1000, vr0: 0, g: 3.71 });
    expect(r.auto.state).toBe('LANDED');
    expect(Math.abs(r.touchdownVr)).toBeLessThan(3.2);   // soft
    expect(r.minAlt).toBeGreaterThan(-0.5);              // never dug in
    expect(r.gearDownAlt).toBeLessThanOrEqual(500);      // gear on FINAL
    expect(r.gearDownAlt).toBeGreaterThan(3);
    expect(r.sawDust).toBe(true);                        // dust kicked below 50 m
    expect(r.t).toBeLessThan(120);
  });

  it('recovers a hot approach (−45 m/s at 300 m) without impact', () => {
    const r = simulate({ alt0: 300, vr0: -45, g: 3.71 });
    expect(r.auto.state).toBe('LANDED');
    expect(Math.abs(r.touchdownVr)).toBeLessThan(3.2);
    expect(r.minAlt).toBeGreaterThan(-0.5);
  });

  it('kills horizontal velocity before touchdown', () => {
    const r = simulate({ alt0: 800, vr0: 0, vh0: 40, g: 3.71 });
    expect(r.auto.state).toBe('LANDED');
    expect(Math.abs(r.vh)).toBeLessThan(3);
  });

  it('works under Earth gravity within thruster authority', () => {
    const r = simulate({ alt0: 1500, vr0: -20, g: 9.81 });
    expect(r.auto.state).toBe('LANDED');
    expect(Math.abs(r.touchdownVr)).toBeLessThan(3.2);
  });

  it('descent rate is capped at 55 m/s from high altitude', () => {
    const auto = new Autoland();
    auto.engage();
    let alt = 20_000, vr = 0;
    let maxSink = 0;
    for (let t = 0; t < 90; t += DT) {
      const cmd = auto.step(DT, { altAGL: alt, vRadial: vr, vHorizX: 0, vHorizY: 0, vHorizZ: 0, gravity: 3.71, maxAccel: 50 });
      vr += (cmd.aRadial - 3.71) * DT;
      alt += vr * DT;
      maxSink = Math.max(maxSink, -vr);
    }
    expect(maxSink).toBeLessThan(62); // 55 target + controller overshoot margin
    expect(maxSink).toBeGreaterThan(45);
  });

  it('is idle until engaged and cancellable', () => {
    const auto = new Autoland();
    const cmd = auto.step(DT, { altAGL: 100, vRadial: -10, vHorizX: 0, vHorizY: 0, vHorizZ: 0, gravity: 3.71, maxAccel: 50 });
    expect(cmd.aRadial).toBe(0);
    auto.engage();
    expect(auto.state).toBe('DESCEND');
    auto.cancel();
    expect(auto.state).toBe('IDLE');
  });
});
