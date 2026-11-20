// Offline Web Audio API + MP3 ovoz tizimi (telefon dinamiklarida baland va aniq eshitiladi)
export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.engineOsc1 = null;
    this.engineOsc2 = null;
    this.engineGain = null;
    this.engineFilter = null;
    this.radioAudio = null;
    this.radioOn = false;
    this.radioBeatTimer = null;
    this._bindGlobalUnlock();
  }

  _bindGlobalUnlock() {
    const unlockFn = () => this.unlock();
    ['touchstart', 'touchend', 'pointerdown', 'click'].forEach((ev) => {
      window.addEventListener(ev, unlockFn, { passive: true });
    });
  }

  unlock() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!this.ctx) {
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().then(() => this._initEngineLoop()).catch(() => {});
    } else {
      this._initEngineLoop();
    }
  }

  _initEngineLoop() {
    if (!this.ctx || this.engineOsc1) return;
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    // Telefon dinamiklarida aniq eshitiladigan chastotalar (110Hz - 360Hz)
    osc1.type = 'sawtooth';
    osc1.frequency.value = 115;
    osc2.type = 'triangle';
    osc2.frequency.value = 230;

    filter.type = 'lowpass';
    filter.frequency.value = 420;
    gain.gain.value = 0.0;

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);

    osc1.start();
    osc2.start();

    this.engineOsc1 = osc1;
    this.engineOsc2 = osc2;
    this.engineFilter = filter;
    this.engineGain = gain;
  }

  updateEngine(speedAbs, maxSpeed, isDriving, isGas) {
    if (!this.ctx || !this.engineOsc1 || !this.engineGain) return;
    const now = this.ctx.currentTime;
    if (!isDriving) {
      this.engineGain.gain.setTargetAtTime(0, now, 0.06);
      return;
    }
    const ratio = Math.min(1, speedAbs / Math.max(1, maxSpeed));
    const f1 = 110 + ratio * 210 + (isGas ? 28 : 0);
    const f2 = f1 * 1.98;
    const targetFilter = 380 + ratio * 1100;
    const targetVol = 0.16 + ratio * 0.16 + (isGas ? 0.05 : 0);

    this.engineOsc1.frequency.setTargetAtTime(f1, now, 0.05);
    this.engineOsc2.frequency.setTargetAtTime(f2, now, 0.05);
    this.engineFilter.frequency.setTargetAtTime(targetFilter, now, 0.06);
    this.engineGain.gain.setTargetAtTime(targetVol, now, 0.06);
  }

  playHorn() {
    this.unlock();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    [390, 495].forEach((freq) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.01, now);
      gain.gain.linearRampToValueAtTime(0.26, now + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.36);
    });
  }

  playCrash(strength = 1) {
    this.unlock();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(48, now + 0.25);
    gain.gain.setValueAtTime(Math.min(0.42, 0.22 * strength), now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.3);
  }

  playDoor() {
    this.unlock();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(260, now);
    osc.frequency.exponentialRampToValueAtTime(95, now + 0.09);
    gain.gain.setValueAtTime(0.28, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.12);
  }

  playFootstep() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(68, now + 0.05);
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.07);
  }

  setRadioTracks(mp3Url) {
    if (mp3Url) {
      this.radioAudio = new Audio(mp3Url);
      this.radioAudio.loop = true;
      this.radioAudio.volume = 0.75;
    }
  }

  toggleRadio(forceState = null) {
    this.unlock();
    this.radioOn = forceState !== null ? forceState : !this.radioOn;
    if (this.radioOn) {
      if (this.radioAudio) {
        this.radioAudio.play().catch(() => this._startSynthBeat());
      } else {
        this._startSynthBeat();
      }
    } else {
      if (this.radioAudio) this.radioAudio.pause();
      this._stopSynthBeat();
    }
    return this.radioOn;
  }

  _startSynthBeat() {
    if (this.radioBeatTimer || !this.ctx) return;
    let step = 0;
    const bassNotes = [110, 110, 130.8, 146.8, 110, 110, 164.8, 130.8];
    this.radioBeatTimer = setInterval(() => {
      if (!this.radioOn || !this.ctx) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = step % 2 === 0 ? 'sawtooth' : 'triangle';
      osc.frequency.setValueAtTime(bassNotes[step % bassNotes.length], now);
      gain.gain.setValueAtTime(0.22, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.24);
      step++;
    }, 250);
  }

  _stopSynthBeat() {
    if (this.radioBeatTimer) {
      clearInterval(this.radioBeatTimer);
      this.radioBeatTimer = null;
    }
  }
}
