
// ayReplayer.js
export class AYReplayer {
  constructor() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.rate = 50;        // Hz
    this.frames = [];
    this.timer = null;

    // Voies A/B/C + bruit
    this.A = this.mkVoice();
    this.B = this.mkVoice();
    this.C = this.mkVoice();
    this.Noise = this.mkNoise();
    this.env = { periodSec: 0.05, shape: 0, phase: 0, level: 0, lastUpdate: 0 };
  }

  mkVoice() {
    const osc = this.ctx.createOscillator(); osc.type = 'square'; osc.frequency.value = 440;
    const gain = this.ctx.createGain(); gain.gain.value = 0.0;
    osc.connect(gain).connect(this.ctx.destination); osc.start();
    return { osc, gain, mute: false, volUser: 1.0 };
  }

  mkNoise() {
    const bufferSize = 2 ** 14;
    const buf = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i=0;i<bufferSize;i++) d[i] = Math.random()*2 - 1;
    const src = this.ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 4000;
    const gain = this.ctx.createGain(); gain.gain.value = 0.0;
    src.connect(bp).connect(gain).connect(this.ctx.destination); src.start();
    return { src, bp, gain, volUser: 0.15 };
  }

  setUserControls({ muteA, muteB, muteC, volA, volB, volC, volN }) {
    this.A.mute = !!muteA; this.B.mute = !!muteB; this.C.mute = !!muteC;
    this.A.volUser = parseFloat(volA ?? this.A.volUser);
    this.B.volUser = parseFloat(volB ?? this.B.volUser);
    this.C.volUser = parseFloat(volC ?? this.C.volUser);
    this.Noise.volUser = parseFloat(volN ?? this.Noise.volUser);
  }

  load({ frames, rate = 50 }) {
    this.frames = frames || [];
    this.rate = rate;
  }

  play() {
    if (this.timer || this.frames.length === 0) return;
    const spf = 1 / this.rate; // seconds per frame (~20 ms @ 50 Hz)
    let i = 0;
    this.timer = setInterval(() => {
      if (i >= this.frames.length) { this.stop(); return; }
      this.applyRegs(this.frames[i++].regs);
    }, spf * 1000);
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

//   applyRegs(regs) {
//     const clock = 1000000; // Hz (approx CPC) [7](https://jtalbert.xyz/Downloads/YM_File_Operations.pdf)
//     const perA = ((regs[1] & 0x0F) << 8) | regs[0];
//     const perB = ((regs[3] & 0x0F) << 8) | regs[2];
//     const perC = ((regs[5] & 0x0F) << 8) | regs[4];
//     const fA = perA ? clock / (16 * perA) : 0.0001;
//     const fB = perB ? clock / (16 * perB) : 0.0001;
//     const fC = perC ? clock / (16 * perC) : 0.0001;

//     const noiseFreq = regs[6] & 0x1F;      // 5 bits
//     const mixer = regs[7];                 // bits: 0/1/2 = tone A/B/C off ; 3/4/5 = noise A/B/C off
//     const volA = regs[8] & 0x0F, volB = regs[9] & 0x0F, volC = regs[10] & 0x0F;

//     // Fréquences
//     this.A.osc.frequency.setValueAtTime(fA, this.ctx.currentTime);
//     this.B.osc.frequency.setValueAtTime(fB, this.ctx.currentTime);
//     this.C.osc.frequency.setValueAtTime(fC, this.ctx.currentTime);

//     // Tone on si bit mixer = 0 et volume > 0
//     const toneAOn = ((mixer & 0x01) === 0) && volA > 0 && !this.A.mute;
//     const toneBOn = ((mixer & 0x02) === 0) && volB > 0 && !this.B.mute;
//     const toneCOn = ((mixer & 0x04) === 0) && volC > 0 && !this.C.mute;

//     this.A.gain.gain.setValueAtTime(toneAOn ? (volA / 15) * this.A.volUser : 0, this.ctx.currentTime);
//     this.B.gain.gain.setValueAtTime(toneBOn ? (volB / 15) * this.B.volUser : 0, this.ctx.currentTime);
//     this.C.gain.gain.setValueAtTime(toneCOn ? (volC / 15) * this.C.volUser : 0, this.ctx.currentTime);

//     // Bruit : ouvrir si une voie bruit est active avec volume > 0
//     const noiseOn =
//       (((mixer & 0x08) === 0) && volA > 0 && !this.A.mute) ||
//       (((mixer & 0x10) === 0) && volB > 0 && !this.B.mute) ||
//       (((mixer & 0x20) === 0) && volC > 0 && !this.C.mute);
//     const nf = (noiseFreq * 200) + 1000; // simple mappage fréquentiel
//     this.Noise.bp.frequency.setValueAtTime(nf, this.ctx.currentTime);
//     this.Noise.gain.gain.setValueAtTime(noiseOn ? this.Noise.volUser : 0, this.ctx.currentTime);
//   }

  applyRegs(regs) {
    const SR = this.ctx.sampleRate;
    const clock = 1000000; // CPC approx. [5](https://jtalbert.xyz/Downloads/YM_File_Operations.pdf)

    // --- Tone periods -> frequencies (A/B/C)
    const perA = ((regs[1] & 0x0F) << 8) | regs[0];
    const perB = ((regs[3] & 0x0F) << 8) | regs[2];
    const perC = ((regs[5] & 0x0F) << 8) | regs[4];
    const fA = perA ? clock / (16 * perA) : 0.0001;
    const fB = perB ? clock / (16 * perB) : 0.0001;
    const fC = perC ? clock / (16 * perC) : 0.0001;

    // --- Noise / Mixer / Volumes
    const noiseFreq = regs[6] & 0x1F;
    const mixer = regs[7];
    const volAReg = regs[8], volBReg = regs[9], volCReg = regs[10];
    const envA = (volAReg & 0x10) !== 0, envB = (volBReg & 0x10) !== 0, envC = (volCReg & 0x10) !== 0;
    const volA = volAReg & 0x0F, volB = volBReg & 0x0F, volC = volCReg & 0x0F;

    // --- Enveloppe hardware ---
    const envPeriod = ((regs[12] << 8) | regs[11]) || 1;        // 16 bits, BE selon implémentation YM
    const envShape = regs[13] & 0x0F;                            // C/A/Alt/Hold
    // approx: période en secondes (datasheet: l’enveloppe cadence le DAC volume sur 16 niveaux)
    const periodSec = envPeriod / clock * 16 * 2;                // empirique (ajuster au besoin) [5](https://jtalbert.xyz/Downloads/YM_File_Operations.pdf)
    const now = this.ctx.currentTime;
    if (envShape !== this.env.shape || Math.abs(this.env.periodSec - periodSec) > 1e-6) {
      this.env.shape = envShape; this.env.periodSec = periodSec; this.env.phase = 0; this.env.level = 1.0;
      this.env.lastUpdate = now;
    } else {
      const dt = now - (this.env.lastUpdate || now);
      this.env.lastUpdate = now;
      this.env.phase += dt / (this.env.periodSec || 0.001);
      // convertir phase en niveau [0..1] selon la forme (simplifié)
      this.env.level = envelopeLevel(this.env.phase, this.env.shape);
    }

    // Fréquences A/B/C
    this.A.osc.frequency.setValueAtTime(fA, now);
    this.B.osc.frequency.setValueAtTime(fB, now);
    this.C.osc.frequency.setValueAtTime(fC, now);

    // Tone on si mixer=0 et volume/enveloppe > 0
    const toneAOn = ((mixer & 0x01) === 0) && (envA || volA > 0) && !this.A.mute;
    const toneBOn = ((mixer & 0x02) === 0) && (envB || volB > 0) && !this.B.mute;
    const toneCOn = ((mixer & 0x04) === 0) && (envC || volC > 0) && !this.C.mute;

    const envGainA = envA ? this.env.level : (volA / 15);
    const envGainB = envB ? this.env.level : (volB / 15);
    const envGainC = envC ? this.env.level : (volC / 15);

    this.A.gain.gain.setValueAtTime(toneAOn ? envGainA * this.A.volUser : 0, now);
    this.B.gain.gain.setValueAtTime(toneBOn ? envGainB * this.B.volUser : 0, now);
    this.C.gain.gain.setValueAtTime(toneCOn ? envGainC * this.C.volUser : 0, now);

    // Bruit
    const noiseOn =
      (((mixer & 0x08) === 0) && (envA || volA > 0) && !this.A.mute) ||
      (((mixer & 0x10) === 0) && (envB || volB > 0) && !this.B.mute) ||
      (((mixer & 0x20) === 0) && (envC || volC > 0) && !this.C.mute);
    const nf = (noiseFreq * 200) + 1000;
    this.Noise.bp.frequency.setValueAtTime(nf, now);
    this.Noise.gain.gain.setValueAtTime(noiseOn ? this.Noise.volUser : 0, now);
  }
}

// Approx. de la forme d’enveloppe (C/A/Alt/Hold) sur [0..1]
function envelopeLevel(phase, shape) {
  // AY shape bits: C(8) A(4) Alt(2) Hold(1). On simplifie en saw/tri/pulse/repeat
  const C = (shape & 8) !== 0, A = (shape & 4) !== 0, Alt = (shape & 2) !== 0, Hold = (shape & 1) !== 0;
  const p = phase % 1;
  let lvl;
  if (!Alt && !Hold && A) {        // attaque (saw up puis repeat)
    lvl = p;
  } else if (!Alt && Hold && A) {  // attaque + hold (saw up puis hold)
    lvl = Math.min(1, p*2);
  } else if (Alt && !Hold) {       // triangle alterné (up/down)
    lvl = p < 0.5 ? (p*2) : (1 - (p-0.5)*2);
  } else {                         // défaut: decay (saw down)
    lvl = 1 - p;
  }
  return Math.max(0, Math.min(1, lvl));
}