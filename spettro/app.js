/* Radio Spectrum Explorer
 * Scala logaritmica (log10 Hz), zoom su rotella / pizzico, pan su trascinamento
 * (mouse e touch), doppio righello (Hz in alto, lunghezza d'onda in basso),
 * bande impacchettate in corsie per ente, comparsa automatica per larghezza (LOD),
 * frequenze singole come marcatori, filtri per ente/categoria, vista nell'URL.
 */
'use strict';

const C_LIGHT = 299792458;        // m/s, usato per λ = c / f
const TAU_MIN_SPAN = 1e-4;        // span minimo (decadi) → zoom massimo
const MIN_BAND_PX = 2.5;          // sotto questa larghezza la banda non si disegna
const LABEL_MIN_PX = 46;          // larghezza minima per scrivere l'etichetta dentro la banda

// ---- Geometria ----
const PAD = { left: 8, right: 8, top: 52, bottom: 52 }; // top/bottom = altezza righelli
const LANE_GAP = 4;            // spazio verticale tra corsie
const GROUP_HEADER = 16;       // striscia col titolo del gruppo/ente
const GROUP_GAP = 12;          // spazio tra gruppi
const LANE_MIN = 30, LANE_MAX = 58;   // se non entra tutto, si scorre verticalmente
const SCROLLBAR_W = 5;   // spessore (uguale per barra verticale e orizzontale)
const LINEAR_TICKS_SPAN = 0.5;  // sotto questo span (decadi) il righello passa a tacche lineari
const MARK_ROW = 20;            // riga dei marcatori (frequenze singole) in cima al gruppo
const MARKER_PARENT_PX = 24;    // il marcatore compare quando la banda madre è larga almeno così
const MARKER_NOPARENT_SPAN = 0.05; // senza banda madre: compare sotto questo span (decadi)

// Gruppi (enti) impilati dall'alto, con tinta di sfondo
const SCOPE_ORDER = ['physics', 'world', 'europe', 'italy'];
const SCOPE_META = {
  physics: { label: 'FISICA · spettro EM',   tint: 'rgba(165,175,195,.05)' },
  world:   { label: 'MONDO · ITU',           tint: 'rgba(45,212,191,.055)' },
  europe:  { label: 'EUROPA · CEPT/ECC',     tint: 'rgba(120,150,255,.055)' },
  italy:   { label: 'ITALIA · PNRF',         tint: 'rgba(74,222,128,.055)' },
  other:   { label: 'ALTRO',                 tint: 'rgba(150,150,150,.04)' },
};

// ---- Tema: colori e font del canvas, letti dai token di ../base.css ----
// Si rilegge quando il sistema passa da chiaro a scuro e viceversa.
const THEME = {};
function readTheme() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name) => cs.getPropertyValue(name).trim();
  Object.assign(THEME, {
    ink: v('--ink'), muted: v('--muted'), faint: v('--faint'), surface: v('--surface'),
    line: v('--line'), lineStrong: v('--line-strong'), accent: v('--accent'), accentInk: v('--accent-ink'),
    font: v('--font'),
  });
}
const font = (px, weight) => (weight ? weight + ' ' : '') + px + 'px ' + THEME.font;
readTheme();

// ---- Stato ----
let DPR = Math.max(1, window.devicePixelRatio || 1);
let canvas, ctx, W = 0, H = 0;
let config = null;
let allRanges = [];               // tutte le bande (intervalli)
let allMarkers = [];              // tutte le frequenze singole (voci con `freq`)
let bands = [];                   // bande visibili dopo i filtri
let markers = [];                 // marcatori visibili dopo i filtri
let bandById = new Map();         // bande e marcatori, per id
let hiddenScopes = new Set();     // enti nascosti dai filtri
let hiddenCats = new Set();       // categorie nascoste dai filtri
let showMarkers = true;
let categories = {};
let maxDepth = 0;
let layout = { groups: [], laneH: 40, totalLanes: 0, contentBottom: 0, maxScroll: 0 };
let scrollY = 0;                  // scorrimento verticale del contenuto
let sbDrag = null;                // trascinamento di una scrollbar: {axis:'h'|'v', off}
let hoverSB = null;               // scrollbar sotto il cursore: 'h' | 'v' | null
let focusMark = null;             // marker su una frequenza puntuale (log10 Hz)
let searchMatches = [];           // risultati correnti della ricerca
let searchActive = -1;            // indice evidenziato nei risultati

let axisMin = 0, axisMax = 24;    // log10(Hz)
let view = { min: 0, max: 24 };   // log10(Hz) attualmente visibile

let hovered = null;
let selected = null;
let mouse = { x: -1, y: -1, inside: false };
let drag = null;

// ================= Utility numeriche =================

const log10 = (x) => Math.log(x) / Math.LN10;

const bandAreaW = () => W - PAD.left - PAD.right;
const logToX = (logF) => PAD.left + (logF - view.min) / (view.max - view.min) * bandAreaW();
const xToLog = (x) => view.min + (x - PAD.left) / bandAreaW() * (view.max - view.min);

// SI formatter per frequenza (Hz)
const HZ_UNITS = [
  [1e24,'YHz'],[1e21,'ZHz'],[1e18,'EHz'],[1e15,'PHz'],[1e12,'THz'],
  [1e9,'GHz'],[1e6,'MHz'],[1e3,'kHz'],[1,'Hz']
];
function fmtHz(hz) {
  if (hz <= 0) return 'DC';
  for (const [f, u] of HZ_UNITS) {
    if (hz >= f) return trimNum(hz / f) + ' ' + u;
  }
  return trimNum(hz) + ' Hz';
}

// Formatter per lunghezza d'onda (m) — include cm come unità "naturale"
const LEN_UNITS = [
  [1e12,'Tm'],[1e9,'Gm'],[1e6,'Mm'],[1e3,'km'],[1,'m'],
  [1e-2,'cm'],[1e-3,'mm'],[1e-6,'µm'],[1e-9,'nm'],[1e-12,'pm'],[1e-15,'fm']
];
function fmtLen(m, sig) {
  if (!isFinite(m) || m <= 0) return '∞';
  const num = (n) => sig ? String(+n.toPrecision(sig)) : trimNum(n);
  for (const [f, u] of LEN_UNITS) {
    if (m >= f) return num(m / f) + ' ' + u;
  }
  return num(m / 1e-15) + ' fm';
}

function trimNum(n) {
  if (n >= 100) return n.toFixed(0);
  if (n >= 10)  return n.toFixed(1).replace(/\.0$/, '');
  return n.toFixed(2).replace(/\.?0+$/, '');
}

// Frequenza con `sig` cifre significative (per valori esatti: bande, marcatori, cursore)
function fmtHzP(hz, sig = 10) {
  if (hz <= 0) return 'DC';
  for (const [f, u] of HZ_UNITS) {
    if (hz >= f) return String(+(hz / f).toPrecision(sig)) + ' ' + u;
  }
  return String(+hz.toPrecision(sig)) + ' Hz';
}

// Cifre significative sensate per il cursore: quanto vale un pixel alla zoom attuale
function cursorDigits(hz) {
  const hzPerPx = hz * Math.LN10 * (view.max - view.min) / bandAreaW();
  return Math.max(3, Math.min(10, Math.ceil(log10(hz / hzPerPx))));
}

const freqToLen = (hz) => C_LIGHT / hz;

// Colore di una banda (eredita dalla categoria)
function bandColor(b) {
  if (b.color) return b.color;
  const cat = categories[b.category];
  return (cat && cat.color) || '#7d8694';
}

// converte hex → rgba con alpha
function rgba(hex, a) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

// Lunghezza d'onda (nm) → RGB approssimato, per la luce visibile
function wavelengthToRGB(nm) {
  let r = 0, g = 0, b = 0;
  if (nm >= 380 && nm < 440)      { r = -(nm - 440) / 60; b = 1; }
  else if (nm < 490)              { g = (nm - 440) / 50; b = 1; }
  else if (nm < 510)              { g = 1; b = -(nm - 510) / 20; }
  else if (nm < 580)              { r = (nm - 510) / 70; g = 1; }
  else if (nm < 645)              { r = 1; g = -(nm - 645) / 65; }
  else if (nm <= 780)             { r = 1; }
  let f = 1;
  if (nm < 420)      f = 0.3 + 0.7 * (nm - 380) / 40;
  else if (nm > 700) f = 0.3 + 0.7 * (780 - nm) / 80;
  const ch = (c) => Math.round(255 * Math.pow(Math.max(0, c) * f, 0.8));
  return `rgb(${ch(r)},${ch(g)},${ch(b)})`;
}

// ================= Caricamento dati =================

async function loadData() {
  const res = await fetch('bands.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  config = await res.json();

  categories = config.categories || {};
  if (config.axis) {
    axisMin = log10(Math.max(1e-12, config.axis.min || 1));
    axisMax = log10(config.axis.max || 1e24);
  }
  view.min = axisMin; view.max = axisMax;

  // le voci con `freq` sono frequenze singole (marcatori), le altre intervalli from–to
  const all = (config.bands || []).map((b) => {
    const point = b.freq != null;
    const from = point ? b.freq : b.from, to = point ? b.freq : b.to;
    return { ...b, from, to, point, logFrom: log10(from), logTo: log10(to) };
  });
  bandById = new Map(all.map((b) => [b.id, b]));

  // profondità da catena parent
  for (const b of all) {
    let d = 0, p = b.parent;
    const seen = new Set();
    while (p && bandById.has(p) && !seen.has(p)) { seen.add(p); d++; p = bandById.get(p).parent; }
    b.depth = d;
    if (d > maxDepth) maxDepth = d;
  }

  allRanges = all.filter((b) => !b.point);
  allMarkers = all.filter((b) => b.point);
  applyFilters();
}

// ================= Filtri =================

const scopeKey = (b) => SCOPE_ORDER.includes(b.scope || 'world') ? (b.scope || 'world') : 'other';
const isShown = (b) => !hiddenScopes.has(scopeKey(b)) && !hiddenCats.has(b.category) && (!b.point || showMarkers);

function applyFilters() {
  bands = allRanges.filter(isShown);
  markers = allMarkers.filter(isShown);
  if (hovered && !isShown(hovered)) hovered = null;
  if (selected && !isShown(selected)) closePanel();
  computeLanes();
}

// ================= Rendering =================

// Assegna ogni banda a una corsia dentro il suo gruppo (ente), impacchettando
// per frequenza: bande disgiunte condividono la corsia, quelle che si
// sovrappongono finiscono in corsie diverse → zero accavallamenti.
function packGroup(arr) {
  arr.sort((a, b) => (a.depth - b.depth) || (a.logFrom - b.logFrom) || (b.logTo - a.logTo));
  const laneEnd = [];                 // logTo dell'ultima banda di ogni corsia
  for (const b of arr) {
    let placed = -1;
    for (let k = 0; k < laneEnd.length; k++) {
      if (b.logFrom >= laneEnd[k] - 1e-9) { laneEnd[k] = b.logTo; placed = k; break; }
    }
    if (placed < 0) { laneEnd.push(b.logTo); placed = laneEnd.length - 1; }
    b.lane = placed;
  }
  return laneEnd.length;
}

function computeLanes() {
  const groups = [];
  const known = new Set(SCOPE_ORDER);
  for (const sc of [...SCOPE_ORDER, 'other']) {
    const inScope = (b) => sc === 'other' ? !known.has(b.scope || 'world') : (b.scope || 'world') === sc;
    const items = bands.filter(inScope);
    const marks = markers.filter(inScope).sort((a, b) => a.logFrom - b.logFrom);
    if (items.length || marks.length) groups.push({ scope: sc, items, markers: marks, lanes: packGroup(items) });
  }

  layout.groups = groups;
  layout.totalLanes = groups.reduce((s, g) => s + g.lanes, 0);
}

// Calcola le coordinate y (dipende dall'altezza del canvas → ricalcolata su resize)
function computeGeometry() {
  const top = PAD.top, bottom = H - PAD.bottom;
  const G = layout.groups.length;
  const headers = G * (GROUP_HEADER + GROUP_GAP);
  let laneH = (bottom - top - headers) / Math.max(1, layout.totalLanes);
  laneH = Math.max(LANE_MIN, Math.min(LANE_MAX, laneH));
  layout.laneH = laneH;

  let y = top;
  for (const g of layout.groups) {
    g.headerY = y;
    y += GROUP_HEADER;
    g.markY = y;                       // riga dei marcatori (solo se il gruppo ne ha)
    if (g.markers.length) y += MARK_ROW;
    g.laneY = y;
    g.height = g.lanes * laneH;
    for (const b of g.items) b.y0 = g.laneY + b.lane * laneH;
    for (const m of g.markers) m.y0 = g.markY;
    y += g.height + GROUP_GAP;
  }
  layout.contentBottom = y;

  const areaH = (H - PAD.bottom) - PAD.top;
  layout.maxScroll = Math.max(0, (layout.contentBottom - PAD.top) - areaH);
  scrollY = Math.max(0, Math.min(layout.maxScroll, scrollY));
}

function draw() {
  ctx.clearRect(0, 0, W, H);
  drawGrid();       // griglia (fissa, non scorre verticalmente)

  // gruppi + bande: clippati all'area e traslati di -scrollY
  ctx.save();
  ctx.beginPath();
  ctx.rect(PAD.left, PAD.top, bandAreaW(), (H - PAD.bottom) - PAD.top);
  ctx.clip();
  ctx.translate(0, -scrollY);
  drawGroups();
  drawBands();
  drawMarkers();
  ctx.restore();

  drawScrollbars();
  drawFocusMark();
  drawCursor();
  scheduleHash();
}

function drawFocusMark() {
  if (focusMark == null) return;
  const x = logToX(focusMark);
  if (x < PAD.left - 1 || x > W - PAD.right + 1) return;
  const hz = Math.pow(10, focusMark);

  ctx.strokeStyle = THEME.accent;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 3]);
  line(x + 0.5, PAD.top, x + 0.5, H - PAD.bottom);
  ctx.setLineDash([]);

  const txt = '◎ ' + fmtHzP(hz, cursorDigits(hz)) + '  ·  ' + fmtLen(freqToLen(hz));
  ctx.font = font(11, 600);
  const tw = ctx.measureText(txt).width;
  const bx = Math.min(Math.max(x - tw / 2 - 8, PAD.left), W - PAD.right - tw - 16);
  const by = PAD.top + 32;
  ctx.fillStyle = THEME.accent;
  roundRect(bx, by, tw + 16, 22, 6); ctx.fill();
  ctx.fillStyle = THEME.accentInk;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(txt, bx + 8, by + 11);
}

// geometria della scrollbar verticale (null se non serve scorrere)
function vScrollGeom() {
  if (layout.maxScroll <= 0) return null;
  const areaH = (H - PAD.bottom) - PAD.top;
  const contentH = layout.contentBottom - PAD.top;
  const x = W - PAD.right - SCROLLBAR_W;
  const thumbH = Math.max(28, areaH * areaH / contentH);
  const thumbY = PAD.top + (areaH - thumbH) * (scrollY / layout.maxScroll);
  return { x, areaH, thumbH, thumbY };
}

// geometria della scrollbar orizzontale (posizione/estensione della vista nello spettro)
function hScrollGeom() {
  const fullSpan = axisMax - axisMin;
  const viewSpan = view.max - view.min;
  const x0 = PAD.left;
  const x1 = W - PAD.right - SCROLLBAR_W - 3;
  const trackW = x1 - x0;
  if (trackW <= 10) return null;
  const frac = Math.min(1, viewSpan / fullSpan);
  const thumbW = Math.max(28, trackW * frac);
  const denom = fullSpan - viewSpan;
  const pos = denom > 1e-9 ? (view.min - axisMin) / denom : 0;
  const thumbX = x0 + (trackW - thumbW) * pos;
  return { x0, trackW, thumbW, thumbX, y: H - 2 - SCROLLBAR_W, h: SCROLLBAR_W, scrollable: denom > 1e-9 };
}

function drawScrollbars() {
  const active = (axis) => (sbDrag && sbDrag.axis === axis) || (!sbDrag && hoverSB === axis);

  const v = vScrollGeom();
  if (v) {
    const r = SCROLLBAR_W / 2;
    ctx.fillStyle = rgba(THEME.muted, .15);                 // traccia
    roundRect(v.x, PAD.top, SCROLLBAR_W, v.areaH, r); ctx.fill();
    ctx.fillStyle = active('v') ? rgba(THEME.muted, .85) : rgba(THEME.muted, .45);
    roundRect(v.x, v.thumbY, SCROLLBAR_W, v.thumbH, r); ctx.fill();
  }
  const h = hScrollGeom();
  if (h) {
    const r = h.h / 2;
    ctx.fillStyle = rgba(THEME.muted, .15);                 // traccia
    roundRect(h.x0, h.y, h.trackW, h.h, r); ctx.fill();
    ctx.fillStyle = !h.scrollable ? rgba(THEME.muted, .2)
                  : active('h') ? rgba(THEME.muted, .85) : rgba(THEME.muted, .45);
    roundRect(h.thumbX, h.y, h.thumbW, h.h, r); ctx.fill();
  }
}

// quale scrollbar è sotto (px,py)? 'h' | 'v' | null  (zona di presa generosa)
function scrollbarAt(px, py) {
  const h = hScrollGeom();
  if (h && h.scrollable && py >= h.y - 7 && py <= h.y + h.h + 7 && px >= h.x0 && px <= h.x0 + h.trackW) return 'h';
  const v = vScrollGeom();
  if (v && px >= v.x - 4 && px <= v.x + SCROLLBAR_W + 4 && py >= PAD.top && py <= H - PAD.bottom) return 'v';
  return null;
}

// applica una posizione del thumb orizzontale (mx = mouse, off = offset di presa)
function setHScroll(mx) {
  const g = hScrollGeom();
  if (!g || !g.scrollable) return;
  const viewSpan = view.max - view.min;
  const tx = Math.max(g.x0, Math.min(g.x0 + g.trackW - g.thumbW, mx - sbDrag.off));
  const pos = (tx - g.x0) / (g.trackW - g.thumbW);
  view.min = axisMin + pos * (axisMax - axisMin - viewSpan);
  view.max = view.min + viewSpan;
  clampViewEdges();
  scheduleDraw();
}

function setVScroll(my) {
  const g = vScrollGeom();
  if (!g) return;
  const ty = Math.max(PAD.top, Math.min(PAD.top + g.areaH - g.thumbH, my - sbDrag.off));
  scrollY = layout.maxScroll * (ty - PAD.top) / (g.areaH - g.thumbH);
  scheduleDraw();
}

function drawGroups() {
  for (const g of layout.groups) {
    const meta = SCOPE_META[g.scope] || SCOPE_META.other;
    // sfondo tenue dell'area corsie
    ctx.fillStyle = meta.tint;
    ctx.fillRect(PAD.left, g.laneY - 2, bandAreaW(), g.height + 4);
    // separatore sotto l'intestazione
    ctx.strokeStyle = THEME.line;
    ctx.lineWidth = 1;
    line(PAD.left, g.headerY + GROUP_HEADER - 0.5, W - PAD.right, g.headerY + GROUP_HEADER - 0.5);
    // etichetta ente
    ctx.fillStyle = THEME.muted;
    ctx.font = font(10, 600);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(meta.label, PAD.left + 4, g.headerY + GROUP_HEADER / 2);
  }
}

function drawGrid() {
  const span = view.max - view.min;
  const pxPerDecade = bandAreaW() / span;

  const dStart = Math.floor(view.min);
  const dEnd = Math.ceil(view.max);

  ctx.font = font(12);
  ctx.textBaseline = 'alphabetic';

  // minor tick: mostra 2..9 quando c'è spazio
  const showMinor = pxPerDecade > 70;
  const labelMinor = pxPerDecade > 360;

  // vista stretta (meno di mezza decade): tacche lineari "tonde" in Hz,
  // altrimenti con lo zoom forte tra due multipli 1..9 il righello resta vuoto
  if (span < LINEAR_TICKS_SPAN) { drawLinearTicks(pxPerDecade); drawRulerFrame(); return; }

  for (let d = dStart; d <= dEnd; d++) {
    drawTick(d, true, pxPerDecade);
    if (showMinor) {
      for (let m = 2; m <= 9; m++) {
        const lf = d + log10(m);
        if (lf < view.min || lf > view.max) continue;
        drawTick(lf, false, pxPerDecade, labelMinor);
      }
    }
  }

  drawRulerFrame();
}

function drawLinearTicks(pxPerDecade) {
  const f0 = Math.pow(10, view.min), f1 = Math.pow(10, view.max);
  const raw = (f1 - f0) / (bandAreaW() / 120);              // un'etichetta ogni ~120 px
  const p = Math.pow(10, Math.floor(log10(raw)));
  const n = raw / p;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
  const sig = Math.max(3, Math.ceil(log10(f1 / step)) + 1);  // cifre per distinguere tacche vicine
  for (let k = Math.ceil(f0 / step); k * step <= f1; k++) {
    drawTick(log10(k * step), true, pxPerDecade, false, sig);
  }
}

function drawRulerFrame() {
  // basi dei righelli
  ctx.strokeStyle = THEME.lineStrong;
  ctx.lineWidth = 1;
  line(PAD.left, PAD.top - 0.5, W - PAD.right, PAD.top - 0.5);
  line(PAD.left, H - PAD.bottom + 0.5, W - PAD.right, H - PAD.bottom + 0.5);

  // titoli righelli
  ctx.fillStyle = THEME.faint;
  ctx.font = font(11);
  ctx.textAlign = 'left';
  ctx.fillText('FREQUENZA', PAD.left + 2, 16);
  ctx.fillText('LUNGHEZZA D’ONDA', PAD.left + 2, H - 14);
}

function drawTick(logF, major, pxPerDecade, labelMinor, sig) {
  const x = logToX(logF);
  if (x < PAD.left - 1 || x > W - PAD.right + 1) return;
  const hz = Math.pow(10, logF);

  ctx.strokeStyle = major ? THEME.line : rgba(THEME.line, .5);
  ctx.lineWidth = 1;
  // linea verticale di griglia attraverso l'area bande
  line(x + 0.5, PAD.top, x + 0.5, H - PAD.bottom);

  // tacche sui righelli
  ctx.strokeStyle = major ? THEME.lineStrong : THEME.line;
  line(x + 0.5, PAD.top - 7, x + 0.5, PAD.top);
  line(x + 0.5, H - PAD.bottom, x + 0.5, H - PAD.bottom + 7);

  if (major || labelMinor) {
    ctx.fillStyle = major ? THEME.ink : THEME.muted;
    ctx.font = font(major ? 12 : 11);
    ctx.textAlign = 'center';
    // Hz in alto
    ctx.fillText(sig ? fmtHzP(hz, sig) : fmtHz(hz), x, PAD.top - 12);
    // λ in basso
    ctx.fillText(fmtLen(freqToLen(hz), sig), x, H - PAD.bottom + 20);
  }
}

function drawBands() {
  const bh = layout.laneH - LANE_GAP;

  for (const b of bands) {
    const x0 = logToX(b.logFrom);
    const x1 = logToX(b.logTo);
    const w = x1 - x0;
    if (w < MIN_BAND_PX) continue;                 // LOD: troppo stretta → nascosta
    if (x1 < PAD.left || x0 > W - PAD.right) continue;

    const y = b.y0;
    const cx0 = Math.max(x0, PAD.left);
    const cx1 = Math.min(x1, W - PAD.right);
    const cw = cx1 - cx0;
    if (cw <= 0) continue;

    const col = bandColor(b);
    const isHover = hovered === b;
    const isSel = selected === b;

    // riempimento
    const cat = categories[b.category];
    if (cat && cat.gradient) {
      paintVisible(cx0, y, cw, bh, b);
    } else {
      ctx.fillStyle = rgba(col, isHover || isSel ? 0.42 : 0.26);
      roundRect(cx0, y, cw, bh, 5);
      ctx.fill();
    }

    // bordo (lo scope influenza lo stile: italy/fisica = pieno, world/europe = tratteggiato)
    ctx.lineWidth = isSel ? 2.2 : (isHover ? 1.8 : 1.1);
    ctx.strokeStyle = rgba(col, isHover || isSel ? 1 : 0.75);
    applyScopeDash(b.scope);
    roundRect(cx0, y, cw, bh, 5);
    ctx.stroke();
    ctx.setLineDash([]);

    if (w >= LABEL_MIN_PX) drawBandLabel(b, cx0, cx1, y, bh);
  }
}

// Un marcatore compare quando la sua banda madre è abbastanza larga da dargli contesto
function markerVisible(m) {
  const p = m.parent && bandById.get(m.parent);
  if (p) return logToX(p.logTo) - logToX(p.logFrom) >= MARKER_PARENT_PX;
  return view.max - view.min <= MARKER_NOPARENT_SPAN;
}

// Frequenze singole: pallino nella riga marcatori del gruppo, linea verticale sulle
// corsie sottostanti, etichetta solo se c'è spazio fino al pallino successivo.
function drawMarkers() {
  const left = PAD.left, right = W - PAD.right;
  let hoverLabel = null;
  ctx.font = font(11, 600);
  for (const g of layout.groups) {
    const vis = [];
    for (const m of g.markers) {       // già ordinati per frequenza
      m.x = null;
      if (!markerVisible(m)) continue;
      const x = logToX(m.logFrom);
      if (x < left || x > right) continue;
      m.x = x;
      vis.push(m);
    }
    vis.forEach((m, i) => {
      const x = m.x;
      const col = bandColor(m);
      const on = hovered === m || selected === m;
      const cy = g.markY + MARK_ROW / 2;
      ctx.strokeStyle = rgba(col, on ? 1 : 0.5);
      ctx.lineWidth = on ? 2 : 1;
      ctx.setLineDash(on ? [] : [3, 3]);
      line(x + 0.5, cy + 4, x + 0.5, g.laneY + g.height);
      ctx.setLineDash([]);
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(x + 0.5, cy, on ? 4.5 : 3.5, 0, Math.PI * 2); ctx.fill();

      const tw = ctx.measureText(m.name).width;
      const lx = x + 8;
      const limit = i + 1 < vis.length ? vis[i + 1].x - 8 : right;
      if (on) hoverLabel = { m, lx, cy, tw };
      else if (lx + tw < limit) {
        ctx.fillStyle = rgba(THEME.ink, .8);
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(m.name, lx, cy + 0.5);
      }
    });
  }
  // l'etichetta del marcatore attivo si scrive sempre, su fondo pieno, sopra le altre
  if (hoverLabel) {
    const { m, cy, tw } = hoverLabel;
    const lx = Math.min(hoverLabel.lx, right - tw - 10);
    ctx.fillStyle = THEME.surface;
    roundRect(lx - 5, cy - 9, tw + 10, 18, 5); ctx.fill();
    ctx.strokeStyle = bandColor(m); ctx.lineWidth = 1;
    roundRect(lx - 5, cy - 9, tw + 10, 18, 5); ctx.stroke();
    ctx.fillStyle = THEME.ink;
    ctx.font = font(11, 600);
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(m.name, lx, cy + 0.5);
  }
}

function paintVisible(x, y, w, h, b) {
  // gradiente arcobaleno reale lungo la banda (sx = bassa f = rosso, dx = alta f = violetto)
  const grad = ctx.createLinearGradient(x, 0, x + w, 0);
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const logF = b.logFrom + t * (b.logTo - b.logFrom);
    // mappa rispetto alla porzione visibile
    const lf = view.min + (x - PAD.left + t * w) / bandAreaW() * (view.max - view.min);
    const nm = freqToLen(Math.pow(10, lf)) * 1e9;
    grad.addColorStop(t, wavelengthToRGB(nm));
  }
  ctx.fillStyle = grad;
  roundRect(x, y, w, h, 5);
  ctx.globalAlpha = 0.85;
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawBandLabel(b, x0, x1, y, h) {
  const pad = 8;
  const w = x1 - x0;
  const twoLines = h >= 34;            // sotto questa altezza: solo il nome, su una riga
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0 + 2, y, w - 4, h);
  ctx.clip();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  if (twoLines) {
    ctx.fillStyle = THEME.ink;
    ctx.font = font(13, 600);
    ctx.fillText(b.name, x0 + pad, y + h / 2 - 8);

    ctx.fillStyle = THEME.muted;
    ctx.font = font(11);
    let sub = fmtHzP(b.from) + ' – ' + fmtHzP(b.to);
    if (b.mode) sub += '  ·  ' + modeLabel(b.mode);
    ctx.fillText(sub, x0 + pad, y + h / 2 + 9);
  } else {
    ctx.fillStyle = THEME.ink;
    ctx.font = font(12, 600);
    ctx.fillText(b.name, x0 + pad, y + h / 2);
  }
  ctx.restore();
}

function modeLabel(m) {
  return { cw: 'CW', phone: 'Fonia', digital: 'Digitale', mixed: 'Misto' }[m] || m;
}

function applyScopeDash(scope) {
  if (scope === 'world') ctx.setLineDash([2, 3]);
  else if (scope === 'europe') ctx.setLineDash([7, 3]);
  else ctx.setLineDash([]); // italy / physics → pieno
}

function drawCursor() {
  if (!mouse.inside) return;
  const x = mouse.x;
  if (x < PAD.left || x > W - PAD.right) return;
  const logF = xToLog(x);
  const hz = Math.pow(10, logF);

  ctx.strokeStyle = rgba(THEME.ink, .4);
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  line(x + 0.5, PAD.top, x + 0.5, H - PAD.bottom);
  ctx.setLineDash([]);

  // etichetta fluttuante
  const txt = fmtHzP(hz, cursorDigits(hz)) + '   ·   ' + fmtLen(freqToLen(hz));
  ctx.font = font(12, 600);
  const tw = ctx.measureText(txt).width;
  const bx = Math.min(Math.max(x - tw / 2 - 8, PAD.left), W - PAD.right - tw - 16);
  const by = PAD.top + 4;
  ctx.fillStyle = THEME.surface;
  roundRect(bx, by, tw + 16, 24, 6); ctx.fill();
  ctx.strokeStyle = THEME.lineStrong; ctx.lineWidth = 1;
  roundRect(bx, by, tw + 16, 24, 6); ctx.stroke();
  ctx.fillStyle = THEME.ink;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(txt, bx + 8, by + 13);
}

// primitive canvas
function line(x0, y0, x1, y1) {
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
}
function roundRect(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ================= Hit testing =================

function bandAt(px, py) {
  if (py < PAD.top || py > H - PAD.bottom) return null;
  // con il packing le bande non si sovrappongono: al più una corrisponde
  const bh = layout.laneH - LANE_GAP;
  for (const b of bands) {
    const x0 = logToX(b.logFrom);
    const x1 = logToX(b.logTo);
    if (x1 - x0 < MIN_BAND_PX) continue;
    const y = b.y0 - scrollY;
    if (px >= Math.max(x0, PAD.left) && px <= Math.min(x1, W - PAD.right) &&
        py >= y && py <= y + bh) {
      return b;
    }
  }
  return null;
}

// Marcatore più vicino in orizzontale (entro `tol` px, il doppio sulla riga dei pallini)
function markerAt(px, py, tol) {
  if (py < PAD.top || py > H - PAD.bottom) return null;
  let best = null, bestD = Infinity;
  for (const g of layout.groups) {
    if (!g.markers.length) continue;
    const top = g.markY - scrollY, bottom = g.laneY + g.height - scrollY;
    if (py < top || py > bottom) continue;
    const t = py < top + MARK_ROW ? tol * 2 : tol;
    for (const m of g.markers) {
      if (m.x == null) continue;
      const d = Math.abs(px - m.x);
      if (d <= t && d < bestD) { bestD = d; best = m; }
    }
  }
  return best;
}

// i marcatori hanno la precedenza: sono sottili e stanno sopra le bande
const itemAt = (px, py, touch) => markerAt(px, py, touch ? 10 : 4) || bandAt(px, py);

// ================= Interazione =================

function onWheel(e) {
  e.preventDefault();
  const span = view.max - view.min;

  // --- Zoom: Ctrl/Cmd + rotella, centrato sul cursore ---
  if (e.ctrlKey || e.metaKey) {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const f = (mx - PAD.left) / bandAreaW();           // frazione orizzontale
    const cursorLog = view.min + f * span;
    const factor = Math.pow(1.0016, e.deltaY);          // >1 zoom out, <1 zoom in
    let zSpan = Math.min(Math.max(span * factor, TAU_MIN_SPAN), axisMax - axisMin);
    view.min = cursorLog - f * zSpan;
    view.max = cursorLog + (1 - f) * zSpan;
    clampViewEdges();
    scheduleDraw();
    return;
  }

  // --- Pan orizzontale (frequenze): scroll orizzontale (deltaX) o Shift + rotella ---
  let horiz = 0;
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) horiz = e.deltaX;
  else if (e.shiftKey) horiz = e.deltaY;
  if (horiz !== 0) {
    const dLog = horiz / bandAreaW() * span;          // scroll a destra → frequenze più alte
    view.min += dLog;
    view.max += dLog;
    clampViewEdges();
    scheduleDraw();
    return;
  }

  // --- Scroll verticale (rotella nuda) ---
  if (layout.maxScroll > 0) {
    scrollY = Math.max(0, Math.min(layout.maxScroll, scrollY + e.deltaY));
    scheduleDraw();
  }
}

// clamp che preserva lo span (per pan/zoom ai bordi)
function clampViewEdges() {
  const span = view.max - view.min;
  if (view.min < axisMin) { view.min = axisMin; view.max = axisMin + span; }
  if (view.max > axisMax) { view.max = axisMax; view.min = axisMax - span; }
  if (view.max - view.min > axisMax - axisMin) { view.min = axisMin; view.max = axisMax; }
}

// ---- Puntatori (mouse, penna, touch) ----
// Un dito / tasto sinistro trascinato sposta le frequenze (↔) e le corsie (↕);
// due dita fanno lo zoom a pizzico; un tocco senza movimento seleziona.
const pointers = new Map();       // pointerId → {x, y} nel canvas
let gesture = null;               // {type:'pan', sx, sy, lx, ly, moved, touch} | {type:'pinch', d0, span0, anchor, my}

function localXY(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

const clampScroll = (y) => Math.max(0, Math.min(layout.maxScroll, y));

function startPan(p, touch, moved) {
  gesture = { type: 'pan', sx: p.x, sy: p.y, lx: p.x, ly: p.y, moved, touch };
}

function startPinch() {
  const [a, b] = [...pointers.values()];
  gesture = {
    type: 'pinch',
    d0: Math.hypot(a.x - b.x, a.y - b.y) || 1,
    span0: view.max - view.min,
    anchor: xToLog((a.x + b.x) / 2),   // frequenza che resta sotto il centro delle dita
    my: (a.y + b.y) / 2,
  };
}

function onPointerDown(e) {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const p = localXY(e);
  try { canvas.setPointerCapture(e.pointerId); } catch { /* puntatore sintetico o già rilasciato */ }
  pointers.set(e.pointerId, p);

  if (pointers.size === 1) {
    const sb = scrollbarAt(p.x, p.y);
    if (sb === 'h') {
      const hs = hScrollGeom();
      const onThumb = p.x >= hs.thumbX && p.x <= hs.thumbX + hs.thumbW;
      sbDrag = { axis: 'h', off: onThumb ? p.x - hs.thumbX : hs.thumbW / 2 };
      setHScroll(p.x);
      return;
    }
    if (sb === 'v') {
      const vs = vScrollGeom();
      const onThumb = p.y >= vs.thumbY && p.y <= vs.thumbY + vs.thumbH;
      sbDrag = { axis: 'v', off: onThumb ? p.y - vs.thumbY : vs.thumbH / 2 };
      setVScroll(p.y);
      return;
    }
    startPan(p, e.pointerType !== 'mouse', false);
  } else if (pointers.size === 2) {
    sbDrag = null;
    startPinch();
  }
}

function onPointerMove(e) {
  const p = localXY(e);
  if (e.pointerType === 'mouse') { mouse.x = p.x; mouse.y = p.y; mouse.inside = true; }

  if (sbDrag) {
    if (sbDrag.axis === 'h') setHScroll(p.x);
    else setVScroll(p.y);
    return;
  }

  if (pointers.has(e.pointerId)) {
    pointers.set(e.pointerId, p);

    if (gesture && gesture.type === 'pan') {
      if (!gesture.moved && Math.hypot(p.x - gesture.sx, p.y - gesture.sy) > (gesture.touch ? 8 : 4)) gesture.moved = true;
      if (gesture.moved) {
        const dLog = (p.x - gesture.lx) / bandAreaW() * (view.max - view.min);
        view.min -= dLog; view.max -= dLog;
        clampViewEdges();
        scrollY = clampScroll(scrollY - (p.y - gesture.ly));
        canvas.style.cursor = 'grabbing';
        scheduleDraw();
      }
      gesture.lx = p.x; gesture.ly = p.y;
      return;
    }

    if (gesture && gesture.type === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const span = Math.min(Math.max(gesture.span0 * gesture.d0 / d, TAU_MIN_SPAN), axisMax - axisMin);
      const f = (mx - PAD.left) / bandAreaW();
      view.min = gesture.anchor - f * span;
      view.max = view.min + span;
      clampViewEdges();
      scrollY = clampScroll(scrollY - (my - gesture.my));
      gesture.my = my;
      scheduleDraw();
      return;
    }
  }

  // hover: solo mouse senza tasti premuti
  if (e.pointerType !== 'mouse') return;
  const sb = scrollbarAt(mouse.x, mouse.y);
  hoverSB = sb;
  if (sb) {
    hovered = null;
    canvas.style.cursor = sb === 'v' ? 'ns-resize' : 'ew-resize';
    scheduleDraw();
    return;
  }
  hovered = itemAt(mouse.x, mouse.y, false);
  canvas.style.cursor = hovered ? 'pointer' : 'grab';
  scheduleDraw();
}

function onPointerUp(e) {
  if (!pointers.has(e.pointerId)) return;
  const p = localXY(e);
  pointers.delete(e.pointerId);
  if (sbDrag) { sbDrag = null; return; }

  // tocco o click senza trascinamento → selezione
  if (e.type === 'pointerup' && gesture && gesture.type === 'pan' && !gesture.moved && pointers.size === 0) {
    const it = itemAt(p.x, p.y, gesture.touch);
    if (it) selectBand(it);
    else closePanel();
  }

  // da due dita a una: si riparte con un pan già "mosso" (niente selezione, niente salto)
  if (pointers.size === 1) startPan([...pointers.values()][0], true, true);
  else if (pointers.size === 0) gesture = null;

  if (e.pointerType !== 'mouse') { mouse.inside = false; hovered = null; }
  canvas.style.cursor = e.pointerType === 'mouse' ? 'grab' : 'default';
  scheduleDraw();
}

function onMouseLeave() {
  mouse.inside = false;
  hovered = null;
  hoverSB = null;
  scheduleDraw();
}

// zoom-to-fit animato su una banda; per un marcatore, sulla sua banda madre
// (così compare con il suo contesto) ma centrato sulla frequenza
function zoomToBand(b) {
  let span, center;
  if (b.point) {
    const p = b.parent && bandById.get(b.parent);
    span = p ? Math.max((p.logTo - p.logFrom) * 1.35, TAU_MIN_SPAN) : MARKER_NOPARENT_SPAN * 0.8;
    center = b.logFrom;
  } else {
    span = Math.max((b.logTo - b.logFrom) * 1.35, TAU_MIN_SPAN);
    center = (b.logFrom + b.logTo) / 2;
  }
  animateView(center - span / 2, center + span / 2);
}

let anim = null;
function animateView(toMin, toMax) {
  // clamp target
  let span = Math.min(Math.max(toMax - toMin, TAU_MIN_SPAN), axisMax - axisMin);
  let min = toMin, max = toMin + span;
  if (min < axisMin) { min = axisMin; max = min + span; }
  if (max > axisMax) { max = axisMax; min = max - span; }

  const from = { min: view.min, max: view.max };
  const to = { min, max };
  const t0 = performance.now();
  const dur = 420;
  cancelAnimationFrame(anim);
  function step(now) {
    let t = Math.min(1, (now - t0) / dur);
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // easeInOutQuad
    view.min = from.min + (to.min - from.min) * e;
    view.max = from.max + (to.max - from.max) * e;
    draw();
    if (t < 1) anim = requestAnimationFrame(step);
  }
  anim = requestAnimationFrame(step);
}

// ================= Pannello laterale =================

function selectBand(b) {
  selected = b;
  renderPanel(b);
  zoomToBand(b);
  scrollIntoView(b);
}

// porta la banda dentro l'area visibile verticalmente
function scrollIntoView(b) {
  if (layout.maxScroll <= 0) return;
  const areaTop = PAD.top, areaBottom = H - PAD.bottom;
  const y = b.y0 - scrollY;
  if (y < areaTop + 4) scrollY = Math.max(0, b.y0 - areaTop - 4);
  else if (y + layout.laneH > areaBottom - 4) scrollY = Math.min(layout.maxScroll, b.y0 + layout.laneH - areaBottom + 4);
}

function ancestry(b) {
  const chain = [];
  let p = b.parent;
  const seen = new Set();
  while (p && bandById.has(p) && !seen.has(p)) {
    seen.add(p);
    chain.unshift(bandById.get(p));
    p = bandById.get(p).parent;
  }
  return chain;
}

function renderPanel(b) {
  const col = bandColor(b);
  const cat = categories[b.category];
  const scopeLabel = { world: 'Internazionale (ITU)', europe: 'Europa (CEPT)', italy: 'Italia', physics: 'Fisica EM' }[b.scope] || b.scope || '—';
  const tier = b.sourceTier || 'secondary';

  const crumbs = ancestry(b);
  const crumbHtml = crumbs.length
    ? `<div class="breadcrumb">${crumbs.map(c => `<a data-id="${c.id}">${c.name}</a>`).join(' › ')} › <span>${b.name}</span></div>`
    : '';

  const src = b.source || {};
  const body = `
    ${crumbHtml}
    <h2>${b.name}</h2>
    <div>
      <span class="tag cat" style="background:${col}">${cat ? cat.label : b.category}</span>
      <span class="tag scope">${scopeLabel}</span>
      ${b.mode ? `<span class="tag mode">${modeLabel(b.mode)}</span>` : ''}
    </div>
    <dl>${b.point ? `
      <dt>Frequenza</dt><dd>${fmtHzP(b.from)}</dd>
      <dt>λ</dt><dd>${fmtLen(freqToLen(b.from))}</dd>` : `
      <dt>Da</dt><dd>${fmtHzP(b.from)}</dd>
      <dt>A</dt><dd>${fmtHzP(b.to)}</dd>
      <dt>Larghezza</dt><dd>${fmtHzP(b.to - b.from)}</dd>
      <dt>λ (da)</dt><dd>${fmtLen(freqToLen(b.from))}</dd>
      <dt>λ (a)</dt><dd>${fmtLen(freqToLen(b.to))}</dd>`}
    </dl>
    ${b.notes ? `<p class="notes">${b.notes}</p>` : ''}
    ${window.SDR ? SDR.renderBlock(b) : ''}
    <div class="source">
      <span class="lbl">Fonte <span class="tier ${tier}">${tier === 'primary' ? 'primaria' : 'secondaria'}</span></span>
      ${src.url ? `<a href="${src.url}" target="_blank" rel="noopener">${src.title || src.url}</a>` : '<em>Non specificata</em>'}
      ${src.authority ? `<div class="meta">${src.authority}</div>` : ''}
    </div>
    <button class="copy-link" type="button">🔗 Copia link a questa vista</button>
  `;
  const panel = document.getElementById('panel');
  document.getElementById('panelBody').innerHTML = body;
  panel.classList.remove('hidden');
  panel.querySelectorAll('.breadcrumb a').forEach(a => {
    a.addEventListener('click', () => { const t = bandById.get(a.dataset.id); if (t) selectBand(t); });
  });
  panel.querySelector('.copy-link').addEventListener('click', (e) => copyLink(e.currentTarget));
}

// copia l'URL della vista attuale (il link si aggiorna comunque da solo nella barra)
async function copyLink(btn) {
  writeHash();
  const old = btn.textContent;
  try { await navigator.clipboard.writeText(location.href); btn.textContent = '✓ Link copiato'; }
  catch { btn.textContent = 'Copia il link dalla barra degli indirizzi'; }
  setTimeout(() => { btn.textContent = old; }, 1800);
}

function closePanel() {
  selected = null;
  document.getElementById('panel').classList.add('hidden');
  scheduleDraw();
}

// ================= Filtri (tendina) =================

function buildFilterMenu() {
  const all = [...allRanges, ...allMarkers];
  const scopes = [...SCOPE_ORDER, 'other'].filter((sc) => all.some((b) => scopeKey(b) === sc));
  document.getElementById('fScopes').innerHTML = scopes.map((sc) =>
    `<label class="fm-item"><input type="checkbox" data-scope="${sc}"><span>${SCOPE_META[sc].label}</span></label>`).join('');
  const used = new Set(all.map((b) => b.category));
  document.getElementById('fCats').innerHTML = Object.entries(categories).filter(([k]) => used.has(k)).map(([k, c]) =>
    `<label class="fm-item"><input type="checkbox" data-cat="${k}"><span class="sw" style="background:${c.color}"></span><span>${c.label}</span></label>`).join('');

  const menu = document.getElementById('filterMenu');
  const btn = document.getElementById('filterBtn');
  btn.addEventListener('click', () => {
    const open = !menu.classList.toggle('hidden');
    btn.setAttribute('aria-expanded', open);
  });
  document.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.filters')) { menu.classList.add('hidden'); btn.setAttribute('aria-expanded', 'false'); }
  });
  menu.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.scope) toggle(hiddenScopes, t.dataset.scope, !t.checked);
    else if (t.dataset.cat) toggle(hiddenCats, t.dataset.cat, !t.checked);
    else if (t.id === 'fMarkers') showMarkers = t.checked;
    filtersChanged();
  });
  menu.querySelectorAll('[data-all]').forEach((b) => b.addEventListener('click', () => {
    hiddenCats = b.dataset.all === '1' ? new Set() : new Set(used);
    filtersChanged();
  }));
  syncFilterUI();
}

function toggle(set, key, on) { if (on) set.add(key); else set.delete(key); }

function filtersChanged() {
  applyFilters();
  computeGeometry();
  syncFilterUI();
  scheduleDraw();
}

function syncFilterUI() {
  document.querySelectorAll('#filterMenu [data-scope]').forEach((i) => { i.checked = !hiddenScopes.has(i.dataset.scope); });
  document.querySelectorAll('#filterMenu [data-cat]').forEach((i) => { i.checked = !hiddenCats.has(i.dataset.cat); });
  document.getElementById('fMarkers').checked = showMarkers;
  const n = hiddenScopes.size + hiddenCats.size + (showMarkers ? 0 : 1);
  const badge = document.getElementById('filterCount');
  badge.textContent = n;
  badge.classList.toggle('hidden', n === 0);
}

// ================= Vista nell'URL =================
// #v=min,max (log10 Hz) · sel=id · f=Hz del marker ◎ · hs/hc = enti/categorie nascosti · mk=0

let hashReady = false, hashTimer = 0;
function scheduleHash() {
  if (!hashReady) return;
  clearTimeout(hashTimer);
  hashTimer = setTimeout(writeHash, 250);
}

function writeHash() {
  const q = [];
  const full = Math.abs(view.min - axisMin) < 1e-6 && Math.abs(view.max - axisMax) < 1e-6;
  if (!full) q.push('v=' + view.min.toFixed(5) + ',' + view.max.toFixed(5));
  if (selected) q.push('sel=' + encodeURIComponent(selected.id));
  if (focusMark != null) q.push('f=' + +Math.pow(10, focusMark).toPrecision(10));
  if (hiddenScopes.size) q.push('hs=' + [...hiddenScopes].join(','));
  if (hiddenCats.size) q.push('hc=' + [...hiddenCats].join(','));
  if (!showMarkers) q.push('mk=0');
  const hash = q.length ? '#' + q.join('&') : '';
  if (hash !== location.hash) history.replaceState(null, '', location.pathname + location.search + hash);
}

function readHash() {
  const q = new URLSearchParams(location.hash.slice(1));
  const list = (k) => (q.get(k) || '').split(',').filter(Boolean);
  hiddenScopes = new Set(list('hs'));
  hiddenCats = new Set(list('hc'));
  showMarkers = q.get('mk') !== '0';
  applyFilters();
  computeGeometry();
  syncFilterUI();

  const v = list('v').map(Number);
  const hasView = v.length === 2 && v.every(isFinite) && v[1] - v[0] >= TAU_MIN_SPAN;
  if (hasView) { view.min = v[0]; view.max = v[1]; clampViewEdges(); }
  else { view.min = axisMin; view.max = axisMax; }
  const f = Number(q.get('f'));
  focusMark = f > 0 ? Math.max(axisMin, Math.min(axisMax, log10(f))) : null;

  const sel = bandById.get(q.get('sel') || '');
  if (sel && isShown(sel)) {
    selected = sel;
    renderPanel(sel);
    if (!hasView) zoomToBand(sel);
    scrollIntoView(sel);
  } else if (selected) {
    selected = null;
    document.getElementById('panel').classList.add('hidden');
  }
  draw();
}

// ================= Loop di disegno =================

let drawQueued = false;
function scheduleDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => { drawQueued = false; draw(); });
}

// ================= Resize / setup =================

function resize() {
  DPR = Math.max(1, window.devicePixelRatio || 1);
  const stage = document.getElementById('stage');
  W = stage.clientWidth;
  H = stage.clientHeight;
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  computeGeometry();
  draw();
}

// ================= Ricerca, frequenza e lunghezza d'onda =================

const FREQ_UNITS = {
  '': 1, 'hz': 1, 'k': 1e3, 'khz': 1e3, 'm': 1e6, 'mhz': 1e6, 'g': 1e9, 'ghz': 1e9,
  't': 1e12, 'thz': 1e12, 'p': 1e15, 'phz': 1e15, 'e': 1e18, 'ehz': 1e18,
  'z': 1e21, 'zhz': 1e21, 'y': 1e24, 'yhz': 1e24,
};
const LEN_IN_UNITS = {
  '': 1, 'm': 1, 'km': 1e3, 'dm': 0.1, 'cm': 0.01, 'mm': 1e-3,
  'um': 1e-6, 'nm': 1e-9, 'pm': 1e-12, 'fm': 1e-15, 'mm2': 1e-3,
};

function parseUnitValue(str, table) {
  if (!str) return null;
  const s = str.trim().toLowerCase().replace('µ', 'u').replace(',', '.').replace(/\s+/g, '');
  const m = s.match(/^([0-9]*\.?[0-9]+)([a-z]*)$/);
  if (!m) return null;
  const num = parseFloat(m[1]);
  if (!isFinite(num)) return null;
  if (!(m[2] in table)) return null;
  return num * table[m[2]];
}

const parseFrequency = (str) => parseUnitValue(str, FREQ_UNITS);          // → Hz
const parseWavelength = (str) => parseUnitValue(str, LEN_IN_UNITS);        // → metri

// Centra la vista su una frequenza puntuale e ci mette un marker
function focusFrequency(hz) {
  if (!(hz > 0)) return false;
  let logF = Math.max(axisMin, Math.min(axisMax, log10(hz)));
  focusMark = logF;
  const cur = view.max - view.min;
  const full = axisMax - axisMin;
  const span = cur > full * 0.85 ? Math.min(4, full) : cur;  // se molto fuori, avvicina a ~4 decadi
  animateView(logF - span / 2, logF + span / 2);
  return true;
}

// --- Ricerca per nome (e id/note/autorità come fallback) ---
function runSearch(q) {
  const box = document.getElementById('searchResults');
  q = q.trim().toLowerCase();
  if (q.length < 2) { box.classList.add('hidden'); box.innerHTML = ''; searchMatches = []; searchActive = -1; return; }
  const norm = (s) => (s || '').toLowerCase();
  const scored = [];
  for (const b of bands) {
    const nm = norm(b.name);
    let score = -1;
    if (nm.startsWith(q)) score = 0;
    else if (nm.includes(q)) score = 1;
    else if (norm(b.id).includes(q) || norm(b.notes).includes(q) || norm(b.source && b.source.authority).includes(q)) score = 2;
    if (score >= 0) scored.push({ b, score });
  }
  scored.sort((a, b) => a.score - b.score || a.b.from - b.b.from);
  searchMatches = scored.slice(0, 40).map((s) => s.b);
  searchActive = searchMatches.length ? 0 : -1;
  renderResults();
}

const SCOPE_SHORT = { world: 'Mondo', europe: 'Europa', italy: 'Italia', physics: 'Fisica' };

function renderResults() {
  const box = document.getElementById('searchResults');
  if (!searchMatches.length) {
    box.innerHTML = '<div class="empty">Nessuna banda trovata</div>';
    box.classList.remove('hidden');
    return;
  }
  box.innerHTML = searchMatches.map((b, i) => {
    const cat = categories[b.category];
    const bits = [SCOPE_SHORT[b.scope] || b.scope, cat ? cat.label : b.category];
    if (b.mode) bits.push(modeLabel(b.mode));
    return `<div class="res${i === searchActive ? ' active' : ''}" data-i="${i}">
      <span class="dot" style="background:${bandColor(b)}"></span>
      <span class="txt"><div class="nm">${b.name}</div><div class="sub">${bits.join(' · ')}</div></span>
      <span class="rng">${b.point ? fmtHzP(b.from) : fmtHzP(b.from, 4) + '–' + fmtHzP(b.to, 4)}</span>
    </div>`;
  }).join('');
  box.classList.remove('hidden');
  box.querySelectorAll('.res').forEach((el) => {
    el.addEventListener('mousedown', (e) => { e.preventDefault(); chooseResult(+el.dataset.i); });
  });
}

function chooseResult(i) {
  const b = searchMatches[i];
  if (!b) return;
  document.getElementById('searchResults').classList.add('hidden');
  selectBand(b);
}

async function init() {
  canvas = document.getElementById('spectrum');
  ctx = canvas.getContext('2d');

  try {
    await loadData();
  } catch (err) {
    console.error(err);
    document.getElementById('loadError').classList.remove('hidden');
    return;
  }

  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readTheme(); scheduleDraw(); });
  resize();
  new ResizeObserver(resize).observe(document.getElementById('stage'));   // anche quando la barra va a capo
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !pointers.size) onMouseLeave(); });
  document.getElementById('resetBtn').addEventListener('click', () => { focusMark = null; animateView(axisMin, axisMax); });
  document.getElementById('panelClose').addEventListener('click', closePanel);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePanel(); });

  setupControls();
  buildFilterMenu();
  if (location.hash.length > 1) readHash();
  hashReady = true;
  window.addEventListener('hashchange', readHash);   // link incollato nella stessa scheda
}

function setupControls() {
  const search = document.getElementById('searchInput');
  const results = document.getElementById('searchResults');
  const freq = document.getElementById('freqInput');
  const wave = document.getElementById('waveInput');

  // --- ricerca ---
  search.addEventListener('input', () => runSearch(search.value));
  search.addEventListener('focus', () => { if (search.value.trim().length >= 2) runSearch(search.value); });
  search.addEventListener('keydown', (e) => {
    if (!searchMatches.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); searchActive = (searchActive + 1) % searchMatches.length; renderResults(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); searchActive = (searchActive - 1 + searchMatches.length) % searchMatches.length; renderResults(); }
    else if (e.key === 'Enter') { e.preventDefault(); chooseResult(searchActive < 0 ? 0 : searchActive); }
    else if (e.key === 'Escape') { e.stopPropagation(); results.classList.add('hidden'); }
  });
  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.search')) results.classList.add('hidden');
  });

  // --- frequenza ↔ lunghezza d'onda (sincronizzati) ---
  const mark = (el, ok) => el.classList.toggle('bad', !ok);

  freq.addEventListener('input', () => {
    const hz = parseFrequency(freq.value);
    if (freq.value.trim() === '') { freq.classList.remove('bad'); return; }
    mark(freq, hz != null);
    if (hz != null) wave.value = fmtLen(freqToLen(hz));
  });
  wave.addEventListener('input', () => {
    const m = parseWavelength(wave.value);
    if (wave.value.trim() === '') { wave.classList.remove('bad'); return; }
    mark(wave, m != null && m > 0);
    if (m != null && m > 0) freq.value = fmtHz(freqToLen(m)); // λ→f simmetrico (c/λ)
  });
  freq.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const hz = parseFrequency(freq.value);
    if (hz != null && focusFrequency(hz)) { wave.value = fmtLen(freqToLen(hz)); freq.classList.remove('bad'); }
    else mark(freq, false);
  });
  wave.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const m = parseWavelength(wave.value);
    const hz = m != null && m > 0 ? freqToLen(m) : null;   // f = c/λ
    if (hz != null && focusFrequency(hz)) { freq.value = fmtHz(hz); wave.classList.remove('bad'); }
    else mark(wave, false);
  });
}

init();
