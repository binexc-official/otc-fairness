# binexc OTC fairness — verify every OTC price yourself

[English](#english) · [বাংলা](#বাংলা)

## English

**binexc does not control OTC prices.** Every OTC price comes from a fixed public formula and a daily key whose fingerprint is **published before the day begins** (normally about 30 days ahead). No user, trade, amount, direction, order or balance is ever an input, so prices cannot react to anyone's trade. Once a day is sealed, any change to its prices would no longer match the published proof. This repository lets anyone check that with mathematics.

### How it works

1. **A key for every UTC day.** Each day has its own 32-byte key: `dayKey = HMAC-SHA256(master, "binexc-otc-v4:" + YYYY-MM-DD)`.
2. **Sealed before the day.** `SHA-256(dayKey)` (the *commitment*) is published here before the day begins — normally about 30 days early; each file records its exact `publishedAt` and has an OpenTimestamps receipt (`commitments/`, `timestamps/`). A commitment reveals nothing about the key, but a different key would never match it.
3. **The day runs.** Prices come only from `generator/otc-v4-generator.mjs` with: the day key, the time, the market's fixed volatility, the day's start price (= the previous day's close) and the daily real-price alignment.
4. **Revealed after the day ends.** Once every trade of that day has settled (normally at 00:00 UTC), the day key and each market's start price are published (`reveals/`). Today's and future keys are never published.
5. **Check it.** Recompute any candle or trade price with the published key and compare it with binexc.com. A single changed price would no longer match.

**Daily real-price alignment.** In the last minute of each UTC day (23:59–00:00) every OTC market moves at most 5% toward its real-world reference price; the exact amount (`endLog`) is in each reveal. Every trade that is running during that minute is refunded, so nobody gains or loses from it.

**What the servers can and cannot do.** binexc's servers hold the keys, so they can calculate upcoming prices — but they cannot change a sealed day, and prices never depend on who trades, how much or in which direction. The daily alignment (`endLog`) is the only value not sealed in advance: it is limited to 5%, used only in the refunded last minute, and published in every reveal.

### Verify with Node.js (no binexc code needed)

```bash
git clone https://github.com/binexc-official/otc-fairness && cd otc-fairness
node verify/verify.mjs 2026-11-24                                  # commitment, key, start-price chain
node verify/verify.mjs 2026-11-24 EURUSD_OTC 1m 2026-11-24T10:15:00Z    # one candle vs binexc.com
node verify/verify.mjs 2026-11-24 EURUSD_OTC price 2026-11-24T10:15:03.250Z  # one instant (trade entry/expiry)
```

Or use the Verify tool at **https://binexc.com/fairness** — it computes in your browser, not on our servers.

### Files

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

## বাংলা

binexc-এর OTC দাম **১০০% একটা নির্দিষ্ট পাবলিক সূত্র দিয়ে তৈরি**। কোনো ইউজার, ট্রেড, টাকার পরিমাণ, অর্ডার বা ব্যালেন্স কখনো এর ইনপুট নয়। প্রতিদিনের দাম **আগে থেকেই নির্ধারিত ও সিল করা** — binexc নিজেও সিল করা দিনের OTC দাম বদলাতে বা নিয়ন্ত্রণ করতে পারে না। এই রিপো দিয়ে যে কেউ গণিত দিয়ে তা যাচাই করতে পারবেন।

### কীভাবে কাজ করে

1. **প্রতিটা UTC দিনের আলাদা চাবি।** `dayKey = HMAC-SHA256(master, "binexc-otc-v4:" + YYYY-MM-DD)`।
2. **দিন শুরুর আগেই সিল।** দিনটা শুরুর আগেই (সাধারণত প্রায় ৩০ দিন আগে; প্রতিটা ফাইলে সঠিক `publishedAt` ও OpenTimestamps রসিদ আছে) `SHA-256(dayKey)` — অর্থাৎ অঙ্গীকার — এখানে প্রকাশ হয় (`commitments/`)। এটা থেকে চাবি বের করা যায় না, কিন্তু অন্য কোনো চাবি এর সাথে কখনো মিলবে না।
3. **দিন চলে।** দাম আসে শুধু `generator/otc-v4-generator.mjs` থেকে: দিনের চাবি, সময়, মার্কেটের স্থির volatility, দিনের শুরুর দাম (= আগের দিনের শেষ দাম) আর দৈনিক আসল-দামের সমন্বয়।
4. **দিন শেষে প্রকাশ।** সেদিনের সব ট্রেড শেষ হলে (সাধারণত 00:00 UTC) চাবি ও প্রতিটা মার্কেটের শুরুর দাম প্রকাশ হয় (`reveals/`)। আজকের বা ভবিষ্যতের চাবি কখনো প্রকাশ হয় না।
5. **নিজে যাচাই করুন।** প্রকাশিত চাবি দিয়ে যেকোনো ক্যান্ডেল বা ট্রেডের দাম নতুন করে হিসাব করে binexc.com-এর সাথে মিলিয়ে দেখুন। একটা দামও বদলালে আর মিলবে না।

**দৈনিক আসল দামের সাথে সমন্বয়।** প্রতিটা UTC দিনের শেষ মিনিটে (23:59–00:00) প্রতিটা OTC মার্কেট তার আসল বাজারদরের দিকে সর্বোচ্চ ৫% সরে; ঠিক কতটা (`endLog`) তা প্রতিটা reveal-এ আছে। ওই মিনিটে চলমান সব ট্রেড ফেরত (refund) হয়, তাই এতে কারো লাভ-ক্ষতি হয় না।

**binexc-এর আয়।** প্ল্যাটফর্মের আয় আসে payout-এর পার্থক্য থেকে (জেতা ট্রেড স্টেকের ১০০%-এর কম দেয়), দামের ওঠানামা থেকে নয়।

### Node.js দিয়ে যাচাই (binexc-এর কোড লাগবে না)

```bash
git clone https://github.com/binexc-official/otc-fairness && cd otc-fairness
node verify/verify.mjs 2026-11-24
node verify/verify.mjs 2026-11-24 EURUSD_OTC 1m 2026-11-24T10:15:00Z
```

অথবা **https://binexc.com/fairness**-এর Verify টুল ব্যবহার করুন — হিসাব হয় আপনার ব্রাউজারে, আমাদের সার্ভারে নয়।
