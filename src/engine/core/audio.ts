/**
 * M9 audio — fully PROCEDURAL WebAudio (no downloads; CC0-equivalent by
 * construction): reactor hum (detuned saws → lowpass), atmospheric wind
 * (noise → bandpass, gain ∝ q_dyn), warp/hyper whooshes, UI blips, thuds.
 * Created after the boot click (autoplay policy satisfied by construction).
 */
export class AudioEngine {
  private ctx: AudioContext;
  private master: GainNode;
  private humGain: GainNode;
  private humFilter: BiquadFilterNode;
  private humOsc1: OscillatorNode;
  private windGain: GainNode;
  private enabled = true;

  constructor() {
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);

    // reactor hum: two detuned saws through a low lowpass
    this.humOsc1 = this.ctx.createOscillator();
    const humOsc2 = this.ctx.createOscillator();
    this.humOsc1.type = 'sawtooth';
    humOsc2.type = 'sawtooth';
    this.humOsc1.frequency.value = 42;
    humOsc2.frequency.value = 42 * 1.007;
    this.humFilter = this.ctx.createBiquadFilter();
    this.humFilter.type = 'lowpass';
    this.humFilter.frequency.value = 160;
    this.humGain = this.ctx.createGain();
    this.humGain.gain.value = 0.0;
    this.humOsc1.connect(this.humFilter);
    humOsc2.connect(this.humFilter);
    this.humFilter.connect(this.humGain);
    this.humGain.connect(this.master);
    this.humOsc1.start();
    humOsc2.start();

    // wind: looped noise buffer through a bandpass
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let seed = 1234567;
    for (let i = 0; i < len; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      d[i] = (seed / 0x3fffffff - 1) * 0.7;
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 420;
    bp.Q.value = 0.6;
    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0;
    noise.connect(bp);
    bp.connect(this.windGain);
    this.windGain.connect(this.master);
    noise.start();

    void this.ctx.resume();
  }

  /** per frame: throttle 0..1, qDyn Pa, warpFactor 0..1 */
  update(throttle: number, qDyn: number, warpFactor: number): void {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    this.humGain.gain.setTargetAtTime(0.05 + throttle * 0.22 + warpFactor * 0.25, t, 0.1);
    this.humOsc1.frequency.setTargetAtTime(42 + throttle * 40 + warpFactor * 90, t, 0.15);
    this.humFilter.frequency.setTargetAtTime(160 + throttle * 400 + warpFactor * 900, t, 0.1);
    this.windGain.gain.setTargetAtTime(Math.min(0.5, qDyn / 20_000), t, 0.15);
  }

  /** short synthesized events */
  event(kind: 'warpEnter' | 'warpExit' | 'thud' | 'gear' | 'ui' | 'jump'): void {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const g = this.ctx.createGain();
    g.connect(this.master);
    const o = this.ctx.createOscillator();
    o.connect(g);
    switch (kind) {
      case 'warpEnter':
      case 'jump':
        o.type = 'sine';
        o.frequency.setValueAtTime(80, t);
        o.frequency.exponentialRampToValueAtTime(kind === 'jump' ? 900 : 500, t + 1.2);
        g.gain.setValueAtTime(0.3, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
        o.start(t); o.stop(t + 1.5);
        break;
      case 'warpExit':
        o.type = 'sine';
        o.frequency.setValueAtTime(600, t);
        o.frequency.exponentialRampToValueAtTime(60, t + 0.8);
        g.gain.setValueAtTime(0.35, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
        o.start(t); o.stop(t + 1.1);
        break;
      case 'thud':
        o.type = 'sine';
        o.frequency.setValueAtTime(70, t);
        o.frequency.exponentialRampToValueAtTime(30, t + 0.25);
        g.gain.setValueAtTime(0.6, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        o.start(t); o.stop(t + 0.35);
        break;
      case 'gear':
        o.type = 'square';
        o.frequency.setValueAtTime(140, t);
        g.gain.setValueAtTime(0.12, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
        o.start(t); o.stop(t + 0.15);
        break;
      case 'ui':
        o.type = 'sine';
        o.frequency.setValueAtTime(880, t);
        g.gain.setValueAtTime(0.08, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
        o.start(t); o.stop(t + 0.1);
        break;
    }
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    this.master.gain.value = this.enabled ? 0.5 : 0;
    return this.enabled;
  }
}
