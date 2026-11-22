#!/usr/bin/env node
/*
 * binexc OTC fairness — independent verification script (Node.js 18+).
 * Uses only the published generator in ../generator and the published files
 * in ../commitments and ../reveals (or downloads them from GitHub).
 *
 *   node verify/verify.mjs 2026-11-24
 *       checks the day's commitment, key and start-price chain
 *   node verify/verify.mjs 2026-11-24 EURUSD_OTC 1m 2026-11-24T10:15:00Z
 *       also recomputes that candle and compares it with binexc.com
 *   node verify/verify.mjs 2026-11-24 EURUSD_OTC price 2026-11-24T10:15:03.250Z
 *       recomputes the price at one instant (e.g. a trade's entry or expiry)
 */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  buildCandle, commitmentOf, createDayTape, dateToMs, msToDate, roundPrice, DAY_MS,
} from '../generator/otc-v4-generator.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = 'https://raw.githubusercontent.com/binexc-official/otc-fairness/main/';
const SITE = 'https://binexc.com';
const TIMEFRAMES = { '1m': 60, '2m': 120, '5m': 300, '10m': 600, '15m': 900, '30m': 1800, '1h': 3600, '2h': 7200, '4h': 14400 };

async function load(rel) {
  try { return JSON.parse(await readFile(path.join(ROOT, rel), 'utf8')); } catch {}
  const res = await fetch(RAW + rel);
  if (!res.ok) return null;
  return res.json();
}

const ok = (label, pass, detail = '') => { console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`); if (!pass) process.exitCode = 1; return pass; };

const [date, symbol, tf, at] = process.argv.slice(2);
if (!date) { console.log('Usage: node verify/verify.mjs YYYY-MM-DD [SYMBOL 1m|price ISO-TIME]'); process.exit(2); }
dateToMs(date);
const reveal = await load(`reveals/${date}.json`);
if (!reveal) { console.log(`No reveal for ${date} yet (keys are published after the day ends).`); process.exit(2); }
const commitment = await load(`commitments/days/${date}.json`);

ok('commitment was published before the day started', !!commitment && Date.parse(commitment.publishedAt) < dateToMs(date), commitment?.publishedAt ?? 'missing');
ok('SHA-256(dayKey) equals the published commitment', commitment && commitmentOf(reveal.dayKey) === commitment.commitment && reveal.commitment === commitment.commitment);
const generatorSource = await readFile(path.join(ROOT, 'generator/otc-v4-generator.mjs'));
ok('generator file matches the hash in the reveal', createHash('sha256').update(generatorSource).digest('hex') === reveal.generatorSha256);

const prevDate = msToDate(dateToMs(date) - DAY_MS);
const prev = await load(`reveals/${prevDate}.json`);
if (prev) {
  let chain = true;
  for (const [id, m] of Object.entries(reveal.markets)) {
    const p = prev.markets[id];
    if (!p) continue;
    const tape = createDayTape({ dayKey: prev.dayKey, date: prevDate, symbol: id, volatility: p.volatility, startPrice: p.startPrice, endLog: p.endLog });
    if (tape.nextStart() !== m.startPrice) { chain = false; console.log(`   ${id}: previous close ${tape.nextStart()} ≠ start ${m.startPrice}`); }
  }
  ok(`every start price equals the previous day's close (${prevDate})`, chain);
} else {
  console.log(`INFO  ${prevDate} has no secure-v4 reveal (first day): start prices continue the previous version.`);
}

{
  let aligned = true, checked = 0;
  for (const [id, m] of Object.entries(reveal.markets)) {
    if (!(m.referencePrice > 0)) continue;
    const tape = createDayTape({ dayKey: reveal.dayKey, date, symbol: id, volatility: m.volatility, startPrice: m.startPrice, endLog: m.endLog });
    const expected = Math.max(-Math.log(1.05), Math.min(Math.log(1.05), Math.log(m.referencePrice / tape.endUnaligned())));
    checked++;
    if (Math.abs(expected - m.endLog) > 1e-12) { aligned = false; console.log(`   ${id}: alignment ${m.endLog} ≠ ${expected}`); }
  }
  ok(`end-of-day alignment follows the published real reference prices (${checked} markets, max 5%)`, aligned);
}

if (symbol) {
  const m = reveal.markets[symbol];
  if (!ok(`market ${symbol} is in the reveal`, !!m)) process.exit(1);
  const tape = createDayTape({ dayKey: reveal.dayKey, date, symbol, volatility: m.volatility, startPrice: m.startPrice, endLog: m.endLog });
  const ts = Date.parse(at);
  if (tf === 'price') {
    console.log(`PRICE ${symbol} at ${new Date(ts).toISOString()} = ${roundPrice(tape.price(ts), m.precision)}`);
  } else {
    const width = TIMEFRAMES[tf] * 1000;
    if (!width) throw new Error('Unknown timeframe');
    const start = Math.floor(ts / width) * width;
    const mine = buildCandle(symbol, m.precision, start, width, start + width, tape.price);
    console.log('COMPUTED', JSON.stringify(mine));
    try {
      const res = await fetch(`${SITE}/api/market/history?symbol=${symbol}&tf=${tf}&count=50&before=${start + width}`);
      const body = await res.json();
      const site = body.candles?.find((c) => c.time === start);
      console.log('SITE    ', JSON.stringify(site));
      ok('computed candle equals the candle served by binexc.com', !!site && ['open', 'high', 'low', 'close'].every((k) => site[k] === mine[k]));
    } catch (e) { console.log('INFO  could not reach binexc.com:', e.message); }
  }
}
