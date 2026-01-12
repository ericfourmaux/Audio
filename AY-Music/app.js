
import { loadAndParse } from './ymAyParser.js';
import { AYReplayer } from './ayReplayer.js';
import { Visualizer } from './visualizer.js';

const ui = {
  file: document.getElementById('fileInput'),
  load: document.getElementById('loadBtn'),
  meta: document.getElementById('meta'),
  status: document.getElementById('status'),
  play: document.getElementById('playBtn'),
  stop: document.getElementById('stopBtn'),
  muteA: document.getElementById('muteA'),
  muteB: document.getElementById('muteB'),
  muteC: document.getElementById('muteC'),
  volA: document.getElementById('volA'),
  volB: document.getElementById('volB'),
  volC: document.getElementById('volC'),
  volN: document.getElementById('volN')
};

const replayer = new AYReplayer();

// Visualizer branché sur la destination
const viz = new Visualizer(replayer.ctx, replayer.ctx.destination);
viz.attachTo('oscHost', 'specHost');
viz.setFFTSize(2048);
viz.start();

// Scheduler lookahead (remplace setInterval “brut”)
let lookaheadId = null;
let frameIdx = 0;
let frameRate = 50;
function startFrames(frames, rate = 50) {
  stopFrames();
  frameIdx = 0; frameRate = rate;
  const spf = 1 / frameRate;                   // ~20 ms
  let nextTime = replayer.ctx.currentTime;
  const ahead = 0.08;                          // 80 ms
  lookaheadId = setInterval(() => {
    while (nextTime < replayer.ctx.currentTime + ahead) {
      if (frameIdx >= frames.length) { stopFrames(); break; }
      const regs = frames[frameIdx++].regs;
      // Applique immédiatement (dans ayReplayer, les params sont posés à currentTime)
      replayer.applyRegs(regs);
      nextTime += spf;
    }
  }, 25);
}
function stopFrames() { if (lookaheadId) { clearInterval(lookaheadId); lookaheadId=null; } }

// Chargement
ui.load.onclick = async () => {
  const f = ui.file.files?.[0];
  if (!f) return alert('Choisis un fichier .YM, .LHA/.LZH (YM interne) ou .AY');
  try {
    const { meta, frames } = await loadAndParse(f);
    replayer.load({ frames, rate: meta.rate || 50 });
    ui.meta.textContent = `Version: ${meta.version} • Frames: ${meta.frames} • Taux: ${meta.rate || 50} Hz`;
    ui.status.textContent = 'Prêt.';
  } catch (e) {
    // AY direct (ZXAYEMUL) non supporté : proposer lib ou conversion
    if (/ZXAYEMUL/.test(e.message)) {
      ui.status.textContent = 'AY détecté — essaye la conversion vers YM via Project AY (AYMakeR) ou active AYSir.';
      // Optionnel : AyBackendAysir.tryPlayAY(f)
    } else { ui.status.textContent = ''; }
    alert(e.message);
  }
};

// Play/Stop (avec lookahead)
ui.play.onclick = async () => {
  try { await replayer.ctx.resume(); } catch {}
  replayer.setUserControls({
    muteA: ui.muteA.checked, muteB: ui.muteB.checked, muteC: ui.muteC.checked,
    volA: ui.volA.value, volB: ui.volB.value, volC: ui.volC.value, volN: ui.volN.value
  });
  startFrames(replayer.frames, replayer.rate);
  ui.status.textContent = 'Lecture…';
};
ui.stop.onclick = () => { stopFrames(); ui.status.textContent = 'Arrêté.'; };

// Sliders live
['muteA','muteB','muteC','volA','volB','volC','volN'].forEach(id => {
  ui[id].addEventListener('input', () => {
    replayer.setUserControls({
      muteA: ui.muteA.checked, muteB: ui.muteB.checked, muteC: ui.muteC.checked,
      volA: ui.volA.value, volB: ui.volB.value, volC: ui.volC.value, volN: ui.volN.value
    });
  });
});

ui.load.onclick = async () => {
  const f = ui.file.files?.[0];
  if (!f) return alert('Choisis un fichier .YM, .LHA/.LZH (YM interne) ou .AY');
  try {
    const { meta, frames } = await loadAndParse(f);
    replayer.load({ frames, rate: meta.rate || 50 });
    ui.meta.textContent = `Version: ${meta.version} • Frames: ${meta.frames} • Taux: ${meta.rate || 50} Hz`;
    ui.status.textContent = 'Prêt.';
  } catch (e) {
    ui.status.textContent = '';
    alert(e.message);
  }
};

ui.play.onclick = async () => {
  try { await replayer.ctx.resume(); } catch {}
  // mettre à jour contrôles utilisateur
  replayer.setUserControls({
    muteA: ui.muteA.checked, muteB: ui.muteB.checked, muteC: ui.muteC.checked,
    volA: ui.volA.value, volB: ui.volB.value, volC: ui.volC.value, volN: ui.volN.value
  });
  replayer.play();
  ui.status.textContent = 'Lecture…';
};

ui.stop.onclick = () => {
  replayer.stop();
  ui.status.textContent = 'Arrêté.';
};

// Live update des sliders
['muteA','muteB','muteC','volA','volB','volC','volN'].forEach(id => {
  ui[id].addEventListener('input', () => {
    replayer.setUserControls({
      muteA: ui.muteA.checked, muteB: ui.muteB.checked, muteC: ui.muteC.checked,
      volA: ui.volA.value, volB: ui.volB.value, volC: ui.volC.value, volN: ui.volN.value
    });
  });
});
