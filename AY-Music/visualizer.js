
// visualizer.js
export class Visualizer {
  constructor(audioCtx, destinationNode) {
    this.ctx = audioCtx;
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;            // oscillo
    this.analyserMin = 1024;                 // spectro “rapide” (recalé par setFFTSize)
    destinationNode.connect(this.analyser);

    // Canvases
    this.oscCanvas = document.createElement('canvas');
    this.specCanvas = document.createElement('canvas');
    this.oscCanvas.width = 800; this.oscCanvas.height = 180;
    this.specCanvas.width = 800; this.specCanvas.height = 256;

    // Contexts 2D
    this.oscCtx = this.oscCanvas.getContext('2d');
    this.specCtx = this.specCanvas.getContext('2d');

    // Buffers
    this.timeData = new Uint8Array(this.analyser.fftSize);
    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);

    // Position de défilement spectrogramme
    this.specX = 0;

    // Rendu
    this._rafId = null;
    this._draw = this._draw.bind(this);
  }

  attachTo(domOscId, domSpecId) {
    const oscHost = document.getElementById(domOscId);
    const specHost = document.getElementById(domSpecId);
    oscHost.innerHTML = ''; specHost.innerHTML = '';
    oscHost.appendChild(this.oscCanvas);
    specHost.appendChild(this.specCanvas);
  }

  setFFTSize(n) {
    const size = Math.max(32, Math.min(32768, n|0));
    this.analyser.fftSize = size;
    this.timeData = new Uint8Array(this.analyser.fftSize);
    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
  }

  start() {
    if (this._rafId) return;
    this._rafId = requestAnimationFrame(this._draw);
  }
  stop() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = null;
  }

  _draw() {
    // ---- Oscilloscope ----
    this.analyser.getByteTimeDomainData(this.timeData);
    const W = this.oscCanvas.width, H = this.oscCanvas.height;
    this.oscCtx.fillStyle = '#0f1220'; this.oscCtx.fillRect(0,0,W,H);
    this.oscCtx.strokeStyle = '#77e3ff'; this.oscCtx.lineWidth = 1.2;
    this.oscCtx.beginPath();
    for (let i=0;i<this.timeData.length;i++) {
      const x = (i / (this.timeData.length - 1)) * W;
      const y = (this.timeData[i]/255) * H;
      if (i===0) this.oscCtx.moveTo(x,y); else this.oscCtx.lineTo(x,y);
    }
    this.oscCtx.stroke();

    // ---- Spectrogramme ----
    this.analyser.getByteFrequencyData(this.freqData);
    const SW = this.specCanvas.width, SH = this.specCanvas.height;
    // faire défiler vers la gauche
    const imgData = this.specCtx.getImageData(1,0,SW-1,SH);
    this.specCtx.putImageData(imgData,0,0);
    // nouvelle colonne (droite)
    for (let i=0;i<this.freqData.length;i++) {
      const mag = this.freqData[i]/255;              // 0..1
      const y = SH - 1 - Math.floor((i/this.freqData.length)*SH);
      const hue = Math.floor(255 - mag*255);         // palette simple
      this.specCtx.fillStyle = `hsl(${hue}, 100%, 50%)`;
      this.specCtx.fillRect(SW-1, y, 1, 1);
    }

    this._rafId = requestAnimationFrame(this._draw);
  }
}
