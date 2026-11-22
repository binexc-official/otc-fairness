# binexc OTC fairness — verify every OTC price yourself

**binexc does not control OTC prices — 100%.** OTC markets run on their own like a live market. Every OTC price comes from a fixed public formula and a daily key whose fingerprint is **published before the day begins** (normally about 30 days ahead). No user, trade, amount, direction, order or balance is ever an input, so prices cannot react to anyone's trade. Once a day is sealed, any change to its prices would no longer match the published proof. This repository lets anyone check that with mathematics.

## How it works

1. **A key for every UTC day.** Each day has its own 32-byte key: `dayKey = HMAC-SHA256(master, "binexc-otc-v4:" + YYYY-MM-DD)`.
2. **Sealed before the day.** `SHA-256(dayKey)` (the *commitment*) is published here before the day begins — normally about 30 days early; each file records its exact `publishedAt` and has an OpenTimestamps receipt (`commitments/`, `timestamps/`). A commitment reveals nothing about the key, but a different key would never match it.
3. **The day runs.** Prices come only from `generator/otc-v4-generator.mjs` with: the day key, the time, the market's fixed volatility, the day's start price (= the previous day's close) and the daily real-price alignment.
4. **Revealed after the day ends.** Once every trade of that day has settled (normally at 00:00 UTC), the day key and each market's start price are published (`reveals/`). Today's and future keys are never published.
5. **Check it.** Recompute any candle or trade price with the published key and compare it with binexc.com. A single changed price would no longer match.

**Daily real-price alignment.** In the last minute of each UTC day (23:59–00:00) every OTC market moves at most 5% toward its real-world reference price; the exact amount (`endLog`) is in each reveal. Every trade that is running during that minute is refunded, so nobody gains or loses from it.

**What the servers can and cannot do.** binexc's servers hold the keys, so they can calculate upcoming prices — but they cannot change a sealed day, and prices never depend on who trades, how much or in which direction. The daily alignment (`endLog`) is the only value not sealed in advance: it is limited to 5%, used only in the refunded last minute, and published in every reveal.

## Verify with Node.js (no binexc code needed)

```bash
git clone https://github.com/binexc-official/otc-fairness && cd otc-fairness
node verify/verify.mjs 2026-11-24                                  # commitment, key, start-price chain
node verify/verify.mjs 2026-11-24 EURUSD_OTC 1m 2026-11-24T10:15:00Z    # one candle vs binexc.com
node verify/verify.mjs 2026-11-24 EURUSD_OTC price 2026-11-24T10:15:03.250Z  # one instant (trade entry/expiry)
```

Or use the Verify tool at **https://binexc.com/fairness** — it computes in your browser, not on our servers. You can also check a single trade there by its 12-digit Trade ID (shown in trade history).

## Files

| Path | Contents |
| --- | --- |
| `commitments/YYYY-MM.json` | every commitment of the month |
| `commitments/days/YYYY-MM-DD.json` | one day's commitment (exact bytes timestamped in `timestamps/`) |
| `reveals/YYYY-MM-DD.json` | the finished day's key, start prices, alignment and self-check |
| `start.json` | when secure-v4 started |
| `generator/` | the exact price generator binexc runs (same file on servers and in browsers) |
| `verify/` | the standalone verification script |
| `timestamps/*.ots` | OpenTimestamps receipts (Bitcoin-anchored proof of when a file existed; upgrade with `ots upgrade`) |

Git history and OpenTimestamps receipts show when each commitment appeared, independently of binexc.
