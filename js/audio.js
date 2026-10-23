/* Thunder Skies - tiny procedural soundscape */
(function (global) {
  'use strict';
  const TS = global.TS = global.TS || {};
  const U = TS.Utils;

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.ready = false;
      this.muted = TS.Settings.muted;
      this.engineType = 'prop';
      this.nodes = null;
      this.lastBeep = 0;
    }

    init() {
      if (this.ready) {
        if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : .5;
        this.master.connect(this.ctx.destination);
        this.buildNoiseBuffers();
        this.buildEngine();
        this.buildGun();
        this.ready = true;
      } catch (e) {
        this.ready = false;
      }
    }

    buildNoiseBuffers() {
      const ctx = this.ctx;
      const len = Math.floor(ctx.sampleRate * 2);
      this.noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

      // looping gunfire texture
      const gLen = Math.floor(ctx.sampleRate * .55);
      const g = ctx.createBuffer(1, gLen, ctx.sampleRate);
      const gd = g.getChannelData(0);
      for (let i = 0; i < gLen; i++) {
        const local = i / ctx.sampleRate;
        const pulse = (local % .085);
        const env = Math.exp(-pulse * 45);
        gd[i] = (Math.random() * 2 - 1) * env;
      }
      this.gunBuffer = g;
    }

    buildEngine() {
      const ctx = this.ctx;
      const out = ctx.createGain();
      out.gain.value = 0;
      out.connect(this.master);

      const low = ctx.createOscillator();
      low.type = 'sawtooth';
      low.frequency.value = 54;
      const lowGain = ctx.createGain();
      lowGain.gain.value = .16;
      const lowFilter = ctx.createBiquadFilter();
      lowFilter.type = 'lowpass';
      lowFilter.frequency.value = 240;
      low.connect(lowGain).connect(lowFilter).connect(out);

      const high = ctx.createOscillator();
      high.type = 'triangle';
      high.frequency.value = 190;
      const highGain = ctx.createGain();
      highGain.gain.value = .035;
      high.connect(highGain).connect(out);

      const noise = ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      noise.loop = true;
      const noiseFilter = ctx.createBiquadFilter();
      noiseFilter.type = 'bandpass';
      noiseFilter.frequency.value = 680;
      noiseFilter.Q.value = .9;
      const noiseGain = ctx.createGain();
      noiseGain.gain.value = .025;
      noise.connect(noiseFilter).connect(noiseGain).connect(out);
      low.start(); high.start(); noise.start();

      this.nodes = { out, low, high, lowFilter, noiseFilter, noiseGain };
    }

    buildGun() {
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      src.buffer = this.gunBuffer;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 750;
      filter.Q.value = .7;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(this.master);
      src.start();
      this.gun = { src, gain, filter, on: false };
    }

    setMuted(m) {
      this.muted = !!m;
      if (this.master && this.ctx) {
        this.master.gain.setTargetAtTime(this.muted ? 0 : .5, this.ctx.currentTime, .03);
      }
    }

    setEngineType(type) {
      this.engineType = type;
      if (!this.nodes) return;
      const t = this.ctx.currentTime;
      const jet = type === 'jet';
      this.nodes.low.frequency.setTargetAtTime(jet ? 72 : 45, t, .3);
      this.nodes.high.frequency.setTargetAtTime(jet ? 420 : 155, t, .3);
      this.nodes.lowFilter.frequency.setTargetAtTime(jet ? 420 : 230, t, .3);
      this.nodes.noiseFilter.frequency.setTargetAtTime(jet ? 1100 : 600, t, .3);
      this.nodes.noiseGain.gain.setTargetAtTime(jet ? .055 : .028, t, .3);
    }

    updateEngine(rpm, boost, speed, alive) {
      if (!this.ready || !this.nodes) return;
      const t = this.ctx.currentTime;
      const jet = this.engineType === 'jet';
      const targetGain = alive ? U.clamp(.13 + rpm * .22 + boost * .1, 0, .48) : 0;
      this.nodes.out.gain.setTargetAtTime(targetGain, t, .1);
      this.nodes.low.frequency.setTargetAtTime((jet ? 74 : 43) + rpm * (jet ? 34 : 28), t, .15);
      this.nodes.high.frequency.setTargetAtTime((jet ? 400 : 145) + rpm * 160, t, .15);
    }

    setGunFiring(on) {
      if (!this.ready || !this.gun) return;
      if (this.gun.on === !!on) return;
      this.gun.on = !!on;
      this.gun.gain.gain.setTargetAtTime(on ? .18 : 0, this.ctx.currentTime, .012);
    }

    gunShot() { this.setGunFiring(true); }

    beep(freq = 880, dur = .06, vol = .045, type = 'square') {
      if (!this.ready) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(.0001, t + dur);
      osc.connect(g).connect(this.master);
      osc.start(t); osc.stop(t + dur + .02);
    }

    lockBeep(urgent) {
      if (!this.ready) return;
      const now = this.ctx.currentTime;
      if (now - this.lastBeep < (urgent ? .35 : .85)) return;
      this.lastBeep = now;
      this.beep(urgent ? 1160 : 820, urgent ? .08 : .045, .055, urgent ? 'square' : 'sine');
    }

    click() { this.beep(520, .03, .025, 'triangle'); }

    missileLaunch() {
      if (!this.ready) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(300, t);
      filter.frequency.exponentialRampToValueAtTime(2800, t + .45);
      const g = ctx.createGain();
      g.gain.setValueAtTime(.15, t);
      g.gain.exponentialRampToValueAtTime(.0001, t + .55);
      src.connect(filter).connect(g).connect(this.master);
      src.start(t); src.stop(t + .6);
    }

    explosion(scale = 1) {
      if (!this.ready) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.playbackRate.value = .7;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(900, t);
      filter.frequency.exponentialRampToValueAtTime(100, t + .8);
      const g = ctx.createGain();
      g.gain.setValueAtTime(.32 * scale, t);
      g.gain.exponentialRampToValueAtTime(.0001, t + 1.2);
      src.connect(filter).connect(g).connect(this.master);
      src.start(t); src.stop(t + 1.3);

      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(100 * scale, t);
      osc.frequency.exponentialRampToValueAtTime(30, t + .65);
      const og = ctx.createGain();
      og.gain.setValueAtTime(.16 * scale, t);
      og.gain.exponentialRampToValueAtTime(.0001, t + .8);
      osc.connect(og).connect(this.master);
      osc.start(t); osc.stop(t + .85);
    }

    pop() {
      if (!this.ready) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 1200;
      const g = ctx.createGain();
      g.gain.setValueAtTime(.035, t);
      g.gain.exponentialRampToValueAtTime(.0001, t + .12);
      src.connect(f).connect(g).connect(this.master);
      src.start(t); src.stop(t + .14);
    }

    missileWarning() { this.beep(1450, .13, .08, 'sawtooth'); }
  }

  TS.Audio = new AudioEngine();
})(window);
