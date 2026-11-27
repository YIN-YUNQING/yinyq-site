import { T, N, lang, setLang, LANGS } from './i18n.js?v=7cf97dd6';

// 切换工作站 · 网页版。读同一个音乐包（bank.json），能看切换图、试听连线、连播、改连线、改音符。
// 所有改动只存在这台浏览器里（localStorage），问卷页会把改动和操作记录一起带走。

const $ = s => document.querySelector(s);
const PAL = ['#62b0ff', '#f0a43c', '#6fd08c', '#f2789f', '#b497ff', '#4fd1c5', '#e6cf5a', '#ff8a65'];
const INST = { bell: '#8ecbff', bass: '#ff9a6b', pulse: '#c9a0ff', arp: '#84dd98', pad: '#e8d06a', guitar: '#ff7d92', drums: '#b7beca' };
const ACCENT = '#f0a43c', PLAY = '#62b0ff';
const FONT = getComputedStyle(document.body).fontFamily;
const NOTE = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const DRUMS = [49, 46, 42, 38, 37, 41, 36];

let bank, pristine, byId = new Map(), from = new Map(), linkById = new Map(), pos = new Map(), groups = [];
const view = { x: 20, y: 20, k: 0.7 };
const ui = { sel: null, channel: null, chain: [], selLink: null, hoverLink: null, hoverBlock: null, preRoll: 1, loop: false, thickness: 1, drag: null, lastPlay: null, pendingExit: null, userStopped: true };
const play = { playing: false, blockId: -1, step: 0, bpm: 120, at: 0 };
let dirty = true;
const changed = new Set(); let linksChanged = false; const undoStack = [];

// ---------- 操作记录 ----------
const t0 = Date.now(); let logBuf = [];
try { logBuf = JSON.parse(localStorage.getItem('seam.log.v1') || '[]'); } catch {}
let logTimer = 0;
function log(type, data = {}) {
  logBuf.push({ t: Date.now(), type, ...data });
  if (logBuf.length > 6000) logBuf.splice(0, logBuf.length - 6000);
  clearTimeout(logTimer); logTimer = setTimeout(() => { try { localStorage.setItem('seam.log.v1', JSON.stringify(logBuf)); } catch {} }, 400);
}

// ---------- 音频 ----------
let actx = null, node = null, audioP = null;
function ensureAudio() {
  if (audioP) { if (actx && actx.state !== 'running') actx.resume(); return audioP; }
  audioP = (async () => {
    actx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    await actx.audioWorklet.addModule('worklet.js?v=7cf97dd6');
    node = new AudioWorkletNode(actx, 'seam', { numberOfInputs: 0, outputChannelCount: [2] });
    node.port.onmessage = e => onAudio(e.data);
    node.connect(actx.destination);
    node.port.postMessage({ t: 'bank', bank, thickness: ui.thickness });
    if (actx.state !== 'running') await actx.resume();
  })();
  return audioP;
}
function send(m) { ensureAudio().then(() => node.port.postMessage(m)); }
function onAudio(m) {
  if (m.t !== 'state') return;
  const was = play.playing;
  play.playing = m.playing; play.blockId = m.blockId; play.step = m.step; play.bpm = m.bpm; play.at = performance.now();
  if (was && !m.playing && !ui.userStopped && ui.loop && ui.lastPlay) setTimeout(() => { if (!play.playing && ui.loop && !ui.userStopped) send(ui.lastPlay); }, 350);
  if (was !== m.playing) { updateStatus(); dirty = true; }
}
function stopAll() { ui.userStopped = true; send({ t: 'stop' }); log('stop'); }

// ---------- 数据 ----------
function index() {
  byId = new Map(bank.blocks.map(b => [b.id, b]));
  from = new Map(); linkById = new Map();
  for (const l of bank.links) { if (!from.has(l.from)) from.set(l.from, []); from.get(l.from).push(l); linkById.set(l.id, l); }
}
const out = id => from.get(id) || [];
const tails = id => out(id).filter(l => l.exitBar < 0);
const total = b => b.bars * b.beatsPerBar * 4;
function save() {
  const blocks = {}; for (const id of changed) blocks[id] = byId.get(id);
  try { localStorage.setItem('seam.edits.v1', JSON.stringify({ links: linksChanged ? bank.links : null, blocks })); } catch {}
}
function restore() {
  try {
    const e = JSON.parse(localStorage.getItem('seam.edits.v1') || 'null'); if (!e) return;
    if (e.links) { bank.links = e.links; linksChanged = true; }
    for (const id in e.blocks || {}) { const i = bank.blocks.findIndex(b => b.id === +id); if (i >= 0) { bank.blocks[i] = e.blocks[id]; changed.add(+id); } }
  } catch {}
}

// ---------- 布局 ----------
const BW = 118, X0 = 60;
function layout() {
  pos = new Map(); groups = [];
  let y = 70;
  for (const th of bank.blocks.filter(b => b.role === 'theme')) {
    pos.set(th.id, { x: X0, y, w: th.bars * BW, h: 64, barW: BW });
    const brs = bank.blocks.filter(b => b.role === 'bridge' && b.beatsPerBar === th.beatsPerBar).sort((a, b) => a.srcBar - b.srcBar);
    const by = y + 64 + 62;
    for (const br of brs) pos.set(br.id, { x: X0 + br.srcBar * BW + 12, y: by, w: BW - 24, h: 50, barW: (BW - 24) / br.bars });
    const boss = brs.length ? brs[0].target : '';
    let x = X0; const py = by + 50 + 76;
    for (const part of ['p1', 'p2', 'p3', 'intro', 'victory', 'defeat']) {
      const b = bank.blocks.find(q => q.role === 'boss' && q.target === boss && q.part === part); if (!b) continue;
      const w = Math.max(132, b.bars * 44);
      pos.set(b.id, { x, y: py, w, h: 58, barW: w / b.bars });
      x += w + (part === 'p3' ? 90 : 48);
    }
    groups.push({ y: y - 44, label: `${th.beatsPerBar}/${th.beatsPerBar >= 8 ? 8 : 4}`, boss });
    y = py + 58 + 120;
  }
}
function exitPt(l) {
  const p = pos.get(l.from);
  return l.exitBar < 0 ? { x: p.x + p.w, y: p.y + p.h / 2, d: 'r' } : { x: p.x + (l.exitBar + 1) * p.barW - 10, y: p.y + p.h, d: 'd' };
}
function curve(l) {
  if (l._c) return l._c;
  const p = pos.get(l.from), q = pos.get(l.to); if (!p || !q) return null;
  const a = exitPt(l); let b, c1, c2;
  if (l.from === l.to) {
    b = { x: q.x, y: q.y + q.h / 2 };
    c1 = { x: a.x + 70, y: a.y - 110 }; c2 = { x: b.x - 70, y: b.y - 110 };
  } else {
    if (l.entryBar >= 0) b = a.y > q.y + q.h ? { x: q.x + l.entryBar * q.barW + 10, y: q.y + q.h, d: 'b' } : { x: q.x + l.entryBar * q.barW + 10, y: q.y, d: 'u' };
    else b = a.y + 16 < q.y ? { x: q.x + 12, y: q.y, d: 'u' } : { x: q.x, y: q.y + q.h / 2, d: 'l' };
    const dist = Math.hypot(b.x - a.x, b.y - a.y), d = Math.max(26, Math.min(170, dist * 0.42));
    c1 = a.d === 'd' ? { x: a.x, y: a.y + d } : { x: a.x + d, y: a.y };
    c2 = b.d === 'u' ? { x: b.x, y: b.y - d } : b.d === 'b' ? { x: b.x, y: b.y + d } : { x: b.x - d, y: b.y };
  }
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24, u = 1 - t;
    pts.push({ x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x, y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y });
  }
  return (l._c = { a, b, c1, c2, pts });
}

// ---------- 通道 ----------
function chanKey(l) { const to = byId.get(l.to); return l.to === l.from ? 'self' : to.role === 'bridge' ? 'br:' + to.target : 'b:' + l.to; }
function channelsOf(id) {
  const map = new Map();
  for (const l of out(id)) {
    const k = chanKey(l), to = byId.get(l.to);
    if (!map.has(k)) map.set(k, { key: k, count: 0, color: PAL[map.size % PAL.length], label: k === 'self' ? T('loopSelf') : to.role === 'bridge' ? T('bridgeTo') + N(to.target) : N(to.name), dests: new Set() });
    const c = map.get(k); c.count++; c.dests.add(l.to);
  }
  return [...map.values()];
}
let chans = [];
function activeLinks() {
  if (ui.sel == null) return [];
  return out(ui.sel).filter(l => !ui.channel || chanKey(l) === ui.channel);
}
function select(id) {
  ui.sel = id; ui.channel = null; ui.selLink = null; ui.pendingExit = null;
  chans = id == null ? [] : channelsOf(id);
  renderLegend(); updateStatus(); dirty = true;
  if (id != null) log('select', { block: byId.get(id).name });
}
function setChannel(k) { ui.channel = ui.channel === k ? null : k; renderLegend(); updateStatus(); dirty = true; log('channel', { key: ui.channel }); }
function renderLegend() {
  const el = $('#legend'); el.hidden = !chans.length;
  $('#legendList').innerHTML = '';
  for (const c of chans) {
    const li = document.createElement('li');
    li.className = ui.channel ? (ui.channel === c.key ? 'on' : 'off') : '';
    li.innerHTML = `<i style="background:${c.color}"></i><span></span><em>×${c.count}</em>`;
    li.children[1].textContent = c.label;
    li.onclick = () => setChannel(c.key);
    $('#legendList').append(li);
  }
}

// ---------- 播放 ----------
function startBar(l) { const f = byId.get(l.from); return Math.max(0, (l.exitBar < 0 ? f.bars - 1 : l.exitBar) - ui.preRoll); }
function finalStop(l) {
  let to = byId.get(l.to);
  if (to.kind === 'bridge') { const t = tails(to.id); if (t.length) to = byId.get(t[0].to); }
  const coda = to.part === 'victory' || to.part === 'defeat';
  return { block: to.id, bars: coda ? to.bars : Math.min(2, to.bars) };
}
function start(msg, what) { ui.userStopped = false; ui.lastPlay = msg; send(msg); log('play', what); }
function audition(l) {
  ui.selLink = l.id;
  start({ t: 'play', block: l.from, bar: startBar(l), links: [l.id], stop: finalStop(l) }, { kind: 'link', link: describe(l, 'zh'), id: l.id });
  updateStatus(); dirty = true;
}
function playChain() {
  const ls = ui.chain.map(id => linkById.get(id)).filter(Boolean); if (!ls.length) return;
  start({ t: 'play', block: ls[0].from, bar: startBar(ls[0]), links: ls.map(l => l.id), stop: finalStop(ls[ls.length - 1]) }, { kind: 'chain', links: ls.map(l => describe(l, 'zh')) });
}
function playBlock(b, bar = 0) {
  let stop = null;
  if (b.kind === 'bridge') { const t = tails(b.id); if (t.length) stop = { block: t[0].to, bars: 1 }; }
  else if (!tails(b.id).length) stop = null;
  start({ t: 'play', block: b.id, bar, links: [], stop }, { kind: 'block', block: b.name, bar });
}
function describe(l, forceLang) {
  const f = byId.get(l.from), to = byId.get(l.to), n = forceLang ? (x => x) : N;
  return `${n(f.name)} ${l.exitBar < 0 ? (forceLang ? '曲尾' : T('tail')) : (forceLang ? '第 ' + (l.exitBar + 1) + ' 小节' : T('bar', { n: l.exitBar + 1 }))} → ${n(to.name)}${to.role === 'bridge' ? '（' + n(to.target) + '）' : ''} [${n(l.ev || '自定')}]`;
}

// ---------- 连播路径 ----------
function chainEnd() {
  if (!ui.chain.length) return ui.sel != null ? { block: ui.sel, bar: 0 } : null;
  const l = linkById.get(ui.chain[ui.chain.length - 1]);
  return { block: l.to, bar: l.entryBar < 0 ? 0 : l.entryBar };
}
function autoTail() {
  const l = linkById.get(ui.chain[ui.chain.length - 1]), to = byId.get(l.to);
  if (to.kind === 'bridge') { const t = tails(to.id); if (t.length === 1) ui.chain.push(t[0].id); }
}
function chainChanged() {
  ui.chain = ui.chain.filter(id => linkById.has(id));
  const e = chainEnd();
  $('#chainBox').hidden = !ui.chain.length; $('#chainN').textContent = ui.chain.length;
  if (ui.chain.length && e) { ui.sel = e.block; ui.channel = null; chans = channelsOf(e.block); renderLegend(); }
  ui.pendingExit = null; updateStatus(); dirty = true;
  log('chain', { n: ui.chain.length });
}
function toggleChain(l) {
  const i = ui.chain.indexOf(l.id);
  if (i >= 0) ui.chain.length = i;
  else {
    const e = chainEnd();
    if (ui.chain.length && e.block !== l.from) ui.chain = [];
    ui.chain.push(l.id); autoTail();
  }
  chainChanged();
}
function chainTo(b, bar) {
  const e = chainEnd();
  if (!e) { select(b.id); return; }
  if (b.id === e.block) { ui.pendingExit = bar; dirty = true; return; }
  const tailDest = id => { const t = tails(id); return t.length ? t[0].to : -1; };
  const cands = out(e.block).filter(l => l.to === b.id || (byId.get(l.to).kind === 'bridge' && tailDest(l.to) === b.id));
  if (!cands.length) { toast('—'); return; }
  const want = ui.pendingExit ?? e.bar;
  const l = cands.find(c => c.exitBar === want) || cands.filter(c => c.exitBar > want).sort((x, y) => x.exitBar - y.exitBar)[0] || cands[0];
  ui.chain.push(l.id); autoTail(); chainChanged();
}

// ---------- 改连线 ----------
function commitLinks(note) {
  linksChanged = true; index();
  for (const l of bank.links) delete l._c;
  if (node) node.port.postMessage({ t: 'links', links: bank.links.map(({ _c, ...r }) => r) });
  if (ui.sel != null) { chans = channelsOf(ui.sel); renderLegend(); }
  save(); chainChanged(); if (note) toast(note);
}
function addLink(fromId, exitBar, toId) {
  const f = byId.get(fromId), to = byId.get(toId);
  if (bank.links.some(l => l.from === fromId && l.exitBar === exitBar && l.to === toId)) return;
  let ev = '自定', entryBar = -1, stinger = 0;
  if (fromId === toId) ev = '循环';
  else if (f.role === 'theme' && to.role === 'bridge') ev = '开战';
  else if (f.role === 'bridge') { ev = '开战'; stinger = 2; }
  else if (f.role === 'theme' && to.role === 'theme') { ev = '换区'; if (exitBar >= 0) entryBar = (exitBar + 1) % to.bars; }
  else if (f.role === 'boss' && to.role === 'boss' && /^p\d/.test(to.part)) { ev = '转阶段'; stinger = 1; if (exitBar >= 0) entryBar = (exitBar + 1) % to.bars; }
  else if (to.part === 'victory') ev = '胜利'; else if (to.part === 'defeat') ev = '失败'; else if (to.role === 'theme') ev = '回探索';
  undoStack.push({ type: 'links', prev: bank.links.map(({ _c, ...r }) => r) });
  const l = { id: Math.max(0, ...bank.links.map(x => x.id), ...bank.blocks.map(x => x.id)) + 1, from: fromId, exitBar, to: toId, entryBar, ev, stinger };
  bank.links.push(l);
  commitLinks(T('linkAdded'));
  ui.selLink = l.id; if (ui.sel !== fromId) select(fromId); ui.selLink = l.id; updateStatus();
  log('addLink', { link: describe(l, 'zh') });
}
function deleteLink(id) {
  const l = linkById.get(id); if (!l) return;
  undoStack.push({ type: 'links', prev: bank.links.map(({ _c, ...r }) => r) });
  log('deleteLink', { link: describe(l, 'zh') });
  bank.links = bank.links.filter(x => x.id !== id);
  ui.selLink = null; commitLinks(T('linkDeleted'));
}
function undo() {
  const u = undoStack.pop(); if (!u) return;
  if (u.type === 'links') { bank.links = u.prev; commitLinks(); }
  else { const b = byId.get(u.block); b.tracks[u.ti].notes = u.prev; commitBlock(b, true); if (ed.block === b) loadNotes(); }
  log('undo', { type: u.type });
}
function commitBlock(b, fromUndo) {
  changed.add(b.id);
  if (node) node.port.postMessage({ t: 'block', block: b });
  save(); dirty = true; ed.dirty = true;
}
function resetAll() {
  if (!confirm(T('confirmReset'))) return;
  bank = JSON.parse(pristine); changed.clear(); linksChanged = false; undoStack.length = 0;
  try { localStorage.removeItem('seam.edits.v1'); } catch {}
  index(); layout(); ui.chain = []; closeEditor(); select(null); chainChanged();
  if (node) node.port.postMessage({ t: 'bank', bank, thickness: ui.thickness });
  log('resetAll');
}

// ---------- 画切换图 ----------
const cv = $('#graph'), g = cv.getContext('2d');
let W = 0, H = 0, dpr = 1;
function resize() {
  dpr = window.devicePixelRatio || 1;
  for (const c of [cv, roll]) {
    const r = c.getBoundingClientRect();
    c.width = Math.max(1, Math.round(r.width * dpr)); c.height = Math.max(1, Math.round(r.height * dpr));
  }
  const r = cv.getBoundingClientRect(); W = r.width; H = r.height; dirty = true; ed.dirty = true;
}
const toWorld = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left - view.x) / view.k, y: (e.clientY - r.top - view.y) / view.k }; };
function rr(c, x, y, w, h, r) { c.beginPath(); c.roundRect(x, y, w, h, r); }
function blockColors(b) {
  if (b.role === 'theme') return ['#2b303a', '#414959'];
  if (b.role === 'bridge') return ['#38322a', '#5a4f3c'];
  if (b.part === 'victory') return ['#27342d', '#3f5a49'];
  if (b.part === 'defeat') return ['#362a2c', '#5c4043'];
  if (b.part === 'intro') return ['#2a2f3a', '#444b63'];
  return ['#2a2d36', '#474b5c'];
}
function strokeCurve(c) { g.beginPath(); g.moveTo(c.a.x, c.a.y); g.bezierCurveTo(c.c1.x, c.c1.y, c.c2.x, c.c2.y, c.b.x, c.b.y); g.stroke(); }
function arrow(c, color) {
  const p = c.pts[24], q = c.pts[22], a = Math.atan2(p.y - q.y, p.x - q.x), s = 7;
  g.fillStyle = color; g.beginPath();
  g.moveTo(p.x, p.y); g.lineTo(p.x - s * Math.cos(a - 0.45), p.y - s * Math.sin(a - 0.45)); g.lineTo(p.x - s * Math.cos(a + 0.45), p.y - s * Math.sin(a + 0.45)); g.fill();
}
function draw() {
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#17181c'; g.fillRect(0, 0, W, H);
  // 点阵网格
  const gs = 40 * view.k;
  if (gs > 12) {
    g.fillStyle = 'rgba(255,255,255,.055)';
    for (let x = ((view.x % gs) + gs) % gs; x < W; x += gs) for (let y = ((view.y % gs) + gs) % gs; y < H; y += gs) g.fillRect(x - 0.5, y - 0.5, 1, 1);
  }
  g.setTransform(dpr * view.k, 0, 0, dpr * view.k, dpr * view.x, dpr * view.y);
  const k = view.k, vx0 = -view.x / k, vy0 = -view.y / k, vx1 = vx0 + W / k, vy1 = vy0 + H / k;
  // 分区标题
  g.textBaseline = 'alphabetic';
  for (const gr of groups) {
    g.font = `650 22px ${FONT}`; g.fillStyle = 'rgba(255,255,255,.2)'; g.fillText(gr.label, X0, gr.y + 8);
    const w = g.measureText(gr.label).width;
    g.font = `500 13px ${FONT}`; g.fillStyle = 'rgba(255,255,255,.28)'; g.fillText(N(gr.boss), X0 + w + 12, gr.y + 7);
  }
  // 连线：先画全部的淡底，再画选中模块的彩色通道
  const act = activeLinks(), actSet = new Set(act), chainSet = new Set(ui.chain);
  g.lineCap = 'round';
  g.lineWidth = 1; g.strokeStyle = ui.sel == null ? 'rgba(255,255,255,.055)' : 'rgba(255,255,255,.022)';
  for (const l of bank.links) { if (actSet.has(l) || chainSet.has(l.id)) continue; const c = curve(l); if (c) strokeCurve(c); }
  const color = new Map(chans.map(c => [c.key, c.color]));
  if (ui.sel != null && ui.channel) {
    g.lineWidth = 1; for (const l of out(ui.sel)) if (!actSet.has(l)) { g.strokeStyle = color.get(chanKey(l)) + '2e'; strokeCurve(curve(l)); }
  }
  for (const l of act) {
    if (chainSet.has(l.id)) continue;
    const c = curve(l), col = color.get(chanKey(l)) || '#ccc', hot = l.id === ui.hoverLink || l.id === ui.selLink;
    g.strokeStyle = col; g.globalAlpha = hot ? 1 : 0.82; g.lineWidth = (hot ? 3 : 1.7) / Math.max(0.6, Math.min(1, k)); strokeCurve(c); arrow(c, col); g.globalAlpha = 1;
  }
  ui.chain.forEach((id, i) => {
    const l = linkById.get(id), c = l && curve(l); if (!c) return;
    g.strokeStyle = '#fff'; g.lineWidth = 3.2 / Math.max(0.6, Math.min(1, k)); strokeCurve(c); arrow(c, '#fff');
    const m = c.pts[12], r = 9 / Math.max(0.6, Math.min(1, k));
    g.fillStyle = ACCENT; g.beginPath(); g.arc(m.x, m.y, r, 0, 7); g.fill();
    g.fillStyle = '#1b1405'; g.font = `700 ${r * 1.15}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(i + 1, m.x, m.y + 0.5); g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  });
  // 方块
  const related = new Set(); if (ui.sel != null) { related.add(ui.sel); for (const l of act) related.add(l.to); for (const id of ui.chain) { const l = linkById.get(id); if (l) { related.add(l.from); related.add(l.to); } } }
  const now = performance.now();
  for (const b of bank.blocks) {
    const p = pos.get(b.id); if (!p || p.x > vx1 || p.x + p.w < vx0 || p.y - 26 > vy1 || p.y + p.h + 10 < vy0) continue;
    g.globalAlpha = ui.sel != null && !related.has(b.id) ? 0.5 : 1;
    drawBlock(b, p, now);
  }
  g.globalAlpha = 1;
  if (ui.drag && ui.drag.type === 'link') {
    const a = exitPt({ from: ui.drag.from, exitBar: ui.drag.exitBar });
    g.strokeStyle = ACCENT; g.lineWidth = 2 / k; g.setLineDash([6 / k, 5 / k]); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(ui.drag.x, ui.drag.y); g.stroke(); g.setLineDash([]);
  }
}
function drawBlock(b, p, now) {
  const [fill, edge] = blockColors(b), sel = ui.sel === b.id, playing = play.playing && play.blockId === b.id, tot = total(b), k = view.k;
  rr(g, p.x, p.y, p.w, p.h, 8); g.fillStyle = fill; g.fill();
  g.save(); g.clip();
  // 小节底纹与小节线
  for (let i = 0; i < b.bars; i++) {
    if (i % 2) { g.fillStyle = 'rgba(255,255,255,.022)'; g.fillRect(p.x + i * p.barW, p.y, p.barW, p.h); }
    if (i) { g.fillStyle = 'rgba(0,0,0,.34)'; g.fillRect(p.x + i * p.barW - 0.5, p.y, 1, p.h); }
  }
  if (ui.pendingExit != null && sel) { g.fillStyle = 'rgba(240,164,60,.2)'; g.fillRect(p.x + ui.pendingExit * p.barW, p.y, p.barW, p.h); }
  // 旋律缩略
  const mel = b.tracks.filter(t => t.role === 'mel');
  let lo = 127, hi = 0;
  for (const t of mel) for (let i = 0; i < t.notes.length; i += 9) { lo = Math.min(lo, t.notes[i]); hi = Math.max(hi, t.notes[i]); }
  if (hi >= lo) {
    const top = p.y + 17, hgt = p.h - 17 - 15, span = Math.max(7, hi - lo);
    g.fillStyle = INST.bell;
    for (const t of mel) for (let i = 0; i < t.notes.length; i += 9) {
      const x = p.x + t.notes[i + 1] / tot * p.w, w = Math.max(2.5, t.notes[i + 2] / tot * p.w - 1.5);
      g.globalAlpha *= 0.9; g.fillRect(x + 1, top + (1 - (t.notes[i] - lo) / span) * hgt, w, 2.6); g.globalAlpha /= 0.9;
    }
  }
  // 小节号、和弦名
  if (p.barW * k > 15) {
    g.font = `600 9px ${FONT}`; g.fillStyle = 'rgba(255,255,255,.4)';
    for (let i = 0; i < b.bars; i++) g.fillText(i + 1, p.x + i * p.barW + 5, p.y + 11);
  }
  if (p.barW * k > 44 && b.harm) {
    g.font = `500 10px ${FONT}`; g.fillStyle = 'rgba(255,255,255,.5)';
    const bs = b.beatsPerBar * 4; let last = '';
    for (const h of b.harm) { if (h.name === last && h.at % bs) continue; last = h.name; g.fillText(h.src ? '·' : h.name, p.x + h.at / tot * p.w + 5, p.y + p.h - 5); }
  }
  // 播放位置
  if (playing) {
    const s = Math.min(tot, play.step + (now - play.at) / 1000 * play.bpm / 60 * 4), x = p.x + s / tot * p.w;
    g.fillStyle = 'rgba(98,176,255,.13)'; g.fillRect(p.x, p.y, x - p.x, p.h);
    g.fillStyle = '#fff'; g.fillRect(x - 0.8, p.y, 1.6, p.h);
  }
  g.restore();
  rr(g, p.x, p.y, p.w, p.h, 8); g.lineWidth = sel || playing ? 2 : 1; g.strokeStyle = sel ? ACCENT : playing ? PLAY : edge; g.stroke();
  // 标题行：▷ ✎ 名字 说明
  const hy = p.y - 9;
  g.fillStyle = playing ? PLAY : '#dfe3ea'; g.beginPath(); g.moveTo(p.x + 3, hy - 9); g.lineTo(p.x + 3, hy + 1); g.lineTo(p.x + 11.5, hy - 4); g.fill();
  g.strokeStyle = ed.block === b ? ACCENT : '#aab1bd'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(p.x + 22, hy + 0.5); g.lineTo(p.x + 24.5, hy - 0.2); g.lineTo(p.x + 31.5, hy - 7.2); g.lineTo(p.x + 29.5, hy - 9.2); g.lineTo(p.x + 22.5, hy - 2.2); g.closePath(); g.stroke();
  g.font = `600 11.5px ${FONT}`; g.fillStyle = '#e7e9ee';
  const name = b.role === 'bridge' ? N('接口') + ' ' + (b.srcBar + 1) : N(b.name);
  g.fillText(name, p.x + 39, hy);
  const nw = g.measureText(name).width;
  const bpm = b.tempo && b.tempo[0] ? Math.round(b.tempo[0].bpm) : 0;
  const meta = b.role === 'bridge' ? (b.rampTo && Math.round(b.rampTo) !== bpm ? `♩${bpm}→${Math.round(b.rampTo)}` : '') : `♩${bpm} · ${b.bars} ${T('bars')}`;
  g.font = `400 10.5px ${FONT}`; g.fillStyle = 'rgba(255,255,255,.4)';
  if (meta && p.x + 39 + nw + 8 + g.measureText(meta).width < p.x + p.w + 30) g.fillText(meta, p.x + 39 + nw + 8, hy);
  // 入口 / 出口圆点：选中或悬停时才显示
  if (sel || ui.hoverBlock === b.id || (ui.drag && ui.drag.type === 'link')) {
    const dot = (x, y, hot) => { g.beginPath(); g.arc(x, y, 3.6, 0, 7); g.fillStyle = hot ? ACCENT : '#1b1d21'; g.fill(); g.lineWidth = 1.4; g.strokeStyle = hot ? ACCENT : PLAY; g.stroke(); };
    for (let i = 0; i < b.bars; i++) dot(p.x + (i + 1) * p.barW - 10, p.y + p.h, ui.hoverNode && ui.hoverNode.block === b.id && ui.hoverNode.bar === i);
    dot(p.x + p.w, p.y + p.h / 2, ui.hoverNode && ui.hoverNode.block === b.id && ui.hoverNode.bar === -1);
  }
}

// ---------- 切换图上的鼠标 ----------
function hit(w) {
  const k = view.k;
  for (const b of bank.blocks) {
    const p = pos.get(b.id); if (!p) continue;
    if (w.y >= p.y - 24 && w.y < p.y - 2 && w.x >= p.x - 2 && w.x < p.x + 36) return { type: w.x < p.x + 17 ? 'playbtn' : 'pen', block: b };
    if (ui.sel === b.id || ui.hoverBlock === b.id) {
      const r = 8 / Math.min(1, k);
      if (Math.hypot(w.x - (p.x + p.w), w.y - (p.y + p.h / 2)) < r) return { type: 'node', block: b, bar: -1 };
      if (Math.abs(w.y - (p.y + p.h)) < r) { const i = Math.round((w.x + 10 - p.x) / p.barW) - 1; if (i >= 0 && i < b.bars && Math.abs(w.x - (p.x + (i + 1) * p.barW - 10)) < r) return { type: 'node', block: b, bar: i }; }
    }
  }
  const tol = 7 / k; let best = null, bd = tol;
  const cand = [...activeLinks(), ...ui.chain.map(id => linkById.get(id)).filter(Boolean)];
  for (const l of cand) { const c = curve(l); if (!c) continue; for (const pt of c.pts) { const d = Math.hypot(pt.x - w.x, pt.y - w.y); if (d < bd) { bd = d; best = l; } } }
  for (const b of bank.blocks) {
    const p = pos.get(b.id); if (!p) continue;
    if (w.x >= p.x && w.x <= p.x + p.w && w.y >= p.y && w.y <= p.y + p.h) {
      if (best && bd < 3 / k) break;
      return { type: 'block', block: b, bar: Math.min(b.bars - 1, Math.floor((w.x - p.x) / p.barW)) };
    }
  }
  if (best) return { type: 'link', link: best };
  return { type: 'blank' };
}
let down = null;
cv.addEventListener('pointerdown', e => {
  ensureAudio();
  const w = toWorld(e), h = hit(w);
  down = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, h, moved: false };
  if (h.type === 'node') ui.drag = { type: 'link', from: h.block.id, exitBar: h.bar, x: w.x, y: w.y };
  cv.setPointerCapture(e.pointerId);
});
cv.addEventListener('pointermove', e => {
  const w = toWorld(e);
  if (down) {
    if (Math.hypot(e.clientX - down.sx, e.clientY - down.sy) > 4) down.moved = true;
    if (ui.drag) { ui.drag.x = w.x; ui.drag.y = w.y; const h = hit(w); ui.hoverBlock = h.block ? h.block.id : null; }
    else if (down.moved) { view.x = down.vx + e.clientX - down.sx; view.y = down.vy + e.clientY - down.sy; cv.style.cursor = 'grabbing'; }
    dirty = true; return;
  }
  const h = hit(w);
  const hl = h.type === 'link' ? h.link.id : null, hb = h.block ? h.block.id : null, hn = h.type === 'node' ? { block: h.block.id, bar: h.bar } : null;
  if (hl !== ui.hoverLink || hb !== ui.hoverBlock || JSON.stringify(hn) !== JSON.stringify(ui.hoverNode || null)) { ui.hoverLink = hl; ui.hoverBlock = hb; ui.hoverNode = hn; dirty = true; }
  cv.style.cursor = h.type === 'blank' ? 'default' : h.type === 'node' ? 'crosshair' : 'pointer';
});
cv.addEventListener('pointerup', e => {
  const d = down; down = null; cv.style.cursor = 'default';
  if (!d) return;
  if (ui.drag) {
    const h = hit(toWorld(e)), dr = ui.drag; ui.drag = null; dirty = true;
    if (d.moved && h.block && (h.type === 'block' || h.type === 'playbtn' || h.type === 'pen')) addLink(dr.from, dr.exitBar, h.block.id);
    return;
  }
  if (d.moved) return;
  const h = d.h;
  if (h.type === 'playbtn') { if (play.playing && play.blockId === h.block.id) stopAll(); else playBlock(h.block); }
  else if (h.type === 'pen') openEditor(h.block);
  else if (h.type === 'link') { if (e.altKey) toggleChain(h.link); else { if (!ui.channel) { ui.channel = chanKey(h.link); renderLegend(); } audition(h.link); } }
  else if (h.type === 'block') { if (e.altKey) chainTo(h.block, h.bar); else if (ui.sel !== h.block.id) select(h.block.id); }
  else if (h.type === 'blank') { if (ui.channel) setChannel(ui.channel); else select(null); }
});
cv.addEventListener('dblclick', e => { const h = hit(toWorld(e)); if (h.type === 'block') playBlock(h.block, h.bar); });
cv.addEventListener('wheel', e => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) {
    const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    const k2 = Math.max(0.18, Math.min(2.2, view.k * Math.exp(-e.deltaY * 0.01)));
    view.x = mx - (mx - view.x) * k2 / view.k; view.y = my - (my - view.y) * k2 / view.k; view.k = k2;
  } else { view.x -= e.deltaX; view.y -= e.deltaY; }
  dirty = true;
}, { passive: false });

// ---------- 钢琴卷帘 ----------
const roll = $('#roll'), rc = roll.getContext('2d');
const ed = { block: null, ti: 0, notes: [], sel: -1, sx: 0, sy: 0, stepW: 14, rowH: 13, drag: null, lastDur: 2, ghost: true, dirty: true, hover: null };
const KEYW = 58, HEAD = 20, TOP = 108, BOTTOM = 24;
function loadNotes() {
  const t = ed.block.tracks[ed.ti]; ed.notes = [];
  for (let i = 0; i + 8 < t.notes.length; i += 9) ed.notes.push(t.notes.slice(i, i + 9));
  ed.sel = -1; ed.dirty = true;
}
const isDrum = () => ed.block.tracks[ed.ti].instrument === 'drums';
const rowOf = p => isDrum() ? DRUMS.indexOf(p) : TOP - p;
const pitchOf = r => isDrum() ? DRUMS[r] : TOP - r;
const rows = () => isDrum() ? DRUMS.length : TOP - BOTTOM + 1;
function openEditor(b) {
  ed.block = b; ed.ti = Math.max(0, b.tracks.findIndex(t => t.role === 'mel'));
  $('#editor').hidden = false; resize();
  renderEdBar(); loadNotes(); fitEditor(); dirty = true;
  log('openEditor', { block: b.name });
}
function closeEditor() { if (!ed.block) return; ed.block = null; $('#editor').hidden = true; resize(); }
function fitEditor() {
  const r = roll.getBoundingClientRect(), tot = total(ed.block);
  ed.stepW = Math.max(7, Math.min(64, (r.width - KEYW - 8) / tot)); ed.sx = 0;
  ed.rowH = isDrum() ? 22 : 13;
  if (isDrum()) ed.sy = 0;
  else {
    let lo = 127, hi = 0; for (const n of ed.notes) { lo = Math.min(lo, n[0]); hi = Math.max(hi, n[0]); }
    if (hi < lo) { lo = 60; hi = 72; }
    ed.sy = Math.max(0, (TOP - (lo + hi) / 2) * ed.rowH - (r.height - HEAD) / 2);
  }
  ed.dirty = true;
}
function renderEdBar() {
  const b = ed.block;
  $('#edName').textContent = b.role === 'bridge' ? `${N('接口')} ${b.srcBar + 1} → ${N(b.target)}` : N(b.name);
  $('#edMeta').textContent = `${b.beatsPerBar}/${b.beatsPerBar >= 8 ? 8 : 4} · ${b.bars} ${T('bars')}`;
  const tabs = $('#edTracks'); tabs.innerHTML = '';
  b.tracks.forEach((t, i) => {
    const bt = document.createElement('button'); bt.className = i === ed.ti ? 'on' : '';
    bt.innerHTML = `<i style="background:${INST[t.instrument] || '#aaa'}"></i><span></span>`; bt.children[1].textContent = N(t.name);
    bt.onclick = () => { ed.ti = i; renderEdBar(); loadNotes(); fitEditor(); log('track', { track: t.name }); };
    tabs.append(bt);
  });
  $('#edFrom').hidden = b.role !== 'bridge';
}
function drawRoll() {
  const r = roll.getBoundingClientRect(), w = r.width, h = r.height, b = ed.block; if (!b) return;
  const tot = total(b), bs = b.beatsPerBar * 4, sw = ed.stepW, rh = ed.rowH, drum = isDrum(), nrows = rows();
  rc.setTransform(dpr, 0, 0, dpr, 0, 0); rc.fillStyle = '#16171b'; rc.fillRect(0, 0, w, h);
  const X = s => KEYW + s * sw - ed.sx, Y = row => HEAD + row * rh - ed.sy;
  rc.save(); rc.beginPath(); rc.rect(KEYW, HEAD, w - KEYW, h - HEAD); rc.clip();
  for (let row = 0; row < nrows; row++) {
    const y = Y(row); if (y > h || y + rh < HEAD) continue;
    const p = pitchOf(row), black = !drum && [1, 3, 6, 8, 10].includes(p % 12);
    rc.fillStyle = black ? '#17181c' : '#1d1f24'; rc.fillRect(KEYW, y, w, rh - 1);
    if (!drum && p % 12 === 0) { rc.fillStyle = 'rgba(255,255,255,.1)'; rc.fillRect(KEYW, y + rh - 1, w, 1); }
  }
  for (let s = 0; s <= tot; s++) {
    const x = X(s); if (x < KEYW - 1 || x > w) continue;
    const bar = s % bs === 0, beat = s % 4 === 0;
    let head = false; if (!bar && beat && b.groupings) { const gp = b.groupings[Math.floor(s / bs)]; let acc = 0; for (const n of (gp ? gp.g : [])) { if (acc * 4 === s % bs) head = true; acc += n; } }
    rc.fillStyle = bar ? 'rgba(255,255,255,.3)' : head ? 'rgba(240,164,60,.3)' : beat ? 'rgba(255,255,255,.1)' : 'rgba(255,255,255,.035)';
    if (bar || beat || sw > 9) rc.fillRect(x, HEAD, 1, h);
  }
  rc.fillStyle = 'rgba(0,0,0,.35)'; rc.fillRect(X(tot), HEAD, w, h);
  const drawNote = (n, col, alpha, sel) => {
    const row = rowOf(n[0]); if (row < 0) return;
    const x = X(n[1]), y = Y(row), ww = Math.max(4, (drum ? 1 : n[2]) * sw - 1.5);
    rc.globalAlpha = alpha; rc.fillStyle = col; rc.beginPath(); rc.roundRect(x + 0.5, y + 1, ww, rh - 3, 2.5); rc.fill();
    rc.globalAlpha = 1; if (sel) { rc.strokeStyle = '#fff'; rc.lineWidth = 1.5; rc.stroke(); }
  };
  if (ed.ghost && !drum) b.tracks.forEach((t, i) => { if (i === ed.ti || t.instrument === 'drums') return; for (let j = 0; j + 8 < t.notes.length; j += 9) drawNote(t.notes.slice(j, j + 9), INST[t.instrument] || '#999', 0.16, false); });
  const col = INST[b.tracks[ed.ti].instrument] || '#9cf';
  ed.notes.forEach((n, i) => drawNote(n, col, 0.6 + 0.4 * Math.min(1, n[3] * 1.4), i === ed.sel));
  if (play.playing && play.blockId === b.id) { const s = play.step + (performance.now() - play.at) / 1000 * play.bpm / 60 * 4; rc.fillStyle = '#fff'; rc.fillRect(X(s) - 0.8, HEAD, 1.6, h); }
  rc.restore();
  // 标尺：小节号与和弦
  rc.fillStyle = '#1d1f24'; rc.fillRect(0, 0, w, HEAD); rc.fillStyle = 'rgba(255,255,255,.1)'; rc.fillRect(0, HEAD - 1, w, 1);
  rc.save(); rc.beginPath(); rc.rect(KEYW, 0, w - KEYW, HEAD); rc.clip();
  rc.font = `600 10px ${FONT}`; rc.textBaseline = 'middle';
  for (let i = 0; i < b.bars; i++) { rc.fillStyle = 'rgba(255,255,255,.55)'; rc.fillText(i + 1, X(i * bs) + 4, HEAD / 2); }
  rc.fillStyle = ACCENT; let last = null;
  for (const hm of b.harm || []) { if (hm.name === last) continue; last = hm.name; rc.fillText(hm.src ? '←' : hm.name, X(hm.at) + 20, HEAD / 2); }
  rc.restore();
  // 琴键
  rc.save(); rc.beginPath(); rc.rect(0, HEAD, KEYW, h - HEAD); rc.clip();
  rc.fillStyle = '#1d1f24'; rc.fillRect(0, HEAD, KEYW, h);
  rc.font = `500 ${drum ? 11 : 9.5}px ${FONT}`;
  for (let row = 0; row < nrows; row++) {
    const y = Y(row); if (y > h || y + rh < HEAD) continue;
    const p = pitchOf(row);
    if (drum) { rc.fillStyle = '#262930'; rc.fillRect(0, y, KEYW - 1, rh - 1); rc.fillStyle = '#cfd3da'; rc.fillText(T('drums')[p] || p, 6, y + rh / 2); continue; }
    const black = [1, 3, 6, 8, 10].includes(p % 12), hot = ed.hover === p;
    rc.fillStyle = hot ? ACCENT : black ? '#2a2c33' : '#d9dce2'; rc.fillRect(0, y, black ? KEYW * 0.62 : KEYW - 1, rh - 1);
    rc.fillStyle = hot ? '#1b1405' : black ? '#aeb4bf' : '#3a3d45';
    rc.fillText(NOTE[p % 12] + (Math.floor(p / 12) - 1), black ? 4 : KEYW - 27, y + rh / 2);
  }
  rc.restore();
}
function rollAt(e) {
  const r = roll.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  return { x, y, step: (x - KEYW + ed.sx) / ed.stepW, row: Math.floor((y - HEAD + ed.sy) / ed.rowH) };
}
function noteAt(a) {
  const drum = isDrum();
  for (let i = ed.notes.length - 1; i >= 0; i--) { const n = ed.notes[i]; if (rowOf(n[0]) === a.row && a.step >= n[1] && a.step < n[1] + (drum ? 1 : Math.max(n[2], 4 / ed.stepW))) return i; }
  return -1;
}
function commitNotes(prev) {
  const t = ed.block.tracks[ed.ti];
  undoStack.push({ type: 'notes', block: ed.block.id, ti: ed.ti, prev });
  const sorted = ed.notes.map((n, i) => ({ n, i })).sort((a, b) => a.n[1] - b.n[1] || a.i - b.i);
  const selNote = ed.sel >= 0 ? ed.notes[ed.sel] : null;
  ed.notes = sorted.map(s => s.n); ed.sel = selNote ? ed.notes.indexOf(selNote) : -1;
  t.notes = ed.notes.flat();
  commitBlock(ed.block);
}
roll.addEventListener('pointerdown', e => {
  if (!ed.block) return; ensureAudio();
  const a = rollAt(e); if (a.x < KEYW || a.y < HEAD || a.row < 0 || a.row >= rows()) return;
  const t = ed.block.tracks[ed.ti], tot = total(ed.block), prev = t.notes.slice();
  let i = noteAt(a);
  if (i >= 0) {
    const n = ed.notes[i]; ed.sel = i;
    const right = KEYW + (n[1] + n[2]) * ed.stepW - ed.sx;
    ed.drag = { mode: !isDrum() && a.x > right - 7 ? 'resize' : 'move', i, prev, s0: a.step, r0: a.row, n0: n.slice(), changed: false };
    send({ t: 'note', instrument: t.instrument, pitch: n[0], amp: 0.5 });
  } else {
    const s = Math.floor(a.step); if (s < 0 || s >= tot) return;
    const amps = ed.notes.map(n => n[3]).sort((x, y) => x - y), amp = amps.length ? amps[amps.length >> 1] : 0.5;
    const n = [pitchOf(a.row), s, isDrum() ? 1 : Math.min(ed.lastDur, tot - s), amp, t.pan, t.send, -1, 0, 0];
    ed.notes.push(n); ed.sel = ed.notes.length - 1;
    ed.drag = { mode: isDrum() ? 'move' : 'resize', i: ed.sel, prev, s0: a.step, r0: a.row, n0: n.slice(), changed: true, created: true };
    send({ t: 'note', instrument: t.instrument, pitch: n[0], amp: 0.5 });
  }
  roll.setPointerCapture(e.pointerId); ed.dirty = true;
});
roll.addEventListener('pointermove', e => {
  if (!ed.block) return;
  const a = rollAt(e), d = ed.drag;
  const hp = a.row >= 0 && a.row < rows() && !isDrum() ? pitchOf(a.row) : null; if (hp !== ed.hover) { ed.hover = hp; ed.dirty = true; }
  if (!d) { const i = a.x >= KEYW ? noteAt(a) : -1; roll.style.cursor = i >= 0 ? (!isDrum() && a.x > KEYW + (ed.notes[i][1] + ed.notes[i][2]) * ed.stepW - ed.sx - 7 ? 'ew-resize' : 'grab') : 'crosshair'; return; }
  const n = ed.notes[d.i], tot = total(ed.block);
  if (d.mode === 'resize') { const dur = Math.max(1, Math.min(tot - n[1], Math.round(a.step - n[1] + 0.3))); if (dur !== n[2]) { n[2] = dur; d.changed = true; } }
  else {
    const s = Math.max(0, Math.min(tot - (isDrum() ? 1 : n[2]), Math.round(d.n0[1] + a.step - d.s0))), row = Math.max(0, Math.min(rows() - 1, d.r0 + (a.row - d.r0) + (rowOf(d.n0[0]) - d.r0))), p = pitchOf(row);
    if (s !== n[1] || p !== n[0]) { if (p !== n[0]) send({ t: 'note', instrument: ed.block.tracks[ed.ti].instrument, pitch: p, amp: 0.45 }); n[1] = s; n[0] = p; d.changed = true; }
  }
  ed.dirty = true;
});
roll.addEventListener('pointerup', () => {
  const d = ed.drag; ed.drag = null; if (!d) return;
  if (d.changed) { const n = ed.notes[d.i]; if (!isDrum()) ed.lastDur = n[2]; commitNotes(d.prev); log(d.created ? 'addNote' : 'editNote', { block: ed.block.name, track: ed.block.tracks[ed.ti].name, note: n.slice(0, 3) }); }
  ed.dirty = true;
});
roll.addEventListener('dblclick', e => { if (!ed.block) return; const i = noteAt(rollAt(e)); if (i >= 0) removeNote(i); });
roll.addEventListener('wheel', e => {
  e.preventDefault(); if (!ed.block) return;
  const r = roll.getBoundingClientRect();
  ed.sx = Math.max(0, Math.min(Math.max(0, total(ed.block) * ed.stepW - (r.width - KEYW) + 40), ed.sx + (e.shiftKey ? e.deltaY : e.deltaX)));
  if (!e.shiftKey) ed.sy = Math.max(0, Math.min(Math.max(0, rows() * ed.rowH - (r.height - HEAD)), ed.sy + e.deltaY));
  ed.dirty = true;
}, { passive: false });
function removeNote(i) {
  const t = ed.block.tracks[ed.ti], prev = t.notes.slice(), n = ed.notes[i];
  ed.notes.splice(i, 1); ed.sel = -1; commitNotes(prev);
  log('deleteNote', { block: ed.block.name, track: t.name, note: n.slice(0, 3) });
}

// ---------- 状态栏、提示 ----------
function updateStatus() {
  const b = byId.get(play.blockId);
  $('#stPlay').innerHTML = play.playing && b ? `${T('nowPlaying')} <b></b>` : `<span class="dim">${T('idle')}</span>`;
  if (play.playing && b) $('#stPlay b').textContent = `${N(b.name)}${b.role === 'bridge' ? ' → ' + N(b.target) : ''} · ♩${Math.round(play.bpm)}`;
  const l = linkById.get(ui.selLink), sl = $('#stLink'); sl.innerHTML = '';
  if (l) { const s = document.createElement('span'); s.textContent = `${T('selLink')}：${describe(l)}`; const bt = document.createElement('button'); bt.textContent = `⌫ ${T('deleteLink')}`; bt.onclick = () => deleteLink(l.id); sl.append(s, bt); }
  $('#stHint').textContent = ui.chain.length ? T('hintChain', { n: ui.chain.length }) : ui.channel ? T('hintChannel') : ui.sel != null ? T('hintSelected') : '';
}
let toastTimer = 0;
function toast(s) { const el = $('#toast'); el.textContent = s; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => el.hidden = true, 1600); }
function applyLang() {
  document.documentElement.lang = lang();
  for (const el of document.querySelectorAll('[data-t]')) el.textContent = T(el.dataset.t);
  $('#btnStop').title = T('stop') + ' (Space)';
  const box = $('#langs'); box.innerHTML = '';
  for (const l of LANGS) { const bt = document.createElement('button'); bt.textContent = { zh: '中', ja: '日', en: 'EN' }[l]; bt.className = l === lang() ? 'on' : ''; bt.onclick = () => { setLang(l); applyLang(); log('lang', { lang: l }); }; box.append(bt); }
  $('#helpList').innerHTML = ''; for (const s of T('helpItems')) { const li = document.createElement('li'); li.textContent = s; $('#helpList').append(li); }
  $('#btnSurvey').href = 'survey.html?lang=' + lang();
  if (ui.sel != null) chans = channelsOf(ui.sel);
  renderLegend(); updateStatus(); if (ed.block) renderEdBar(); dirty = true; ed.dirty = true;
}

// ---------- 接线 ----------
$('#btnStop').onclick = stopAll;
$('#preMinus').onclick = () => { ui.preRoll = Math.max(0, ui.preRoll - 1); $('#preVal').textContent = ui.preRoll; };
$('#prePlus').onclick = () => { ui.preRoll = Math.min(4, ui.preRoll + 1); $('#preVal').textContent = ui.preRoll; };
$('#loop').onchange = e => { ui.loop = e.target.checked; log('loop', { on: ui.loop }); };
$('#thick').oninput = e => { ui.thickness = +e.target.value; $('#thickVal').textContent = Math.round(ui.thickness * 100) + '%'; if (node) node.port.postMessage({ t: 'thickness', value: ui.thickness }); };
$('#thick').onchange = () => log('thickness', { value: ui.thickness });
$('#btnChain').onclick = playChain;
$('#btnChainClear').onclick = () => { ui.chain = []; chainChanged(); };
$('#btnUndo').onclick = undo;
$('#btnReset').onclick = resetAll;
$('#btnHelp').onclick = () => { $('#help').hidden = false; log('help'); };
$('#helpOk').onclick = () => { $('#help').hidden = true; try { localStorage.setItem('seam.helped', '1'); } catch {} ensureAudio(); };
$('#edClose').onclick = () => { closeEditor(); dirty = true; };
$('#edGhost').onchange = e => { ed.ghost = e.target.checked; ed.dirty = true; };
$('#edPlay').onclick = () => playBlock(ed.block);
$('#edFrom').onclick = () => { const l = bank.links.find(x => x.to === ed.block.id && x.exitBar >= 0) || bank.links.find(x => x.to === ed.block.id); if (l) audition(l); };
$('#edReset').onclick = () => {
  const o = JSON.parse(pristine).blocks.find(x => x.id === ed.block.id); if (!o) return;
  ed.block.tracks.forEach((t, i) => { if (o.tracks[i]) t.notes = o.tracks[i].notes; });
  commitBlock(ed.block); changed.delete(ed.block.id); save(); loadNotes(); log('resetBlock', { block: ed.block.name });
};
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' && e.target.type !== 'checkbox' && e.target.type !== 'range') return;
  if (e.code === 'Space') { e.preventDefault(); if (play.playing) stopAll(); else if (ui.lastPlay) start(ui.lastPlay, { kind: 'replay' }); else if (ui.sel != null) playBlock(byId.get(ui.sel)); }
  else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
  else if (e.key === 'Delete' || e.key === 'Backspace') { if (ed.block && ed.sel >= 0) removeNote(ed.sel); else if (ui.selLink != null) deleteLink(ui.selLink); }
  else if (e.key === 'Escape') { if (!$('#help').hidden) $('#help').hidden = true; else if (ed.block) { closeEditor(); dirty = true; } else if (ui.chain.length) { ui.chain = []; chainChanged(); } else select(null); }
});
// 图例面板可以拖走
{
  const el = $('#legend'), hd = el.querySelector('h4'); let d = null;
  hd.addEventListener('pointerdown', e => { const r = el.getBoundingClientRect(), s = $('#stage').getBoundingClientRect(); d = { dx: e.clientX - r.left, dy: e.clientY - r.top, s }; hd.setPointerCapture(e.pointerId); });
  hd.addEventListener('pointermove', e => { if (!d) return; el.style.right = 'auto'; el.style.left = Math.max(0, Math.min(d.s.width - 80, e.clientX - d.s.left - d.dx)) + 'px'; el.style.top = Math.max(0, Math.min(d.s.height - 40, e.clientY - d.s.top - d.dy)) + 'px'; });
  hd.addEventListener('pointerup', () => d = null);
}
addEventListener('resize', resize);
function frame() {
  if (dirty || play.playing) { draw(); dirty = false; }
  if (ed.block && (ed.dirty || play.playing)) { drawRoll(); ed.dirty = false; }
  requestAnimationFrame(frame);
}
(async () => {
  const txt = await (await fetch('bank.json?v=7cf97dd6')).text();
  pristine = txt; bank = JSON.parse(txt);
  restore(); index(); layout(); applyLang(); resize();
  view.k = Math.max(0.55, Math.min(1, (W - 40) / (16 * BW + 2 * X0))); view.x = 20; view.y = 6;
  try { if (!localStorage.getItem('seam.helped')) $('#help').hidden = false; } catch {}
  log('open', { w: innerWidth, h: innerHeight, lang: lang(), ua: navigator.userAgent });
  window.__seam = { bank: () => bank, ui, play, view, select, audition, addLink, deleteLink, openEditor, log: () => logBuf, pos: () => pos, playChain, toggleChain, chainTo };
  requestAnimationFrame(frame);
})();
