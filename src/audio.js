// Every sound is synthesised with Web Audio: no files to download.
// Off by default. The AudioContext is only created on the user's first
// explicit "sound on", which also satisfies autoplay policies.
import { smoothstep } from './depth.js';

export class Sound {
  constructor() {
    this.enabled = false;
    this.ctx = null;
    this._nextCreak = 0;
  }

  async setEnabled(on) {
    this.enabled = on;
    if (on && !this.ctx) this._build();
    if (!this.ctx) return;
    if (on) await this.ctx.resume();
    this.master.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.15);
  }

  _build() {
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) {
      // Brown-ish noise: smoother, more "water" than white.
      b = (b + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = b * 3.5;
    }
    const loopNoise = (freq, type = 'lowpass', q = 0.7) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      src.playbackRate.value = 0.7 + Math.random() * 0.6;
      const f = ctx.createBiquadFilter();
      f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(this.master);
      src.start();
      return { g, f };
    };

    this.waves = loopNoise(900);          // surface wash
    this.rumble = loopNoise(160);         // pressure-hull ambience at depth
    // Life-support / thruster hum.
    this.hum = ctx.createGain();
    this.hum.gain.value = 0;
    const humF = ctx.createBiquadFilter();
    humF.type = 'lowpass'; humF.frequency.value = 220;
    [55, 110.4, 164.7].forEach((fr, i) => {
      const o = ctx.createOscillator();
      o.type = i ? 'sine' : 'sawtooth';
      o.frequency.value = fr;
      const g = ctx.createGain();
      g.gain.value = i ? 0.12 : 0.05;
      o.connect(g).connect(humF);
      o.start();
    });
    humF.connect(this.hum).connect(this.master);

    // Shared echo for pings.
    this.echo = ctx.createDelay(1.5);
    this.echo.delayTime.value = 0.34;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const echoF = ctx.createBiquadFilter();
    echoF.type = 'lowpass'; echoF.frequency.value = 1800;
    this.echo.connect(echoF).connect(fb).connect(this.echo);
    echoF.connect(this.master);
  }

  ping(level = 1) {
    if (!this.enabled || !this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(1320, t);
    o.frequency.exponentialRampToValueAtTime(1180, t + 1.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.22 * level, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    o.connect(g);
    g.connect(this.master);
    g.connect(this.echo);
    o.start(t);
    o.stop(t + 1.7);
  }

  // Hull under load: a low groan plus a filtered crack.
  creak(k) {
    if (!this.enabled || !this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const dur = 0.6 + Math.random() * 1.4;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const f0 = 38 + Math.random() * 40;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.linearRampToValueAtTime(f0 * (0.7 + Math.random() * 0.6), t + dur);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 180 + Math.random() * 260; bp.Q.value = 6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.35 * k, t + 0.08);
    g.gain.setValueAtTime(0.3 * k, t + dur * 0.7);
    g.gain.linearRampToValueAtTime(0, t + dur);
    // Tremolo gives it the "stick-slip" texture of metal under stress.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 9 + Math.random() * 16;
    const lg = ctx.createGain();
    lg.gain.value = 0.15 * k;
    lfo.connect(lg).connect(g.gain);
    o.connect(bp).connect(g).connect(this.master);
    o.start(t); lfo.start(t);
    o.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);

    if (Math.random() < 0.5) {
      const n = ctx.createBufferSource();
      n.buffer = this.noise;
      const hp = ctx.createBiquadFilter();
      hp.type = 'bandpass'; hp.frequency.value = 900 + Math.random() * 1200; hp.Q.value = 3;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.5 * k, t);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      n.connect(hp).connect(ng).connect(this.master);
      n.start(t, Math.random());
      n.stop(t + 0.15);
    }
  }

  chime() {
    if (!this.enabled || !this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.value = [1568, 1760, 2093, 2349, 2637][Math.floor(Math.random() * 5)];
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.025, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    o.connect(g).connect(this.master);
    g.connect(this.echo);
    o.start(t);
    o.stop(t + 1.3);
  }

  whoosh(seconds) {
    if (!this.enabled || !this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = ctx.createBufferSource();
    n.buffer = this.noise; n.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(120, t);
    f.frequency.exponentialRampToValueAtTime(2400, t + seconds);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.6);
    g.gain.linearRampToValueAtTime(0.4, t + seconds - 0.8);
    g.gain.linearRampToValueAtTime(0, t + seconds + 0.4);
    n.connect(f).connect(g).connect(this.master);
    n.start(t);
    n.stop(t + seconds + 0.5);
  }

  // Called every frame with the master depth value.
  update(depth, time) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    const silence = 1 - smoothstep(10800, 10930, depth); // the bottom is silent
    const surf = 1 - smoothstep(0, 12, depth);
    const swell = 0.6 + 0.4 * Math.sin(time * 0.7) * Math.sin(time * 0.23);
    this.waves.g.gain.setTargetAtTime(0.5 * surf * swell, t, 0.1);
    this.waves.f.frequency.setTargetAtTime(depth < 1 ? 1100 : 350, t, 0.2);
    this.rumble.g.gain.setTargetAtTime((0.25 + smoothstep(0, 4000, depth) * 0.45) * smoothstep(0, 20, depth) * silence, t, 0.3);
    this.rumble.f.frequency.setTargetAtTime(220 - smoothstep(0, 10935, depth) * 140, t, 0.3);
    this.hum.gain.setTargetAtTime(0.18 * silence * (1 - surf * 0.5), t, 0.3);

    // Hull creaks: from the trench rim, getting more frequent near the bottom.
    const k = smoothstep(6000, 10500, depth) * silence;
    if (k > 0.02 && time > this._nextCreak) {
      this.creak(0.4 + k * 0.6);
      this._nextCreak = time + (6 - k * 4.5) * (0.5 + Math.random());
    }
  }
}
