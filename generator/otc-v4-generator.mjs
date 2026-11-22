/*!
 * binexc OTC price generator "secure-v4" — public, dependency-free, deterministic.
 *
 * This exact file runs on the binexc servers, in the browser on
 * binexc.com/fairness and in Node.js (github.com/binexc-official/otc-fairness).
 *
 * Inputs of one UTC day's price path, and nothing else:
 *   - dayKey      : 32-byte daily key (hex). SHA-256(dayKey) is published as the
 *                   day's commitment before the day starts; the key itself is
 *                   published after the day ends.
 *   - time        : the timestamp being priced
 *   - market      : fixed properties (symbol id, volatility, price precision)
 *   - startPrice  : the market's price at 00:00:00 UTC (= previous day's close)
 *   - endLog      : the locked daily real-price alignment applied only during
 *                   the last minute of the day (23:59–00:00 UTC; trades that run
 *                   through that minute are refunded)
 * No user, trade, amount, order or balance information exists in this file.
 *
 * Only + - * /, Math.sqrt, Math.floor, Math.round, Math.min, Math.max and
 * 32-bit integer operations are used. ECMAScript defines these exactly, so
 * every engine (V8, JavaScriptCore, SpiderMonkey) returns identical numbers.
 * exp/log/cos are implemented below instead of Math.exp/log/cos, whose last
 * bit may differ between engines.
 */

export const GENERATOR_VERSION = 'secure-v4';
export const DAY_MS = 86400000;
export const TICK_MS = 250;
export const DAY_TICKS = 345600;
export const HOUR_TICKS = 14400;
export const PHASES = 24;
export const PHASE_TICKS = 600;
export const HORIZON = 524288; // 2^19 ticks > one day
export const ALIGN_WINDOW_MS = 60000;
export const DAY_KEY_LABEL = 'binexc-otc-v4:';

/* ------------------------------------------------------------------ SHA-256 */

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
].map((x) => x | 0);
const IV = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19].map((x) => x | 0);
const W = new Int32Array(64);

function blocks(h, bytes) {
  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4;
      W[i] = (bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3];
    }
    for (let i = 16; i < 64; i++) {
      const x = W[i - 15], y = W[i - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
    }
    let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], k = h[7];
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (k + S1 + ch + K[i] + W[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      k = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + k) | 0;
  }
}

/** Message plus SHA-256 padding; `prefix` bytes were already hashed before it. */
function padded(msg, prefix) {
  const total = prefix + msg.length;
  const len = Math.ceil((msg.length + 9) / 64) * 64;
  const out = new Uint8Array(len);
  out.set(msg);
  out[msg.length] = 0x80;
  const bits = total * 8;
  const hi = Math.floor(bits / 4294967296), lo = bits - hi * 4294967296;
  out[len - 8] = hi >>> 24; out[len - 7] = (hi >>> 16) & 255; out[len - 6] = (hi >>> 8) & 255; out[len - 5] = hi & 255;
  out[len - 4] = lo >>> 24; out[len - 3] = (lo >>> 16) & 255; out[len - 2] = (lo >>> 8) & 255; out[len - 1] = lo & 255;
  return out;
}

function wordsToBytes(h) {
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    out[i * 4] = h[i] >>> 24; out[i * 4 + 1] = (h[i] >>> 16) & 255; out[i * 4 + 2] = (h[i] >>> 8) & 255; out[i * 4 + 3] = h[i] & 255;
  }
  return out;
}

/** SHA-256 of bytes. */
export function sha256(bytes) {
  const h = IV.slice();
  blocks(h, padded(bytes, 0));
  return wordsToBytes(h);
}

/** HMAC-SHA256 with a fixed key; returns a function of the message bytes. */
export function createHmac(key) {
  const k = key.length > 64 ? sha256(key) : key;
  const ipad = new Uint8Array(64), opad = new Uint8Array(64);
  for (let i = 0; i < 64; i++) { const b = i < k.length ? k[i] : 0; ipad[i] = b ^ 0x36; opad[i] = b ^ 0x5c; }
  const inner = IV.slice(); blocks(inner, ipad);
  const outer = IV.slice(); blocks(outer, opad);
  /** Returns the 8 big-endian 32-bit words of the MAC. */
  const words = (msg) => {
    const s = inner.slice(); blocks(s, padded(msg, 64));
    const o = outer.slice(); blocks(o, padded(wordsToBytes(s), 64));
    return o;
  };
  return { words, bytes: (msg) => wordsToBytes(words(msg)) };
}

export function hmacSha256(key, msg) { return createHmac(key).bytes(msg); }

const encoder = new TextEncoder();
export function utf8(text) { return encoder.encode(text); }

export function bytesToHex(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
  return s;
}

export function hexToBytes(hex) {
  if (typeof hex !== 'string' || hex.length % 2 !== 0 || !/^[0-9a-f]*$/.test(hex)) throw new TypeError('Invalid hex string.');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/* ----------------------------------------------------- deterministic math */

const LN2_HI = 6.93147180369123816490e-01;
const LN2_LO = 1.90821492927058770002e-10;
const LN2 = 0.6931471805599453;
const SQRT2 = 1.4142135623730951;
const HALF_PI = 1.5707963267948966;
const POW2 = [1];
for (let i = 1; i <= 30; i++) POW2.push(POW2[i - 1] * 2);
const ODD_INV = [];
for (let i = 0; i < 16; i++) ODD_INV.push(1 / (2 * i + 3));

function scale2(x, k) {
  while (k > 30) { x *= POW2[30]; k -= 30; }
  while (k < -30) { x /= POW2[30]; k += 30; }
  return k >= 0 ? x * POW2[k] : x / POW2[-k];
}

/** Natural logarithm for x > 0. */
export function dLog(x) {
  if (!(x > 0) || x === Infinity) throw new RangeError('dLog domain');
  let e = 0;
  while (x >= 2) { x /= 2; e += 1; }
  while (x < 1) { x *= 2; e -= 1; }
  if (x > SQRT2) { x /= 2; e += 1; }
  const s = (x - 1) / (x + 1), s2 = s * s;
  let p = 0;
  for (let i = ODD_INV.length - 1; i >= 0; i--) p = s2 * (ODD_INV[i] + p);
  return e * LN2_HI + (e * LN2_LO + 2 * (s + s * p));
}

/** e^x for |x| < 700. */
export function dExp(x) {
  if (!(x > -700 && x < 700)) throw new RangeError('dExp domain');
  const k = Math.round(x / LN2);
  const r = (x - k * LN2_HI) - k * LN2_LO;
  let p = 1;
  for (let i = 22; i >= 1; i--) p = 1 + (r * p) / i;
  return scale2(p, k);
}

function sinSeries(t) {
  const t2 = t * t;
  let p = 1;
  for (let i = 21; i >= 3; i -= 2) p = 1 - (t2 * p) / (i * (i - 1));
  return t * p;
}
function cosSeries(t) {
  const t2 = t * t;
  let p = 1;
  for (let i = 22; i >= 2; i -= 2) p = 1 - (t2 * p) / (i * (i - 1));
  return p;
}

/** cos(2πv) for 0 <= v < 1. */
export function cos2pi(v) {
  if (!(v >= 0 && v < 1)) throw new RangeError('cos2pi domain');
  const q = v * 4;
  const n = Math.round(q);
  const t = (q - n) * HALF_PI;
  switch (n & 3) {
    case 0: return cosSeries(t);
    case 1: return -sinSeries(t);
    case 2: return -cosSeries(t);
    default: return sinSeries(t);
  }
}

/* ------------------------------------------------------------- day keys */

/** "YYYY-MM-DD" → UTC midnight in ms. */
export function dateToMs(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new TypeError('Invalid date.');
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (msToDate(ms) !== date) throw new TypeError('Invalid date.');
  return ms;
}

/** UTC date "YYYY-MM-DD" of a timestamp. */
export function msToDate(ms) {
  return new Date(Math.floor(ms / DAY_MS) * DAY_MS).toISOString().slice(0, 10);
}

/** dayKey = HMAC-SHA256(master, "binexc-otc-v4:" + date). Server-side only (needs the private master). */
export function dayKeyFromMaster(master, date) {
  dateToMs(date);
  return bytesToHex(hmacSha256(utf8(master), utf8(DAY_KEY_LABEL + date)));
}

/** commitment = SHA-256(dayKey bytes), hex. */
export function commitmentOf(dayKeyHex) {
  const key = hexToBytes(dayKeyHex);
  if (key.length !== 32) throw new TypeError('Day key must be 32 bytes.');
  return bytesToHex(sha256(key));
}

/* --------------------------------------------------------------- the tape */

/** Smooth 0→1 progress through the last minute before `windowEnd`. */
export function alignmentRamp(ts, windowEnd) {
  const x = Math.min(1, Math.max(0, (ts - (windowEnd - ALIGN_WINDOW_MS)) / ALIGN_WINDOW_MS));
  return x * x * (3 - 2 * x);
}

const u32 = (w) => ((w >>> 0) + 0.5) / 4294967296;

/**
 * One market's price path for one UTC day.
 * opts: { dayKey, date, symbol, volatility, startPrice, endLog? }
 * Returns { price(ts), endUnaligned(), nextStart() }.
 */
export function createDayTape(opts) {
  const { dayKey, date, symbol, volatility, startPrice, endLog } = opts;
  const keyBytes = hexToBytes(dayKey);
  if (keyBytes.length !== 32) throw new TypeError('Day key must be 32 bytes.');
  if (typeof symbol !== 'string' || !/^[A-Z0-9_.-]{1,24}$/.test(symbol)) throw new TypeError('Invalid symbol.');
  if (!(volatility >= 0 && volatility < 10)) throw new TypeError('Invalid volatility.');
  if (!(startPrice > 0 && startPrice < 1e12)) throw new TypeError('Invalid start price.');
  if (endLog !== undefined && endLog !== null && !(Math.abs(endLog) < 1)) throw new TypeError('Invalid end alignment.');
  const dayStart = dateToMs(date);
  const dayEnd = dayStart + DAY_MS;
  const mac = createHmac(keyBytes);
  const sigma = volatility * 0.00015;

  const normals = new Map();
  const normal = (label, cacheKey) => {
    const hit = normals.get(cacheKey);
    if (hit !== undefined) return hit;
    const w = mac.words(utf8(label));
    const z = Math.sqrt(-2 * dLog(u32(w[0]))) * cos2pi(u32(w[1]));
    if (normals.size >= 60000) normals.clear();
    normals.set(cacheKey, z);
    return z;
  };
  const endpoint = () => normal(`v4:w:${symbol}:end`, -1);
  /** Brownian value (in √seconds) at an integer tick 0..HORIZON. */
  const path = (ticks) => {
    let left = 0, right = HORIZON, a = 0, b = Math.sqrt(HORIZON * 0.25) * endpoint();
    while (right - left > 1) {
      const mid = (left + right) / 2;
      const m = (a + b) / 2 + Math.sqrt(((right - left) * 0.25) / 4) * normal(`v4:w:${symbol}:${left}:${right}`, mid);
      if (ticks === mid) return m;
      if (ticks < mid) { right = mid; b = m; } else { left = mid; a = m; }
    }
    return ticks === left ? a : b;
  };
  const hours = new Map();
  const hourWeights = (hour) => {
    const hit = hours.get(hour);
    if (hit) return hit;
    const w = [];
    for (let i = 0; i < PHASES; i++) {
      const h = mac.words(utf8(`v4:p:${symbol}:${hour}:${i}`));
      const z = Math.sqrt(-2 * dLog(u32(h[0]))) * cos2pi(u32(h[1]));
      const pick = (h[2] >>> 0) / 4294967296;
      // calm 25%, normal 45%, active 22%, burst 8% (variance multipliers)
      const level = pick < 0.25 ? 0.3 : pick < 0.7 ? 1 : pick < 0.92 ? 2.1 : 4.2;
      w.push(level * dExp(0.35 * z));
    }
    let total = 0;
    for (let i = 0; i < PHASES; i++) total += w[i];
    const cum = [0];
    for (let i = 0; i < PHASES; i++) cum.push(cum[i] + (w[i] / total) * PHASES);
    hours.set(hour, cum);
    return cum;
  };
  /** Hidden-phase business clock: equals real time on every hour boundary. */
  const businessTicks = (ticks) => {
    const hour = Math.floor(ticks / HOUR_TICKS);
    const inHour = ticks - hour * HOUR_TICKS;
    if (inHour === 0) return ticks;
    const phase = Math.min(PHASES - 1, Math.floor(inHour / PHASE_TICKS));
    const frac = (inHour - phase * PHASE_TICKS) / PHASE_TICKS;
    const cum = hourWeights(hour);
    return hour * HOUR_TICKS + (cum[phase] + (cum[phase + 1] - cum[phase]) * frac) * PHASE_TICKS;
  };
  const walk = (ticks) => {
    const t = businessTicks(ticks);
    const lo = Math.floor(t), f = t - lo;
    const a = path(lo);
    return f === 0 ? a : a + (path(Math.min(HORIZON, lo + 1)) - a) * f;
  };
  const unaligned = (ticks) => startPrice * dExp(sigma * walk(ticks) - 0.5 * sigma * sigma * (ticks * 0.25));

  return {
    dayStart,
    dayEnd,
    /** Unrounded price at ts (dayStart <= ts < dayEnd). */
    price(ts) {
      if (!(ts >= dayStart && ts < dayEnd)) throw new RangeError('Timestamp outside this day.');
      const p = unaligned(Math.floor((ts - dayStart) / TICK_MS));
      if (ts < dayEnd - ALIGN_WINDOW_MS) return p;
      if (endLog === undefined || endLog === null) throw new Error('End-of-day alignment not available yet.');
      return p * dExp(endLog * alignmentRamp(ts, dayEnd));
    },
    /** Path value at 24:00 before the end-of-day alignment. */
    endUnaligned() { return unaligned(DAY_TICKS); },
    /** Next day's start price = endUnaligned × e^endLog. */
    nextStart() {
      if (endLog === undefined || endLog === null) throw new Error('End-of-day alignment not available yet.');
      return unaligned(DAY_TICKS) * dExp(endLog);
    },
  };
}

/* ------------------------------------------------------------- candles */

export function roundPrice(price, precision) {
  return Number(price.toFixed(precision));
}

function hashString(input) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return hash >>> 0;
}

/** The chart's candle sampling (identical to the app's buildCandleWithPrice). */
export function buildCandle(symbolId, precision, bucketStart, bucketMs, nowMs, price) {
  const endCap = Math.min(bucketStart + bucketMs, Math.max(nowMs, bucketStart));
  const isComplete = endCap >= bucketStart + bucketMs;
  const closeAt = isComplete ? Math.max(bucketStart, endCap - Math.min(bucketMs * 0.03, 140)) : endCap;
  const open = price(bucketStart);
  const close = price(closeAt);
  const sampleStepMs = Math.max(250, bucketMs / 96);
  const samples = Math.floor(Math.max(0, closeAt - bucketStart) / sampleStepMs);
  let high = Math.max(open, close);
  let low = Math.min(open, close);
  for (let i = 1; i <= samples; i += 1) {
    const p = price(bucketStart + i * sampleStepMs);
    if (p > high) high = p;
    if (p < low) low = p;
  }
  const v = (hashString(`${symbolId}:${bucketStart}`) % 400) + 80;
  return {
    time: bucketStart,
    open: roundPrice(open, precision),
    high: roundPrice(high, precision),
    low: roundPrice(low, precision),
    close: roundPrice(close, precision),
    volume: v,
  };
}
