// 切换工作站的网页运行时：和 Unity 运行时（SeamRuntimeCore.cs）、Mac 工具（Synth.swift / Player.swift）同一套算法和参数。
// 不碰 DOM，可以在 AudioWorklet 里跑，也可以在 Node 里离线渲染（tools/compare.mjs 用它和工具的输出逐采样比较）。

const Kick = 0, Snare = 1, Hat = 2, Bass = 3, Pulse = 4, Arp = 5, Bell = 6, Pad = 7, Gtr = 8, Noise = 9, Boom = 10, Thunk = 11;
const TAU = Math.PI * 2;

class SeamSynth {
  constructor(sampleRate) {
    this.sampleRate = sampleRate > 0 ? sampleRate : 48000;
    this.volume = 1;
    this.voices = [];
    for (let i = 0; i < 64; i++) this.voices.push({ on: false, type: 0, amp: 0, send: 0, ghost: false, stage: 0, env: 0, ph: 0, ph2: 0, aux: 0, auxDec: 0, lp: 0, k: 0, dec: 0, gl: 0, gr: 0, hold: 0, atkInc: 0, inc: 0, inc2: 0 });
    this.seed = 0x1234567;
    this.size = 0;
    this.dlyL = new Float32Array(this.sampleRate * 2); this.dlyR = new Float32Array(this.sampleRate * 2);
    this.dlyPos = 0; this.mlpL = 0; this.mlpR = 0; this.glpL = 0; this.glpR = 0;
  }
  begin(frames) {
    if (this.size < frames) {
      this.size = frames;
      this.bufL = new Float32Array(frames); this.bufR = new Float32Array(frames);
      this.sndL = new Float32Array(frames); this.sndR = new Float32Array(frames);
      this.ghL = new Float32Array(frames); this.ghR = new Float32Array(frames);
    } else {
      this.bufL.fill(0, 0, frames); this.bufR.fill(0, 0, frames); this.sndL.fill(0, 0, frames); this.sndR.fill(0, 0, frames);
      this.ghL.fill(0, 0, frames); this.ghR.fill(0, 0, frames);
    }
  }
  decay(seconds) { return Math.fround(Math.exp(-1 / (seconds * this.sampleRate))); }   // 和 C# 的 float 一样取单精度：音熄灭的那个采样要一致，噪声序列才对得上
  rnd() {
    let s = this.seed;
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    this.seed = s;
    return (s & 0xFFFFFF) / 8388608 - 1;
  }
  trig(type, midi, amp, pan, holdSeconds, send, ghost = false) {
    if (amp <= 0.001) return;
    const vs = this.voices;
    let slot = -1, weakest = 9;
    for (let i = 0; i < vs.length; i++) {
      if (!vs[i].on) { slot = i; break; }
      if (vs[i].stage === 1 && vs[i].env < weakest) { weakest = vs[i].env; slot = i; }
    }
    if (slot < 0) slot = 0;
    const sr = this.sampleRate;
    const v = vs[slot];      // 复用原来的对象：音频线程里不做内存分配，免得垃圾回收打断声音
    v.on = true; v.type = type; v.amp = amp; v.send = ghost ? send * 0.5 : send; v.ghost = ghost;
    v.stage = 0; v.env = 0; v.ph = 0; v.ph2 = 0; v.aux = 0; v.auxDec = 0; v.lp = 0; v.k = 0; v.dec = 0;
    v.gl = Math.cos((pan + 1) * Math.PI * 0.25);
    v.gr = Math.sin((pan + 1) * Math.PI * 0.25);
    v.hold = Math.trunc(holdSeconds * sr);
    v.atkInc = Math.fround(1 / (0.002 * sr));
    v.inc = 440 * Math.pow(2, (midi - 69) / 12) / sr; v.inc2 = v.inc;
    switch (type) {
      case Kick: v.inc = 46 / sr; v.aux = 1; v.auxDec = this.decay(0.028); v.dec = this.decay(0.11); v.atkInc = 1; break;
      case Boom: v.inc = 34 / sr; v.aux = 1; v.auxDec = this.decay(0.12); v.dec = this.decay(0.45); v.atkInc = 1; break;
      case Snare: v.inc = 186 / sr; v.aux = 1; v.auxDec = this.decay(0.03); v.dec = this.decay(0.07); v.atkInc = 1; break;
      case Hat: v.k = 0.35; v.dec = this.decay(midi > 0 ? 0.11 : 0.022); v.atkInc = 1; break;
      case Noise: v.k = 0.2; v.dec = this.decay(0.55); break;
      case Bass: v.k = 0.05; v.dec = this.decay(0.09); break;
      case Pulse: v.k = 0.3; v.dec = this.decay(0.06); break;
      case Arp: v.dec = this.decay(0.10); break;
      case Bell: v.aux = 1; v.auxDec = this.decay(0.09); v.dec = this.decay(0.55); break;
      case Pad: v.inc2 = v.inc * 1.006; v.k = 0.07; v.atkInc = Math.fround(1 / (0.12 * sr)); v.dec = this.decay(0.25); break;
      case Gtr: v.inc2 = v.inc * 0.5; v.aux = 3.5; v.k = 0.22; v.dec = this.decay(0.22); break;
      default: v.inc = 120 / sr; v.k = 0.1; v.dec = this.decay(0.05); v.atkInc = 1; break;
    }
  }
  allNotesOff() {
    const d = this.decay(0.03);
    for (const v of this.voices) if (v.on) { v.hold = 0; v.stage = 1; if (v.dec > d) v.dec = d; }
  }
  renderVoices(start, n) {
    const end = start + n, bufL = this.bufL, bufR = this.bufR, sndL = this.sndL, sndR = this.sndR, ghL = this.ghL, ghR = this.ghR;
    for (const v of this.voices) {
      if (!v.on) continue;
      for (let i = start; i < end; i++) {
        if (v.stage === 0) { v.env = Math.fround(v.env + v.atkInc); if (v.env >= 1) { v.env = 1; v.stage = 1; } }
        else if (v.hold > 0) v.hold--;
        else { v.env = Math.fround(v.env * v.dec); if (v.env < Math.fround(0.0006)) { v.on = false; break; } }
        let s;
        switch (v.type) {
          case Kick: case Boom:
            v.ph += v.inc * (1 + 3.2 * v.aux); v.aux *= v.auxDec;
            s = Math.sin(TAU * v.ph);
            if (v.type === Boom) { v.lp += (this.rnd() - v.lp) * 0.05; s += v.lp * 1.5 * v.aux; }
            break;
          case Snare:
            v.ph += v.inc; v.aux *= v.auxDec;
            s = this.rnd() * 0.75 + Math.sin(TAU * v.ph) * v.aux;
            break;
          case Hat: case Noise: { const nz = this.rnd(); v.lp += (nz - v.lp) * v.k; s = nz - v.lp; break; }
          case Bass: {
            v.ph += v.inc; v.ph2 += v.inc * 0.5;
            const saw = 2 * (v.ph - Math.floor(v.ph)) - 1;
            const sub = (v.ph2 - Math.floor(v.ph2)) < 0.5 ? 0.7 : -0.7;
            v.lp += (saw * 0.6 + sub - v.lp) * (v.k + 0.12 * v.env);
            s = v.lp; break;
          }
          case Pulse: {
            v.ph += v.inc;
            const sq = (v.ph - Math.floor(v.ph)) < 0.25 ? 1 : -1;
            v.lp += (sq - v.lp) * v.k; s = v.lp; break;
          }
          case Arp: {
            v.ph += v.inc;
            const fr = v.ph - Math.floor(v.ph);
            s = 4 * Math.abs(fr - 0.5) - 1 + (fr < 0.5 ? 0.18 : -0.18); break;
          }
          case Bell:
            v.ph += v.inc; v.aux *= v.auxDec;
            s = Math.sin(TAU * v.ph) + v.aux * (0.45 * Math.sin(TAU * v.ph * 3.01) + 0.2 * Math.sin(TAU * v.ph * 5.43));
            break;
          case Pad: {
            v.ph += v.inc; v.ph2 += v.inc2;
            const a = 2 * (v.ph - Math.floor(v.ph)) - 1, b = 2 * (v.ph2 - Math.floor(v.ph2)) - 1;
            v.lp += ((a + b) * 0.5 - v.lp) * v.k; s = v.lp; break;
          }
          case Gtr: {
            v.ph += v.inc; v.ph2 += v.inc2;
            const a = 2 * (v.ph - Math.floor(v.ph)) - 1, b = (v.ph2 - Math.floor(v.ph2)) < 0.5 ? 0.5 : -0.5;
            let x = (a + b) * v.aux; x = x / (1 + Math.abs(x));
            v.lp += (x - v.lp) * v.k; s = v.lp; break;
          }
          default:
            v.ph += v.inc;
            v.lp += (this.rnd() - v.lp) * v.k;
            s = v.lp * 2.2 + Math.sin(TAU * v.ph) * 0.6;
        }
        s *= v.env * v.amp;
        const l = s * v.gl, r = s * v.gr;
        if (v.ghost) { ghL[i] += l; ghR[i] += r; } else { bufL[i] += l; bufR[i] += r; }
        if (v.send > 0) { sndL[i] += l * v.send; sndR[i] += r * v.send; }
      }
    }
  }
  /** 母线：附点八分延迟、闷音低通、软削波。outL / outR 各 frames 个采样。 */
  finish(frames, delaySamples, muffle, outL, outR) {
    const dlyLen = this.dlyL.length, d = Math.max(1, Math.min(dlyLen - 1, delaySamples));
    const m = muffle < 0 ? 0 : (muffle > 1 ? 1 : muffle);
    let k = 1 - 0.965 * m; k *= k;
    const gk = 1 - Math.exp(-2 * Math.PI * 900 / this.sampleRate);
    const bufL = this.bufL, bufR = this.bufR;
    for (let f = 0; f < frames; f++) { this.glpL += (this.ghL[f] - this.glpL) * gk; this.glpR += (this.ghR[f] - this.glpR) * gk; bufL[f] += this.glpL; bufR[f] += this.glpR; }
    for (let f = 0; f < frames; f++) {
      let rp = this.dlyPos - d; if (rp < 0) rp += dlyLen;
      const dl = this.dlyL[rp], dr = this.dlyR[rp];
      this.dlyL[this.dlyPos] = this.sndL[f] + dr * 0.36;
      this.dlyR[this.dlyPos] = this.sndR[f] + dl * 0.36;
      if (++this.dlyPos >= dlyLen) this.dlyPos = 0;
      this.mlpL += (bufL[f] + dl * 0.32 - this.mlpL) * k; this.mlpR += (bufR[f] + dr * 0.32 - this.mlpR) * k;
      let l = this.mlpL * 0.9, r = this.mlpR * 0.9;
      l = l / (1 + Math.abs(l) * 0.6) * this.volume; r = r / (1 + Math.abs(r) * 0.6) * this.volume;
      outL[f] = l; if (outR) outR[f] = r;
    }
  }
}

function voiceFor(instrument, pitch) {
  switch (instrument) {
    case 'bell': return { type: Bell, midi: pitch, sustains: false };
    case 'bass': return { type: Bass, midi: pitch, sustains: true };
    case 'pulse': return { type: Pulse, midi: pitch, sustains: true };
    case 'arp': return { type: Arp, midi: pitch, sustains: true };
    case 'pad': return { type: Pad, midi: pitch, sustains: true };
    case 'guitar': return { type: Gtr, midi: pitch, sustains: true };
    case 'drums':
      switch (pitch) {
        case 36: return { type: Kick, midi: 0, sustains: false };
        case 38: return { type: Snare, midi: 0, sustains: false };
        case 42: return { type: Hat, midi: 0, sustains: false };
        case 46: return { type: Hat, midi: 1, sustains: false };
        case 49: return { type: Noise, midi: 0, sustains: true };
        case 41: return { type: Boom, midi: 0, sustains: false };
        case 37: return { type: Thunk, midi: 0, sustains: false };
      }
  }
  return null;
}

const barSteps = b => b.beatsPerBar * 4;
const totalSteps = b => b.bars * b.beatsPerBar * 4;
function bpmAt(b, pos) {
  const b0 = b.tempo && b.tempo.length ? b.tempo[0].bpm : 120;
  if (b.rampTo > 0) { let f = pos / Math.max(1, totalSteps(b)); f = f < 0 ? 0 : (f > 1 ? 1 : f); return b0 + (b.rampTo - b0) * f; }
  let v = b0;
  if (b.tempo) for (const t of b.tempo) if (t.step <= pos + 1e-6) v = t.bpm;
  return v;
}
function harmAt(b, step) {
  let best = null;
  if (b.harm) for (const h of b.harm) if (h.at <= step && (best === null || h.at >= best.at)) best = h;
  return best;
}
const layer = (r, lo) => { const g = (r - lo) / 0.07; return g < 0 ? 0 : (g > 1 ? 1 : g); };

/**
 * 读音乐包、按小节线执行切换。时间用一条全局步数时钟（一拍 4 步），小节线永远落在整数步上。
 * 和 C# 版相比，这里多了两样试听用的东西：
 *   queueLinks([...id])：按顺序走指定的连线（点连线试听、连播）；
 *   stopAfter(blockId, bars)：进入某个方块、放满几小节后自己停。
 * 没搬过来的：音频层（渲染轨）、玩法音效、受击闷音。
 */
class SeamEngine {
  constructor(bank, sampleRate) {
    this.synth = new SeamSynth(sampleRate);
    this.tempoSmoothing = false;
    this.global = -1e-6; this.origin = 0; this.playing = false; this.cur = null;
    this.lastBpm = 132; this.curBpm = 132; this.rampFrom = 132;
    this.pendingEv = null; this.pendingTo = null; this.pendingNotBefore = -1;
    this.queue = []; this.stopBlock = -1; this.stopSteps = 0; this.loopBlock = false;
    this.jumpBlock = -1; this.jumpBar = 0;
    this.resonance = 1; this.smoothRes = 1; this.floorRes = 0;
    this.trail = [];          // 走过的方块：{ id, at(全局步), entryBar }
    this.onEnter = null;
    this.setBank(bank);
  }
  setBank(bank) {
    this.bank = bank; this.blocks = new Map(); this.linksFrom = new Map(); this.linkById = new Map();
    for (const b of bank.blocks) this.blocks.set(b.id, this.build(b));
    this.setLinks(bank.links);
  }
  setLinks(links) {
    this.bank.links = links; this.linksFrom = new Map(); this.linkById = new Map();
    for (const l of links) {
      if (!this.linksFrom.has(l.from)) this.linksFrom.set(l.from, []);
      this.linksFrom.get(l.from).push(l); this.linkById.set(l.id, l);
    }
  }
  /** 改了一个方块的音符之后调用：只重建这一个。 */
  updateBlock(b) {
    const i = this.bank.blocks.findIndex(x => x.id === b.id);
    if (i >= 0) this.bank.blocks[i] = b; else this.bank.blocks.push(b);
    const blk = this.build(b);
    this.blocks.set(b.id, blk);
    if (this.cur && this.cur.b.id === b.id) this.cur = blk;
  }
  build(b) {
    const blk = { b, battle: b.role === 'boss' && !!b.part && b.part.startsWith('p') };
    const total = totalSteps(b), list = [];
    (b.tracks || []).forEach((t, ti) => {
      if (t.stem) return;
      const n = t.notes || [], stride = n.length % 9 === 0 ? 9 : 6;
      const isMel = t.role === 'mel', melGroup = isMel || t.role === 'dbl' || t.role === 'dblBell';
      for (let i = 0; i + stride - 1 < n.length; i += stride) {
        const step = Math.trunc(n[i + 1]);
        if (step < 0 || step >= total) continue;
        const vf = voiceFor(t.instrument, Math.trunc(n[i]));
        if (!vf) continue;
        const e = { step, type: vf.type, track: ti, midi: vf.midi, hold: vf.sustains ? n[i + 2] : 0, dur: n[i + 2], amp: n[i + 3] * t.volume, pan: n[i + 4], send: n[i + 5], lo: -1, hi: 0, mode: 0, isMel, melGroup };
        if (stride === 9) { e.lo = n[i + 6]; e.hi = n[i + 7]; e.mode = Math.trunc(n[i + 8] + 0.5); }
        list.push(e);
      }
    });
    const counts = new Int32Array(total + 2);
    for (const e of list) counts[e.step + 1]++;
    for (let i = 1; i < counts.length; i++) counts[i] += counts[i - 1];
    blk.offsets = counts.slice(); blk.events = new Array(list.length);
    const fill = counts.slice();
    for (const e of list) blk.events[fill[e.step]++] = e;
    return blk;
  }
  findBlock(name) { return this.bank.blocks.find(b => b.name === name) || null; }
  play(blockId, bar = 0) {
    if (!this.blocks.has(blockId)) return;
    this.jumpBlock = blockId; this.jumpBar = bar; this.pendingEv = null; this.pendingTo = null;
  }
  stop() { this.playing = false; this.pendingEv = null; this.jumpBlock = -1; this.queue = []; this.stopBlock = -1; this.synth.allNotesOff(); }
  postEvent(ev, toBlock = null, notBefore = -1) { this.pendingEv = ev; this.pendingTo = toBlock; this.pendingNotBefore = notBefore; }
  queueLinks(ids) { this.queue = ids.slice(); }
  stopAfter(blockId, bars) { const b = this.blocks.get(blockId); this.stopBlock = blockId; this.stopSteps = b ? bars * barSteps(b.b) : 0; }
  setThickness(v) { this.resonance = v < 0 ? 0 : (v > 1 ? 1 : v); }
  snapThickness(v) { this.resonance = v; this.smoothRes = v; }
  /** 钢琴卷帘里点一个音时试听一下。 */
  previewNote(instrument, pitch, amp = 0.5) { const v = voiceFor(instrument, pitch); if (v) this.synth.trig(v.type, v.midi, amp, 0, v.sustains ? 0.22 : 0, 0.2); }
  get state() {
    const s = { playing: this.playing, globalStep: this.global, origin: this.origin, bpm: this.lastBpm, blockId: -1, step: 0, beatsPerBar: 4 };
    if (this.cur) { s.blockId = this.cur.b.id; s.blockName = this.cur.b.name; s.step = Math.max(0, this.global - this.origin); s.beatsPerBar = this.cur.b.beatsPerBar; }
    return s;
  }
  fire(blk, step, bpm) {
    if (step < 0 || step + 1 >= blk.offsets.length) return;
    const stepSeconds = 60 / bpm / 4;
    const r = blk.battle ? this.smoothRes : Math.max(this.smoothRes, this.floorRes);
    for (let k = blk.offsets[step]; k < blk.offsets[step + 1]; k++) {
      const e = blk.events[k];
      let g = 1, ghost = false;
      if (e.lo >= 0) {
        const eff = blk.battle ? Math.max(r, this.floorRes) : r;
        const below = e.mode === 2 ? eff > e.hi : (e.mode === 3 ? !(eff > e.hi) : (e.hi <= 0 || r < e.hi));
        if (e.mode === 1) g = r >= e.lo && below ? 1 : 0;
        else {
          g = below ? layer(r, e.lo) : 0;
          if (blk.battle && below) { const held = layer(this.floorRes, e.lo) * 0.4; if (held > g) { g = held; ghost = true; } }
        }
      }
      const t = blk.b.tracks[e.track];
      g *= t.layer <= 0 ? 1 : layer(Math.max(this.smoothRes, this.floorRes), t.layer);
      if (g > 0) this.synth.trig(e.type, e.midi, e.amp * g, e.pan, e.hold * stepSeconds, e.send, ghost);
    }
  }
  pick(blk, doneBar, atEnd, gstep) {
    const list = this.linksFrom.get(blk.b.id);
    if (this.queue.length) {
      const l = this.linkById.get(this.queue[0]);
      if (!l) this.queue.shift();
      else if (l.from === blk.b.id && (l.exitBar === doneBar || (l.exitBar < 0 && atEnd))) { this.queue.shift(); return l; }
    }
    if (!list) return null;
    if (this.pendingEv !== null && gstep >= this.pendingNotBefore) {
      for (const l of list) {
        if (l.ev !== this.pendingEv) continue;
        if (!(l.exitBar === doneBar || (l.exitBar < 0 && atEnd))) continue;
        if (this.pendingTo !== null) { const to = this.blocks.get(l.to); if (!(to && to.b.name === this.pendingTo)) continue; }
        this.pendingEv = null; this.pendingTo = null;
        return l;
      }
    }
    if (!atEnd) return null;
    let first = null;
    for (const l of list) {
      if (l.exitBar >= 0) continue;
      if (l.ev === '循环') return l;
      if (first === null) first = l;
    }
    return first;
  }
  rampBpm(blk, pos) { let f = pos / Math.max(1, totalSteps(blk.b)); f = f < 0 ? 0 : (f > 1 ? 1 : f); return this.rampFrom + (blk.b.rampTo - this.rampFrom) * f; }
  enter(to, entryBar, gstep, via) {
    if (this.playing && this.cur && this.cur.b.rampTo > 0) this.curBpm = this.cur.b.rampTo;
    else if (!this.playing || !this.cur || !this.tempoSmoothing) this.curBpm = bpmAt(to.b, Math.max(0, entryBar) * barSteps(to.b));
    this.rampFrom = this.curBpm;
    this.cur = to;
    const entry = entryBar < 0 ? 0 : Math.min(entryBar, to.b.bars - 1);
    this.origin = gstep - entry * barSteps(to.b);
    this.playing = true;
    const rec = { id: to.b.id, at: gstep, entryBar: entry, via: via ? via.id : -1 };
    this.trail.push(rec); if (this.trail.length > 64) this.trail.shift();
    if (this.onEnter) this.onEnter(rec);
  }
  /** 渲染一块。outL / outR：Float32Array，长度相同。 */
  render(outL, outR) {
    const frames = outL.length, sr = this.synth.sampleRate, synth = this.synth;
    synth.begin(frames);
    if (this.playing && this.cur && !(this.cur.b.rampTo > 0))
      this.curBpm += (bpmAt(this.cur.b, this.global - this.origin) - this.curBpm) * (this.tempoSmoothing ? 0.04 : 1);
    let i = 0;
    while (i < frames) {
      const blk = this.playing ? this.cur : null;
      const pos = this.global - this.origin;
      let bpm = blk === null ? this.lastBpm : (blk.b.rampTo > 0 ? this.rampBpm(blk, pos) : this.curBpm);
      if (bpm < 30) bpm = 30;
      this.lastBpm = bpm;
      const stepInc = bpm / 60 * 4 / sr;
      const next = Math.floor(this.global) + 1;
      let n = Math.ceil((next - this.global) / stepInc);
      if (n < 1) n = 1;
      if (n > frames - i) n = frames - i;
      synth.renderVoices(i, n);
      const before = this.global;
      this.global += n * stepInc;
      i += n;
      if (Math.floor(this.global) > Math.floor(before)) {
        const S = Math.floor(this.global);
        this.smoothRes += (this.resonance - this.smoothRes) * 0.3;
        let stinger = 0;
        if (this.jumpBlock >= 0) { this.enter(this.blocks.get(this.jumpBlock), this.jumpBar, S, null); this.jumpBlock = -1; }
        else if (this.playing && this.cur) {
          const rel = S - this.origin, bs = barSteps(this.cur.b), total = totalSteps(this.cur.b);
          if (this.stopBlock === this.cur.b.id && this.queue.length === 0 && this.trail.length && S - this.trail[this.trail.length - 1].at >= this.stopSteps) { this.playing = false; this.stopBlock = -1; synth.allNotesOff(); }
          else if (rel > 0 && rel % bs === 0) {
            const atEnd = rel >= total;
            const l = this.pick(this.cur, rel / bs - 1, atEnd, S);
            if (l && this.blocks.has(l.to)) { this.enter(this.blocks.get(l.to), l.entryBar, S, l); stinger = l.stinger; }
            else if (atEnd) this.playing = false;
          }
        }
        const b2 = this.playing && this.cur ? (this.cur.b.rampTo > 0 ? this.rampBpm(this.cur, S - this.origin) : this.curBpm) : this.lastBpm;
        if (this.playing && this.cur) this.fire(this.cur, S - this.origin, b2);
        if (stinger === 1) { synth.trig(Noise, 0, 0.32, 0, 2 * 60 / b2 / 4, 0.3); synth.trig(Boom, 0, 0.8, 0, 0, 0); }
        else if (stinger === 2) synth.trig(Noise, 0, 0.3, 0, 2 * 60 / b2 / 4, 0.3);
      }
    }
    const muffle = this.playing && this.cur ? (this.cur.b.muffle || 0) : 0;
    synth.finish(frames, Math.trunc(3 * 60 / this.lastBpm / 4 * sr), muffle, outL, outR);
  }
}


// 音频线程：收界面发来的命令，渲染声音，每隔约 30 毫秒把播放位置发回去。
class SeamProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.eng = null; this.tick = 0; this.wasPlaying = false;
    this.port.onmessage = e => this.on(e.data);
  }
  on(m) {
    if (m.t === 'bank') {
      this.eng = new SeamEngine(m.bank, sampleRate);
      this.eng.onEnter = rec => this.port.postMessage({ t: 'enter', rec });
      this.eng.snapThickness(m.thickness ?? 1);
      this.port.postMessage({ t: 'ready' });
      return;
    }
    const e = this.eng; if (!e) return;
    switch (m.t) {
      case 'links': e.setLinks(m.links); break;
      case 'block': e.updateBlock(m.block); break;
      case 'play':            // { block, bar, links: [连线 id…], stop: { block, bars } | null }
        e.stop(); e.trail = [];
        e.play(m.block, m.bar || 0);
        e.queueLinks(m.links || []);
        if (m.stop) e.stopAfter(m.stop.block, m.stop.bars);
        break;
      case 'stop': e.stop(); break;
      case 'thickness': e.setThickness(m.value); break;
      case 'note': e.previewNote(m.instrument, m.pitch, m.amp); break;
    }
  }
  process(inputs, outputs) {
    const o = outputs[0];
    if (!this.eng) return true;
    this.eng.render(o[0], o.length > 1 ? o[1] : null);
    const playing = this.eng.playing || this.eng.jumpBlock >= 0;
    if (++this.tick % 12 === 0 || playing !== this.wasPlaying) {
      const s = this.eng.state;
      this.port.postMessage({ t: 'state', playing, blockId: playing ? s.blockId : -1, step: s.step, bpm: s.bpm, time: currentTime });
      this.wasPlaying = playing;
    }
    return true;
  }
}
registerProcessor('seam', SeamProcessor);
