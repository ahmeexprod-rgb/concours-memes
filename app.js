/* ==========================================================
   CONCOURS DE MÈMES — Étape 1 : prototype 100 % navigateur
   Aucune dépendance. Tout se passe en local.
   ========================================================== */
'use strict';

const W = 1080, H = 1920;               // format vidéo 9:16
const GAME_DURATION_MS = 4 * 60 * 1000; // 4 minutes
const MAX_CLIP_S = 15;                  // extrait musical max
const NO_AUDIO_CLIP_S = 6;              // durée de la vidéo sans musique
const MAX_IMAGE_MB = 15;
const MAX_AUDIO_MB = 40;

const $ = (id) => document.getElementById(id);

/* ---------- État ---------- */
const state = {
  pseudo: '',
  img: null,
  imgZoom: 1, imgX: 0, imgY: 0,
  texts: [],
  selectedId: null,
  locked: false,
  startedAt: 0,            // heure de départ de la manche (à l'étape 2 : fournie par le serveur)
  warned: false,
  audio: { buffer: null, name: '', start: 0, end: 0, volume: 1 },
};
let nextId = 1;

/* ---------- Utilitaires ---------- */
function toast(msg, ms = 2800) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), ms);
}
function show(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(screenId).classList.add('active');
}
function fmt(sec) {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}
let _actx = null;
function getCtx() {
  if (!_actx) _actx = new (window.AudioContext || window.webkitAudioContext)();
  return _actx;
}
function beep(freq = 880, dur = 0.18) {
  try {
    const ctx = getCtx();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = freq; o.type = 'square';
    g.gain.value = 0.08;
    o.connect(g).connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + dur);
  } catch (e) { /* silencieux */ }
}

/* ==========================================================
   ÉCRANS 1 & 2 : accueil / création de partie
   ========================================================== */
$('btn-create').onclick = () => {
  const p = $('pseudo').value.trim();
  if (!p) { $('home-hint').textContent = 'Choisis d\'abord un pseudo !'; $('home-hint').className = 'hint err'; $('pseudo').focus(); return; }
  state.pseudo = p;
  try { localStorage.setItem('cdm_pseudo', p); } catch (e) {}
  show('screen-create');
};
// (bouton « Rejoindre » : voir la section « mode en ligne » en bas du fichier)
$('btn-back').onclick = () => show('screen-home');
try { $('pseudo').value = localStorage.getItem('cdm_pseudo') || ''; } catch (e) {}

$('file-image').onchange = (e) => {
  const f = e.target.files[0];
  const hint = $('create-hint');
  if (!f) return;
  if (!f.type.startsWith('image/')) { hint.textContent = 'Ce fichier n\'est pas une image.'; hint.className = 'hint err'; return; }
  if (f.size > MAX_IMAGE_MB * 1024 * 1024) { hint.textContent = `Image trop lourde (max ${MAX_IMAGE_MB} Mo).`; hint.className = 'hint err'; return; }
  const url = URL.createObjectURL(f);
  const img = new Image();
  img.onload = () => {
    state.img = img;
    const pv = $('image-preview');
    pv.classList.remove('empty'); pv.textContent = '';
    pv.style.backgroundImage = `url(${url})`;
    hint.textContent = `${img.naturalWidth} × ${img.naturalHeight} px — l'original n'est jamais modifié.`;
    hint.className = 'hint ok';
    $('btn-start').disabled = false;
  };
  img.onerror = () => { hint.textContent = 'Impossible de lire cette image.'; hint.className = 'hint err'; };
  img.src = url;
};

$('btn-start').onclick = async () => {
  if (!state.img) return;
  try { await Promise.all([document.fonts.load('90px Anton'), document.fonts.load('90px Bangers')]); } catch (e) {}
  if (FB.ready) { await createRoom(); return; }
  // Mode solo (Firebase non configuré) : manche locale
  $('who-name').textContent = state.pseudo;
  show('screen-editor');
  resetEditor();
  startRound(Date.now());
};

/* ==========================================================
   ÉDITEUR : rendu canvas
   ========================================================== */
const canvas = $('canvas');
const ctx = canvas.getContext('2d');

const PRESETS = {
  classic: { font: 'Anton', color: '#ffffff', stroke: '#000000', sw: 8, caps: true, align: 'center', size: 100 },
  yellow:  { font: 'Anton', color: '#ffe14d', stroke: '#000000', sw: 8, caps: true, align: 'center', size: 100 },
  pink:    { font: 'Bangers', color: '#ff2e93', stroke: '#ffffff', sw: 10, caps: true, align: 'center', size: 120 },
  cap:     { font: 'Inter', color: '#ffffff', stroke: '#000000', sw: 6, caps: false, align: 'center', size: 56 },
};

function newText(preset = 'classic', content = 'TON TEXTE ICI') {
  const t = { id: nextId++, text: content, x: W / 2, y: H * 0.15 + state.texts.length * 220, ...PRESETS[preset] };
  if (t.y > H - 150) t.y = H / 2;
  state.texts.push(t);
  select(t.id);
  render();
  return t;
}
const sel = () => state.texts.find(t => t.id === state.selectedId) || null;

function setFont(c, t) { c.font = `${t.font === 'Inter' ? '800' : '400'} ${t.size}px "${t.font}", Impact, sans-serif`; }

function wrapLines(c, t) {
  const maxW = W * 0.92;
  const raw = (t.caps ? t.text.toUpperCase() : t.text).split('\n');
  const lines = [];
  raw.forEach(par => {
    const words = par.split(' ');
    let cur = '';
    words.forEach(w => {
      const test = cur ? cur + ' ' + w : w;
      if (c.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; } else cur = test;
    });
    lines.push(cur);
  });
  return lines;
}

function drawBackground(c) {
  c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
  const img = state.img;
  if (!img) return;
  const scale = Math.max(W / img.naturalWidth, H / img.naturalHeight) * state.imgZoom;
  const dw = img.naturalWidth * scale, dh = img.naturalHeight * scale;
  const x = (W - dw) / 2 - state.imgX * (dw - W) / 2;
  const y = (H - dh) / 2 - state.imgY * (dh - H) / 2;
  c.drawImage(img, x, y, dw, dh);
}

function drawTexts(c, withSelection) {
  state.texts.forEach(t => {
    setFont(c, t);
    c.textBaseline = 'middle';
    c.lineJoin = 'round'; c.miterLimit = 2;
    const lines = wrapLines(c, t);
    const lh = t.size * 1.12;
    const blockW = Math.max(...lines.map(l => c.measureText(l).width));
    const blockH = lh * lines.length;
    const top = t.y - blockH / 2;
    lines.forEach((l, i) => {
      const lw = c.measureText(l).width;
      let lx;
      if (t.align === 'left') lx = t.x - blockW / 2;
      else if (t.align === 'right') lx = t.x + blockW / 2 - lw;
      else lx = t.x - lw / 2;
      const ly = top + lh * (i + 0.5);
      c.textAlign = 'left';
      if (t.sw > 0) { c.lineWidth = t.sw * 2; c.strokeStyle = t.stroke; c.strokeText(l, lx, ly); }
      c.fillStyle = t.color; c.fillText(l, lx, ly);
    });
    t._box = { x0: t.x - blockW / 2 - 14, y0: top - 10, x1: t.x + blockW / 2 + 14, y1: top + blockH + 10 };
    if (withSelection && t.id === state.selectedId) {
      c.save();
      c.setLineDash([18, 12]); c.lineWidth = 5; c.strokeStyle = '#27e1ff';
      c.strokeRect(t._box.x0, t._box.y0, t._box.x1 - t._box.x0, t._box.y1 - t._box.y0);
      c.restore();
    }
  });
}

function drawScene(c, withSelection) { drawBackground(c); drawTexts(c, withSelection); }
function render() { drawScene(ctx, true); scheduleDraft(); }

/* ---------- Sélection et panneau de texte ---------- */
function select(id) {
  state.selectedId = id;
  syncTextControls();
}
function syncTextControls() {
  const t = sel();
  $('text-controls').classList.toggle('disabled', !t);
  if (!t) return;
  $('t-content').value = t.text;
  $('t-font').value = t.font;
  $('t-size').value = t.size; $('o-size').textContent = Math.round(t.size);
  $('t-color').value = t.color; $('t-stroke').value = t.stroke;
  $('t-sw').value = t.sw; $('o-sw').textContent = t.sw;
  document.querySelectorAll('[data-align]').forEach(b => b.classList.toggle('on', b.dataset.align === t.align));
  $('t-caps').classList.toggle('on', t.caps);
}
function bind(id, evt, fn) { $(id).addEventListener(evt, () => { const t = sel(); if (!t || state.locked) return; fn(t, $(id)); render(); syncOutputs(t); }); }
function syncOutputs(t) { $('o-size').textContent = Math.round(t.size); $('o-sw').textContent = t.sw; }

bind('t-content', 'input', (t, el) => { t.text = el.value; });
bind('t-font', 'change', (t, el) => { t.font = el.value; document.fonts.load(`90px ${el.value}`).then(render); });
bind('t-size', 'input', (t, el) => { t.size = +el.value; });
bind('t-color', 'input', (t, el) => { t.color = el.value; });
bind('t-stroke', 'input', (t, el) => { t.stroke = el.value; });
bind('t-sw', 'input', (t, el) => { t.sw = +el.value; });
document.querySelectorAll('[data-align]').forEach(b => b.onclick = () => {
  const t = sel(); if (!t || state.locked) return; t.align = b.dataset.align; syncTextControls(); render();
});
$('t-caps').onclick = () => { const t = sel(); if (!t || state.locked) return; t.caps = !t.caps; syncTextControls(); render(); };
$('btn-del-text').onclick = () => {
  if (state.locked) return;
  state.texts = state.texts.filter(t => t.id !== state.selectedId);
  select(null); render();
};
$('btn-add-text').onclick = () => { if (!state.locked) { newText('classic'); $('t-content').focus(); $('t-content').select(); } };
document.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => {
  if (state.locked) return;
  const t = sel();
  if (t) { Object.assign(t, PRESETS[b.dataset.preset]); syncTextControls(); render(); }
  else newText(b.dataset.preset);
});

/* ---------- Image : zoom / recadrage ---------- */
function bindImg(id, key, scale = 1) {
  $(id).addEventListener('input', () => {
    if (state.locked) return;
    state[key] = $(id).value / scale;
    if (id === 'i-zoom') $('o-zoom').textContent = $(id).value;
    render();
  });
}
bindImg('i-zoom', 'imgZoom', 100); bindImg('i-x', 'imgX', 100); bindImg('i-y', 'imgY', 100);

/* ---------- Glisser-déposer des textes ---------- */
let drag = null;
function canvasPoint(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
}
canvas.addEventListener('pointerdown', (e) => {
  if (state.locked) return;
  const p = canvasPoint(e);
  let hit = null;
  for (let i = state.texts.length - 1; i >= 0; i--) {
    const b = state.texts[i]._box;
    if (b && p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1) { hit = state.texts[i]; break; }
  }
  if (hit) {
    select(hit.id);
    drag = { id: hit.id, dx: hit.x - p.x, dy: hit.y - p.y };
    canvas.setPointerCapture(e.pointerId); canvas.classList.add('dragging');
  } else select(null);
  render();
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const t = state.texts.find(t => t.id === drag.id); if (!t) return;
  const p = canvasPoint(e);
  t.x = Math.min(W, Math.max(0, p.x + drag.dx));
  t.y = Math.min(H, Math.max(0, p.y + drag.dy));
  render();
});
const endDrag = () => { drag = null; canvas.classList.remove('dragging'); };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('wheel', (e) => { // molette = redimensionner le texte sélectionné
  const t = sel(); if (!t || state.locked) return;
  e.preventDefault();
  t.size = Math.min(260, Math.max(30, t.size - Math.sign(e.deltaY) * 6));
  syncTextControls(); render();
}, { passive: false });

/* ==========================================================
   AUDIO : import, forme d'onde, sélection de l'extrait
   ========================================================== */
const wave = $('wave'), wctx = wave.getContext('2d');
let peaks = null, playing = null, rafPlay = 0;

$('file-audio').onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f || state.locked) return;
  if (f.size > MAX_AUDIO_MB * 1024 * 1024) { toast(`Fichier audio trop lourd (max ${MAX_AUDIO_MB} Mo).`); return; }
  $('audio-name').textContent = 'Lecture du fichier…';
  try {
    const arr = await f.arrayBuffer();
    const buf = await getCtx().decodeAudioData(arr);
    stopPreview();
    state.audio.buffer = buf; state.audio.name = f.name;
    state.audio.start = 0; state.audio.end = Math.min(MAX_CLIP_S, buf.duration);
    computePeaks(buf);
    $('audio-name').textContent = `${f.name} (${buf.duration.toFixed(1)} s)`;
    $('audio-ui').classList.remove('hidden');
    updateAudioUI();
  } catch (err) {
    console.error(err);
    $('audio-name').textContent = 'Aucun son (export sans musique possible)';
    toast('Fichier audio non compatible. Essaie un MP3 ou un WAV.');
  }
};
$('btn-remove-audio').onclick = () => {
  if (state.locked) return;
  stopPreview();
  state.audio.buffer = null; peaks = null;
  $('audio-ui').classList.add('hidden');
  $('audio-name').textContent = 'Aucun son (export sans musique possible)';
};

function computePeaks(buf) {
  const n = wave.width, data = buf.getChannelData(0), step = Math.floor(data.length / n) || 1;
  peaks = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let j = 0; j < step; j += Math.max(1, step >> 5)) m = Math.max(m, Math.abs(data[i * step + j] || 0));
    peaks[i] = m;
  }
}
function drawWave(playPos) {
  const a = state.audio; if (!a.buffer || !peaks) return;
  const w = wave.width, h = wave.height, dur = a.buffer.duration;
  wctx.clearRect(0, 0, w, h);
  const xs = a.start / dur * w, xe = a.end / dur * w;
  for (let i = 0; i < w; i++) {
    const inside = i >= xs && i <= xe;
    wctx.fillStyle = inside ? '#27e1ff' : '#4a4580';
    const ph = Math.max(2, peaks[i] * h * 0.95);
    wctx.fillRect(i, (h - ph) / 2, 1, ph);
  }
  wctx.fillStyle = '#ffe14d33'; wctx.fillRect(xs, 0, xe - xs, h);
  wctx.fillStyle = '#ffe14d';
  wctx.fillRect(xs - 2, 0, 5, h); wctx.fillRect(xe - 2, 0, 5, h);
  if (playPos != null) { wctx.fillStyle = '#fff'; wctx.fillRect(playPos / dur * w - 1, 0, 2, h); }
}
function updateAudioUI() {
  const a = state.audio;
  $('t-start').textContent = fmt(a.start);
  $('t-end').textContent = fmt(a.end);
  $('t-len').textContent = (a.end - a.start).toFixed(0) + ' s (fixe)';
  const sl = $('a-start'), room = Math.max(0, a.buffer.duration - (a.end - a.start));
  sl.max = room.toFixed(1); sl.value = a.start; sl.disabled = room < 0.1;
  drawWave();
}

// La durée est fixée à 15 s : l'utilisateur ne choisit que le point de départ.
function setStart(s) {
  const a = state.audio; if (!a.buffer || state.locked) return;
  const dur = a.buffer.duration, len = Math.min(MAX_CLIP_S, dur);
  a.start = Math.min(Math.max(0, s), dur - len);
  a.end = a.start + len;
  updateAudioUI();
}
$('a-start').addEventListener('input', () => setStart(+$('a-start').value));

let wdrag = false;
function moveWave(e) {
  const a = state.audio, r = wave.getBoundingClientRect(), dur = a.buffer.duration;
  const t = (e.clientX - r.left) / r.width * dur;
  setStart(t - (a.end - a.start) / 2);   // la fenêtre se centre sur le clic
}
wave.addEventListener('pointerdown', (e) => {
  if (!state.audio.buffer || state.locked) return;
  wdrag = true; wave.setPointerCapture(e.pointerId); moveWave(e);
});
wave.addEventListener('pointermove', (e) => { if (wdrag) moveWave(e); });
wave.addEventListener('pointerup', () => { wdrag = false; });

/* ---------- Prévisualisation ---------- */
$('a-vol').addEventListener('input', () => {
  state.audio.volume = $('a-vol').value / 100;
  if (playing) playing.gain.gain.value = state.audio.volume;
});
$('btn-play').onclick = () => { playing ? stopPreview() : startPreview(); };
async function startPreview() {
  const a = state.audio; if (!a.buffer) return;
  const c = getCtx(); await c.resume();
  const src = c.createBufferSource(); src.buffer = a.buffer;
  const gain = c.createGain(); gain.gain.value = a.volume;
  src.connect(gain).connect(c.destination);
  const len = a.end - a.start;
  src.start(0, a.start, len);
  const t0 = c.currentTime;
  playing = { src, gain };
  src.onended = () => { if (playing && playing.src === src) stopPreview(); };
  $('btn-play').textContent = '⏸ Stop';
  const loop = () => {
    if (!playing) return;
    const el = c.currentTime - t0;
    $('play-bar').style.width = Math.min(100, el / len * 100) + '%';
    drawWave(a.start + el);
    rafPlay = requestAnimationFrame(loop);
  };
  loop();
}
function stopPreview() {
  if (playing) { try { playing.src.onended = null; playing.src.stop(); } catch (e) {} playing = null; }
  cancelAnimationFrame(rafPlay);
  $('btn-play').textContent = '▶ Écouter';
  $('play-bar').style.width = '0%';
  drawWave();
}

/* ==========================================================
   CHRONOMÈTRE : calculé depuis une heure de départ commune
   (à l'étape 2, startedAt viendra du serveur, pas de l'horloge locale)
   ========================================================== */
let timerHandle = 0;
function startRound(startedAtMs) {
  state.startedAt = startedAtMs; state.warned = false;
  clearInterval(timerHandle);
  tick();
  timerHandle = setInterval(tick, 200);
}
function tick() {
  const remaining = Math.max(0, (state.duration || GAME_DURATION_MS) - (serverNow() - state.startedAt));
  const secs = Math.ceil(remaining / 1000);
  $('timer').textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  const el = $('timer');
  el.classList.toggle('warn', secs <= 30 && secs > 10);
  el.classList.toggle('danger', secs <= 10);
  if (secs <= 30 && !state.warned && remaining > 0) {
    state.warned = true; beep(660, 0.25); setTimeout(() => beep(880, 0.25), 300);
    toast('⚠ Plus que 30 secondes !');
  }
  if (remaining <= 0 && !state.locked) endRound();
}
function endRound() {
  clearInterval(timerHandle);
  state.locked = true;
  stopPreview();
  $('timer').textContent = '0:00';
  $('state-badge').textContent = 'TERMINÉ'; $('state-badge').classList.add('done');
  $('lock-banner').classList.remove('hidden');
  document.querySelectorAll('.tools .panel').forEach(p => {
    if (!p.contains($('btn-export'))) p.classList.add('lockable');
  });
  select(null); render();
  beep(440, 0.6);
  document.querySelector('.topbar').classList.add('flash');
  afterRoundEnd();
}

function resetEditor() {
  stopPreview(); state.audio.buffer = null; peaks = null;
  $('audio-ui').classList.add('hidden'); $('audio-name').textContent = 'Aucun son (export sans musique possible)';
  $('btn-download').classList.add('hidden'); $('export-progress').classList.add('hidden');
  $('export-bar').style.width = '0%'; $('export-hint').textContent = '';
  state.texts = []; state.selectedId = null; state.locked = false;
  state.imgZoom = 1; state.imgX = 0; state.imgY = 0;
  ['i-zoom', 'i-x', 'i-y'].forEach(id => $(id).value = id === 'i-zoom' ? 100 : 0);
  $('o-zoom').textContent = '100';
  $('lock-banner').classList.add('hidden');
  $('state-badge').textContent = 'EN COURS'; $('state-badge').classList.remove('done');
  document.querySelectorAll('.lockable').forEach(p => p.classList.remove('lockable'));
  document.querySelector('.topbar').classList.remove('flash');
  newText('classic', 'TON TEXTE ICI');
  select(null); render();
}

/* ==========================================================
   EXPORT VIDÉO (MediaRecorder : MP4 natif si le navigateur le permet)
   Rien n'est envoyé sur un serveur.
   ========================================================== */
let exporting = false, lastUrl = null;

function pickMime() {
  const list = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  if (!window.MediaRecorder) return null;
  return list.find(m => MediaRecorder.isTypeSupported(m)) || null;
}

$('btn-export').onclick = async () => {
  if (exporting) return;
  const mime = pickMime();
  const hint = $('export-hint');
  if (!mime || !HTMLCanvasElement.prototype.captureStream) {
    hint.textContent = 'Ce navigateur ne sait pas exporter de vidéo. Utilise Chrome, Edge ou Safari récent.';
    hint.className = 'hint err'; return;
  }
  exporting = true; stopPreview(); select(null); render();
  $('btn-export').disabled = true;
  $('btn-download').classList.add('hidden');
  $('export-progress').classList.remove('hidden');
  hint.textContent = ''; hint.className = 'hint';
  if (lastUrl) { URL.revokeObjectURL(lastUrl); lastUrl = null; }

  const a = state.audio;
  const hasAudio = !!a.buffer;
  const clipS = hasAudio ? Math.min(MAX_CLIP_S, a.end - a.start) : NO_AUDIO_CLIP_S;

  const off = document.createElement('canvas'); off.width = W; off.height = H;
  const oc = off.getContext('2d');
  drawScene(oc, false);
  const stream = off.captureStream(30);
  let src = null;

  try {
    if (hasAudio) {
      const c = getCtx(); await c.resume();
      const dest = c.createMediaStreamDestination();
      src = c.createBufferSource(); src.buffer = a.buffer;
      const g = c.createGain(); g.gain.value = a.volume;
      src.connect(g).connect(dest);
      dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
    }
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000, audioBitsPerSecond: 128_000 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const done = new Promise((res, rej) => { rec.onstop = res; rec.onerror = (e) => rej(e.error || e); });

    $('export-msg').textContent = 'Rendu en cours… ne ferme pas cet onglet.';
    rec.start(250);
    if (src) src.start(0, a.start, clipS);
    const t0 = performance.now();
    const redraw = setInterval(() => { drawScene(oc, false); }, 33); // garde le flux vidéo actif
    const prog = setInterval(() => {
      const p = Math.min(100, (performance.now() - t0) / (clipS * 1000) * 100);
      $('export-bar').style.width = p + '%';
    }, 100);
    await new Promise(r => setTimeout(r, clipS * 1000 + 250));
    if (rec.state !== 'inactive') rec.stop();
    await done;
    clearInterval(redraw); clearInterval(prog);
    try { src && src.stop(); } catch (e) {}

    const blob = new Blob(chunks, { type: mime.split(';')[0] });
    if (!blob.size) throw new Error('vidéo vide');
    const isMp4 = mime.startsWith('video/mp4');
    lastUrl = URL.createObjectURL(blob);
    const dl = $('btn-download');
    dl.href = lastUrl;
    dl.download = `meme-${(state.pseudo || 'joueur').replace(/[^\w-]+/g, '_')}.${isMp4 ? 'mp4' : 'webm'}`;
    dl.classList.remove('hidden');
    $('export-bar').style.width = '100%';
    $('export-msg').textContent = '✅ Export terminé !';
    if (!isMp4) {
      hint.textContent = 'Ton navigateur produit du WebM (pas de MP4 natif). Pour du vrai MP4, utilise Chrome/Edge/Safari récent.';
      hint.className = 'hint';
    }
  } catch (err) {
    console.error(err);
    $('export-msg').textContent = '❌ L\'export a échoué.';
    hint.textContent = 'Réessaie, ou retire la musique / change de navigateur.';
    hint.className = 'hint err';
  } finally {
    exporting = false;
    $('btn-export').disabled = false;
  }
};

window.addEventListener('beforeunload', (e) => {
  if ($('screen-editor').classList.contains('active') && !state.locked) { e.preventDefault(); e.returnValue = ''; }
});
document.fonts && document.fonts.ready.then(() => { if (state.img) render(); });

/* ==========================================================
   ÉTAPES 2 + 3 : MODE EN LIGNE (Firebase Realtime Database)
   Salles, joueurs en temps réel, chrono synchronisé, vote.
   Sans configuration Firebase, le jeu reste jouable en solo.
   ========================================================== */
const FB = { ready: false, db: null, offset: 0 };
const ROOM = {
  code: null, pid: null, meta: null, players: {}, votes: {}, isHost: false,
  refs: [], activeRound: null, lastPhase: null, imageVer: null,
  hostTimer: 0, draftTimer: 0, voteSig: '', shownImage: null,
};
const ss = {
  get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} },
  del(k) { try { sessionStorage.removeItem(k); } catch (e) {} },
};
const TS = () => firebase.database.ServerValue.TIMESTAMP;
function serverNow() { return Date.now() + FB.offset; }   // heure du serveur : base du chrono commun
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function genCode() { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 5; i++) s += A[Math.floor(Math.random() * A.length)]; return s; }
function getPid() {
  let p = ss.get('cdm_pid');
  if (!p) { p = Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4); ss.set('cdm_pid', p); }
  return p;
}
function loadImage(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }
function canvasToDataUrl(cv, maxLen, q0) {
  let q = q0, url = cv.toDataURL('image/jpeg', q);
  while (url.length > maxLen && q > 0.35) { q -= 0.08; url = cv.toDataURL('image/jpeg', q); }
  return url;
}
function shrinkImage(img) {            // réduit l'image partagée (jamais plus que nécessaire pour 1080x1920)
  const s = Math.min(1, Math.max(1080 / img.naturalWidth, 1920 / img.naturalHeight));
  const w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, w, h); x.drawImage(img, 0, 0, w, h);
  return canvasToDataUrl(c, 1800000, 0.85);
}
function initFirebase() {
  const cfg = window.FIREBASE_CONFIG;
  if (!window.firebase || !cfg || !cfg.apiKey || !cfg.databaseURL || /COLLE|TON-PROJET/i.test(cfg.apiKey + cfg.databaseURL)) return;
  try {
    firebase.initializeApp(cfg);
    FB.db = firebase.database();
    FB.ready = true;
    FB.db.ref('.info/serverTimeOffset').on('value', s => { FB.offset = s.val() || 0; });
  } catch (e) { console.error('Firebase init', e); }
}

/* ---------- Création / entrée dans une salle ---------- */
async function createRoom() {
  const btn = $('btn-start'), hint = $('create-hint');
  btn.disabled = true; hint.textContent = 'Création de la salle…'; hint.className = 'hint';
  try {
    const data = shrinkImage(state.img);
    let code = null;
    for (let i = 0; i < 6 && !code; i++) {
      const c = genCode();
      const s = await FB.db.ref('rooms/' + c + '/meta').once('value');
      if (!s.exists()) code = c;
    }
    if (!code) throw new Error('code');
    await FB.db.ref('rooms/' + code).set({
      meta: { host: ROOM.pid, phase: 'lobby', round: 0, duration: GAME_DURATION_MS, imageVer: 1, createdAt: TS() },
      image: data,
      players: { [ROOM.pid]: { name: state.pseudo, joinedAt: TS(), ready: true, online: true } },
    });
    await enterRoom(code);
  } catch (e) {
    console.error(e);
    hint.textContent = 'Impossible de créer la salle. Vérifie la configuration Firebase (voir README).'; hint.className = 'hint err';
  } finally { btn.disabled = false; }
}

async function enterRoom(rawCode) {
  const code = rawCode.toUpperCase().trim();
  const base = FB.db.ref('rooms/' + code);
  const metaSnap = await base.child('meta').once('value');
  if (!metaSnap.exists()) throw new Error('not_found');
  await new Promise(r => FB.db.ref('.info/serverTimeOffset').once('value', s => { FB.offset = s.val() || 0; r(); }));
  const imgSnap = await base.child('image').once('value');
  state.img = await loadImage(imgSnap.val());
  const players = (await base.child('players').once('value')).val() || {};
  let name = state.pseudo || 'Joueur', n = 2;
  const taken = x => Object.entries(players).some(([id, p]) => id !== ROOM.pid && String(p.name).toLowerCase() === x.toLowerCase());
  const base0 = name; while (taken(name)) name = base0 + ' ' + n++;
  state.pseudo = name;
  ROOM.code = code; ROOM.imageVer = metaSnap.val().imageVer; ROOM.activeRound = null; ROOM.lastPhase = null;
  const me = base.child('players/' + ROOM.pid);
  if (players[ROOM.pid]) await me.update({ name, online: true });
  else await me.set({ name, joinedAt: TS(), ready: false, online: true });
  // présence : "online" repasse à false si la connexion est perdue, puis à true au retour
  const con = FB.db.ref('.info/connected');
  const onCon = con.on('value', s => {
    const ok = !!s.val();
    $('net-badge').classList.toggle('hidden', ok);
    if (ok) me.onDisconnect().update({ online: false }).then(() => me.update({ online: true })).catch(() => {});
  });
  ROOM.refs.push([con, 'value', onCon]);
  listen(base.child('meta'), onMeta);
  listen(base.child('players'), onPlayers);
  listen(base.child('votes'), onVotes);
  ss.set('cdm_room', code);
  $('who-name').textContent = state.pseudo;
}
function listen(ref, fn) { const cb = ref.on('value', s => fn(s.val())); ROOM.refs.push([ref, 'value', cb]); }

function detachAll() {
  ROOM.refs.forEach(([r, t, cb]) => { try { r.off(t, cb); } catch (e) {} });
  ROOM.refs = []; clearTimeout(ROOM.hostTimer);
  if (ROOM.code && FB.ready) { try { FB.db.ref('rooms/' + ROOM.code + '/players/' + ROOM.pid).onDisconnect().cancel(); } catch (e) {} }
  ROOM.code = null; ROOM.activeRound = null; ROOM.lastPhase = null; ROOM.imageVer = null; ROOM.voteSig = '';
  ss.del('cdm_room');
}
function goHome() {
  clearInterval(timerHandle); stopPreview(); stopConfetti();
  state.locked = false; ROOM.meta = null; ROOM.players = {}; ROOM.votes = {}; ROOM.isHost = false;
  $('home-hint').textContent = ''; $('home-hint').className = 'hint';
  show('screen-home');
}
async function leaveRoom() {
  const code = ROOM.code; if (!code) { goHome(); return; }
  const others = Object.entries(ROOM.players).filter(([id, p]) => id !== ROOM.pid && p.online);
  const base = FB.db.ref('rooms/' + code);
  detachAll(); goHome();
  try { if (!others.length) await base.remove(); else await base.child('players/' + ROOM.pid).update({ online: false }); } catch (e) {}
}

/* ---------- Réception des données en temps réel ---------- */
function onMeta(meta) {
  if (!meta) {                          // salle supprimée
    if (ROOM.code) { toast('La salle a été fermée.'); detachAll(); goHome(); }
    return;
  }
  ROOM.meta = meta; ROOM.isHost = meta.host === ROOM.pid;
  if (meta.imageVer !== ROOM.imageVer) { ROOM.imageVer = meta.imageVer; reloadImage(); }
  state.duration = meta.duration || GAME_DURATION_MS;
  if (meta.phase === 'edit') {
    if (ROOM.activeRound !== meta.round) { ROOM.activeRound = meta.round; startEditorRound(); }
    else state.startedAt = meta.startedAt;   // la valeur serveur remplace l'estimation locale
  }
  if (meta.phase !== ROOM.lastPhase) { ROOM.lastPhase = meta.phase; routePhase(meta); }
  updateHostUI(); checkHost();
}
function onPlayers(p) {
  ROOM.players = p || {};
  const m = ROOM.meta; if (!m) return;
  if (m.phase === 'lobby') renderLobby();
  else if (m.phase === 'vote') renderVote();
  else if (m.phase === 'result') renderResult();
  checkHost();
}
function onVotes(v) {
  ROOM.votes = v || {};
  const m = ROOM.meta; if (!m) return;
  if (m.phase === 'vote') renderVote(); else if (m.phase === 'result') renderResult();
}
function reloadImage() {
  FB.db.ref('rooms/' + ROOM.code + '/image').once('value').then(s => loadImage(s.val())).then(img => {
    state.img = img; render();
    if (ROOM.meta && ROOM.meta.phase === 'lobby') renderLobby();
  }).catch(() => {});
}
function routePhase(meta) {
  if (meta.phase !== 'result') stopConfetti();
  if (meta.phase === 'lobby') { clearInterval(timerHandle); stopPreview(); show('screen-lobby'); renderLobby(); }
  else if (meta.phase === 'edit') { show('screen-editor'); render(); }
  else if (meta.phase === 'vote') { ROOM.voteSig = ''; show('screen-vote'); renderVote(); }
  else if (meta.phase === 'result') { show('screen-result'); renderResult(); startConfetti(); }
}
function startEditorRound() {
  document.fonts.load('90px Anton'); document.fonts.load('90px Bangers');
  resetEditor(); loadDraft();
  $('who-name').textContent = state.pseudo;
  startRound(ROOM.meta.startedAt);
  render();
}
function sortedPlayers() {
  return Object.entries(ROOM.players || {}).map(([id, p]) => ({ id, ...p })).sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
}

/* ---------- Organisateur : transfert si déconnexion définitive ---------- */
function checkHost() {
  clearTimeout(ROOM.hostTimer);
  const m = ROOM.meta; if (!m || !ROOM.code) return;
  const h = ROOM.players[m.host];
  if (h && h.online) return;
  const cand = sortedPlayers().filter(p => p.online);
  if (!cand.length || cand[0].id !== ROOM.pid) return;     // le plus ancien joueur en ligne reprend
  ROOM.hostTimer = setTimeout(() => {
    const m2 = ROOM.meta, h2 = m2 && ROOM.players[m2.host];
    if (ROOM.code && m2 && !(h2 && h2.online)) { FB.db.ref('rooms/' + ROOM.code + '/meta/host').set(ROOM.pid); toast('Tu es maintenant l\'organisateur.'); }
  }, 6000);
}
function updateHostUI() {
  const m = ROOM.meta; if (!m) return;
  const h = ROOM.isHost, t = (id, on) => $(id).classList.toggle('hidden', !on);
  t('btn-start-game', h); t('btn-change-image', h); t('lobby-wait', !h); t('btn-ready', !h);
  t('btn-open-vote', h && state.locked && m.phase === 'edit');
  t('wait-host', !h && state.locked && m.phase === 'edit');
  t('btn-to-vote', m.phase === 'vote' && ROOM.activeRound !== null);
  t('btn-close-vote', h); t('btn-new-round', h); t('btn-close-room', h);
  $('room-chip').textContent = 'Salle ' + ROOM.code;
}

/* ---------- Écran : salle d'attente ---------- */
function inviteLink() { return location.href.split('#')[0].split('?')[0] + '?room=' + ROOM.code; }
function playerRow(p) {
  const host = ROOM.meta && p.id === ROOM.meta.host;
  return `<li class="${p.online ? 'on' : 'off'}"><span class="dot"></span><b>${esc(p.name)}</b>` +
    (host ? '<span class="tag">👑 ORGA</span>' : '') + (p.id === ROOM.pid ? '<span class="tag me">TOI</span>' : '') +
    `<span class="rdy">${(p.ready || host) ? '✅ prêt' : '⏳ pas prêt'}</span></li>`;
}
function renderLobby() {
  if (!ROOM.meta) return;
  $('lobby-code').textContent = ROOM.code;
  $('lobby-link').value = inviteLink();
  if (state.img && ROOM.shownImage !== state.img.src) { ROOM.shownImage = state.img.src; $('lobby-image').style.backgroundImage = 'url("' + state.img.src + '")'; }
  const list = sortedPlayers();
  $('lobby-players').innerHTML = list.map(playerRow).join('');
  $('lobby-count').textContent = list.filter(p => p.online).length;
  const ready = list.filter(p => p.online && (p.ready || p.id === ROOM.meta.host)).length;
  $('btn-start-game').textContent = `LANCER LA PARTIE (${ready}/${list.filter(p => p.online).length} prêts)`;
  const me = ROOM.players[ROOM.pid];
  $('btn-ready').textContent = me && me.ready ? '✅ PRÊT (annuler)' : 'JE SUIS PRÊT';
  updateHostUI();
}
async function copyText(txt, ok) {
  try { await navigator.clipboard.writeText(txt); toast(ok); }
  catch (e) { const i = $('lobby-link'); i.focus(); i.select(); toast('Lien sélectionné : fais Ctrl+C'); }
}
$('btn-copy-code').onclick = () => copyText(ROOM.code, 'Code copié !');
$('btn-copy-link').onclick = () => copyText(inviteLink(), 'Lien copié !');
$('btn-ready').onclick = () => { const me = ROOM.players[ROOM.pid]; FB.db.ref('rooms/' + ROOM.code + '/players/' + ROOM.pid + '/ready').set(!(me && me.ready)); };
$('btn-leave-lobby').onclick = leaveRoom;
$('btn-leave-result').onclick = leaveRoom;
$('btn-change-image').onclick = () => $('file-image2').click();
$('file-image2').onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f || !ROOM.isHost) return;
  if (!f.type.startsWith('image/') || f.size > MAX_IMAGE_MB * 1024 * 1024) { toast('Image invalide ou trop lourde.'); return; }
  try {
    const url = URL.createObjectURL(f), img = await loadImage(url), data = shrinkImage(img); URL.revokeObjectURL(url);
    await FB.db.ref('rooms/' + ROOM.code).update({ image: data, 'meta/imageVer': (ROOM.meta.imageVer || 0) + 1 });
    toast('Image changée !');
  } catch (err) { toast('Échec du changement d\'image.'); }
};
// L'organisateur lance : une seule écriture, startedAt = heure du SERVEUR, identique pour tous
$('btn-start-game').onclick = () => {
  if (!ROOM.isHost) return;
  const up = { 'meta/phase': 'edit', 'meta/round': (ROOM.meta.round || 0) + 1, 'meta/startedAt': TS(), 'meta/duration': GAME_DURATION_MS, votes: null };
  Object.keys(ROOM.players).forEach(id => { up['players/' + id + '/thumb'] = null; });
  FB.db.ref('rooms/' + ROOM.code).update(up);
};

/* ---------- Fin de manche : miniature partagée + passage au vote ---------- */
function afterRoundEnd() { if (!ROOM.code) return; publishThumb(); updateHostUI(); }
function publishThumb() {               // petite image du mème (texte inclus) pour l'écran de vote ; pas la vidéo
  try {
    const c = document.createElement('canvas'); c.width = 540; c.height = 960;
    const x = c.getContext('2d'); x.scale(0.5, 0.5); drawScene(x, false);
    FB.db.ref('rooms/' + ROOM.code + '/players/' + ROOM.pid + '/thumb').set(canvasToDataUrl(c, 180000, 0.8));
  } catch (e) { console.error(e); }
}
$('btn-open-vote').onclick = () => { if (ROOM.isHost) FB.db.ref('rooms/' + ROOM.code + '/meta/phase').set('vote'); };
$('btn-to-vote').onclick = () => { show('screen-vote'); renderVote(); };
$('btn-back-editor').onclick = () => { show('screen-editor'); render(); };

/* ---------- Écran : vote ---------- */
function renderVote() {
  const list = sortedPlayers(), my = ROOM.votes[ROOM.pid];
  const cast = Object.keys(ROOM.votes).filter(id => ROOM.players[id]).length;
  $('vote-count').textContent = `${cast}/${list.length} ont voté`;
  $('btn-back-editor').classList.toggle('hidden', ROOM.activeRound === null);
  const sig = list.map(p => p.id + ':' + p.name + ':' + (p.thumb ? p.thumb.length : 0)).join('|');
  if (sig !== ROOM.voteSig) {           // on ne reconstruit la grille que si les joueurs/miniatures changent
    ROOM.voteSig = sig;
    $('vote-grid').innerHTML = list.map(p => `<div class="vcard" data-card="${p.id}">
      <div class="vthumb"${p.thumb ? ` style="background-image:url('${p.thumb}')"` : ''}>${p.thumb ? '' : '<span>Pas de création</span>'}</div>
      <div class="vname">${esc(p.name)}${p.id === ROOM.pid ? ' (toi)' : ''}</div>
      <button class="btn btn-secondary" data-vote="${p.id}"${(p.id === ROOM.pid || !p.thumb) ? ' disabled' : ''}>VOTER</button></div>`).join('');
  }
  list.forEach(p => {
    const card = document.querySelector(`[data-card="${p.id}"]`); if (!card) return;
    const sel = my === p.id, b = card.querySelector('button');
    card.classList.toggle('sel', sel); card.classList.toggle('own', p.id === ROOM.pid);
    b.textContent = p.id === ROOM.pid ? 'Ton mème' : (sel ? '✔ TON VOTE' : 'VOTER');
    b.classList.toggle('btn-primary', sel); b.classList.toggle('btn-secondary', !sel);
  });
  updateHostUI();
}
$('vote-grid').addEventListener('click', (e) => {
  const b = e.target.closest('[data-vote]');
  if (!b || b.disabled || !ROOM.meta || ROOM.meta.phase !== 'vote' || b.dataset.vote === ROOM.pid) return;
  FB.db.ref('rooms/' + ROOM.code + '/votes/' + ROOM.pid).set(b.dataset.vote);   // 1 vote par joueur, modifiable jusqu'à la clôture
});
$('btn-close-vote').onclick = () => { if (ROOM.isHost) FB.db.ref('rooms/' + ROOM.code + '/meta/phase').set('result'); };

/* ---------- Écran : résultat ---------- */
function renderResult() {
  const t = {};
  Object.entries(ROOM.votes).forEach(([v, target]) => { if (v !== target && ROOM.players[v] && ROOM.players[target]) t[target] = (t[target] || 0) + 1; });
  const list = sortedPlayers().map(p => ({ ...p, votes: t[p.id] || 0 })).sort((a, b) => b.votes - a.votes || (a.joinedAt || 0) - (b.joinedAt || 0));
  const top = list.length ? list[0].votes : 0, winners = top > 0 ? list.filter(p => p.votes === top) : [];
  $('res-label').textContent = winners.length > 1 ? 'ÉGALITÉ ENTRE…' : (winners.length ? 'LE GAGNANT EST…' : 'PERSONNE N\'A VOTÉ');
  $('res-name').textContent = winners.length ? winners.map(w => w.name).join(' & ') : '—';
  $('res-votes').textContent = winners.length ? `${top} vote${top > 1 ? 's' : ''}` : '';
  const th = winners[0] && winners[0].thumb;
  $('res-thumb').style.backgroundImage = th ? `url('${th}')` : 'none';
  $('res-thumb').classList.toggle('hidden', !th);
  $('res-rank').innerHTML = list.map(p => `<li>${esc(p.name)} <span>— ${p.votes} vote${p.votes > 1 ? 's' : ''}</span></li>`).join('');
  updateHostUI();
}
$('btn-new-round').onclick = () => {
  if (!ROOM.isHost) return;
  const up = { 'meta/phase': 'lobby', votes: null };
  Object.entries(ROOM.players).forEach(([id, p]) => {
    if (!p.online && id !== ROOM.pid) up['players/' + id] = null;           // nettoie les joueurs partis
    else { up['players/' + id + '/thumb'] = null; up['players/' + id + '/ready'] = false; }
  });
  FB.db.ref('rooms/' + ROOM.code).update(up);
};
$('btn-close-room').onclick = () => { if (ROOM.isHost && confirm('Fermer la salle pour tous les joueurs ?')) FB.db.ref('rooms/' + ROOM.code).remove(); };

let confettiRaf = 0;
function startConfetti() {
  const c = $('confetti'), x = c.getContext('2d'); c.width = innerWidth; c.height = innerHeight;
  const cols = ['#ff2e93', '#ffe14d', '#27e1ff', '#3dff9a', '#ffffff'];
  const ps = Array.from({ length: 160 }, () => ({ x: Math.random() * c.width, y: -Math.random() * c.height, vx: (Math.random() - .5) * 3, vy: 2 + Math.random() * 4, s: 6 + Math.random() * 8, r: Math.random() * 6, vr: (Math.random() - .5) * .3, c: cols[Math.floor(Math.random() * cols.length)] }));
  cancelAnimationFrame(confettiRaf); const t0 = performance.now();
  (function loop() {
    x.clearRect(0, 0, c.width, c.height);
    ps.forEach(p => { p.x += p.vx; p.y += p.vy; p.r += p.vr; if (p.y > c.height) { p.y = -10; p.x = Math.random() * c.width; } x.save(); x.translate(p.x, p.y); x.rotate(p.r); x.fillStyle = p.c; x.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); x.restore(); });
    if (performance.now() - t0 < 9000) confettiRaf = requestAnimationFrame(loop); else x.clearRect(0, 0, c.width, c.height);
  })();
}
function stopConfetti() { cancelAnimationFrame(confettiRaf); const c = $('confetti'); c.getContext('2d').clearRect(0, 0, c.width, c.height); }

/* ---------- Brouillon local : un joueur qui actualise sa page retrouve son mème ---------- */
function draftKey() { return 'cdm_draft_' + ROOM.code + '_' + ROOM.activeRound; }
function scheduleDraft() {
  if (!ROOM.code || !state.img) return;
  clearTimeout(ROOM.draftTimer);
  ROOM.draftTimer = setTimeout(() => {
    ss.set(draftKey(), JSON.stringify({ texts: state.texts.map(({ _box, ...t }) => t), imgZoom: state.imgZoom, imgX: state.imgX, imgY: state.imgY, nextId }));
  }, 400);
}
function loadDraft() {
  try {
    const d = JSON.parse(ss.get(draftKey()) || 'null'); if (!d) return;
    state.texts = d.texts || []; state.imgZoom = d.imgZoom || 1; state.imgX = d.imgX || 0; state.imgY = d.imgY || 0;
    nextId = Math.max(nextId, d.nextId || 1, ...state.texts.map(t => t.id + 1));
    $('i-zoom').value = Math.round(state.imgZoom * 100); $('o-zoom').textContent = Math.round(state.imgZoom * 100);
    $('i-x').value = state.imgX * 100; $('i-y').value = state.imgY * 100;
    select(null);
  } catch (e) {}
}

/* ---------- Accueil : rejoindre + démarrage ---------- */
async function onJoinClick() {
  const hint = $('home-hint'), p = $('pseudo').value.trim(), code = $('room-code').value.trim().toUpperCase();
  const err = m => { hint.textContent = m; hint.className = 'hint err'; };
  if (!p) { err('Choisis d\'abord un pseudo !'); $('pseudo').focus(); return; }
  if (!FB.ready) { err('Firebase n\'est pas configuré (voir README).'); return; }
  if (code.length < 4) { err('Entre le code de la salle.'); $('room-code').focus(); return; }
  state.pseudo = p; try { localStorage.setItem('cdm_pseudo', p); } catch (e) {}
  hint.textContent = 'Connexion…'; hint.className = 'hint';
  try { await enterRoom(code); }
  catch (e) { console.error(e); detachAll(); err(e.message === 'not_found' ? 'Salle introuvable. Vérifie le code.' : 'Connexion impossible.'); }
}
$('btn-join').onclick = onJoinClick;
(function initOnline() {
  initFirebase();
  ROOM.pid = getPid();
  const q = new URLSearchParams(location.search).get('room');
  if (q) $('room-code').value = q.toUpperCase().slice(0, 8);
  if (!FB.ready) {
    $('btn-join').disabled = true;
    $('home-hint').textContent = 'Mode solo : Firebase n\'est pas configuré (voir README).';
    return;
  }
  const saved = ss.get('cdm_room'), p = $('pseudo').value.trim();
  if (saved && p) { state.pseudo = p; enterRoom(saved).catch(() => { detachAll(); }); }   // actualisation de page : on revient dans la salle
})();
$('btn-to-vote').title = 'Revenir à l\'écran de vote';
