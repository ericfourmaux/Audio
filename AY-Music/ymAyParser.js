
// ymAyParser.js
export async function loadAndParse(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const name = file.name.toLowerCase();

  // 1) Si LHA/LZH -> extraire .YM
  let ymBytes = bytes;
  if (name.endsWith('.lzh') || name.endsWith('.lha')) {
    const entries = LHA.read(bytes);                    // lib lha.js (navigateur) [5](https://github.com/kyz/lha.js/wiki)
    const ymEntry = entries.find(e => /\.ym\d?$/i.test(e.name));
    if (!ymEntry) throw new Error('Archive LHA/LZH sans .YM interne.');
    ymBytes = LHA.unpack(ymEntry);                      // Uint8Array du .YM
    return parseYM(ymBytes);
  }

  // 2) YM direct
  if (name.endsWith('.ym')) return parseYM(ymBytes);

  // 3) AY : détecter ZXAYEMUL (header)
  if (name.endsWith('.ay')) {
    // “ZXAYEMUL” en ASCII au début d’un AY (cf. spec) [3](https://vgmrips.net/wiki/AY_File_Format)
    const sig = new TextDecoder().decode(bytes.slice(0, 8));
    if (sig === 'ZXAYEMUL') {
      throw new Error('AY (ZXAYEMUL) détecté : v1 sans émulateur Z80. Convertis vers YM (voir Project AY / AYMakeR).');
    }
    throw new Error('Fichier AY non reconnu (header ZXAYEMUL manquant).');
  }

  throw new Error('Format non supporté. Choisis .YM, .LHA/.LZH (YM interne), ou .AY (voir remarque).');
}

function parseYM(bytes) {
  // ⚠️ Parseur YM pédagogique/simplifié pour YM5/6 où les frames sont intercalées (démo)
  // Pour un parseur “complet”, se référer aux docs YM (VGMPF) et/ou utilitaires YM. [1](https://www.vgmpf.com/Wiki/index.php/YM)[6](https://github.com/nguillaumin/ymtool)
  const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (!['YM5!', 'YM6!', 'YM3!'].includes(tag)) throw new Error(`YM version non supportée (${tag}).`);

  // Heuristique: nombre de frames en big-endian (offset 4..7) — conforme à certains YM6
  const frames = (bytes[4] << 24) | (bytes[5] << 16) | (bytes[6] << 8) | (bytes[7]);
  const regsPerFrame = 16;

  // Offset “naïf” après header — à adapter selon la variante YM (ex. métadonnées, digidrums, etc.)
  let offset = 64;
  if (bytes.length < offset + frames * regsPerFrame) {
    // fallback: chercher motif “YM” data si nécessaire… (omise pour concision)
    offset = 16;
  }

  const out = [];
  for (let f = 0; f < frames; f++) {
    const start = offset + f * regsPerFrame;
    const regs = bytes.slice(start, start + regsPerFrame);
    out.push({ regs });
  }
  return {
    meta: { version: tag, frames, rate: 50 }, // CPC ~50 Hz (frame time ≈ 20 ms) [1](https://www.vgmpf.com/Wiki/index.php/YM)
    frames: out
  };
}
