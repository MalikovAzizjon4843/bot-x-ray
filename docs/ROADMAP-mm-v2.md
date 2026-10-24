# Market-Maker v2 — Roadmap (noldan qurish)

## Kontekst
- GitHub `master` = v1 (`6eeeac7`, `33f1daa`). Avvalgi v2 ishi boshqa kompyuterda qolgan — bu yerda NOLDAN quriladi.
- Pastdagi "Tasdiqlangan faktlar" real Polymarket API/WS da allaqachon tekshirilgan. Qayta tadqiq qilma — faqat Etap 1 dagi probe bilan qisqa tasdiqla. Farq chiqsa — to'xta va menga ayt.
- Dev: Windows (`E:\Projects\bot-x-ray`). Server: Ubuntu. Kod cross-platform bo'lsin.

## Qat'iy qoidalar
1. REAL ORDER YO'Q (Etap 8 gacha). Private key, CLOB auth ishlatilmaydi.
2. Branch `mm-v2`. Har etap: commit → darhol `git push`.
3. Har etap oxirida TO'XTA, qisqa hisobot (o'zgargan fayllar, testlar, ochiq savollar). Men "davom" demaguncha keyingisiga o'tma.
4. `data/mm-paper.json` (v1) o'zgartirilmaydi — yaroqsiz deb belgilangan, faqat arxiv.
5. Shell buyruqlariga (fuser, ss, kill) tayanma. To'xtatish — `/api/shutdown` route orqali.
6. Javoblar qisqa, uzbekcha. Kod/identifikatorlar inglizcha.

---

## Tasdiqlangan faktlar

### WebSocket (market channel)
- URL: `wss://ws-subscriptions-clob.polymarket.com/ws/market`
- Subscribe: `{assets_ids:[...], type:"market", custom_feature_enabled:true}`
- Dinamik: `{assets_ids:[...], operation:"subscribe"|"unsubscribe"}` — ishlaydi. Unsub+sub ~110ms da yangi snapshot qaytaradi.
- Heartbeat: matnli `PING` har 10s → `PONG`.
- `book`: `bids` o'suvchi, `asks` kamayuvchi tartibda → ENG YAXSHI NARX OXIRIDA. `hash`, `tick_size`, `last_trade_price` bor.
- `price_change`: `price_changes[]` → `{asset_id, price, size, side, hash, best_bid, best_ask}`. `size` = darajaning ABSOLYUT yangi hajmi. Bitta xabarda ikkala token kelishi mumkin.
- `last_trade_price.side` = TAKER tomoni (~95%; ~5% istisno — cross-token matching, pastga qarang). `fee_rate_bps` doim "0" — ishlatma.
- Kitoblar MIRRORED (2026-10-24 tekshirildi, 2486/2486 daraja): YES ask P hajmi = NO bid 1−P hajmi, YES bid P = NO ask 1−P. Misol (btc 15m): Up ask 0.97 = 237.43 ↔ Down bid 0.03 = 237.43; Up bid 0.96 = 216.58 ↔ Down ask 0.04 = 216.58. Har bir o'zgarish ikkala kitobda ko'rinadi.
- Dinamik subscribe'da `best_bid_ask` kelmaydi → BBO ni o'zimiz hisoblaymiz.
- `tick_size_change`: narx 0.96 dan yuqori / 0.04 dan past → tick 0.01 ↔ 0.001.
- Ko'p darajali sweep ba'zan faqat keyingi snapshot'da ko'rinadi → `price_change` dagi `best_bid/best_ask` dan yaxshiroq lokal darajalarni o'chir (BBO self-heal).
- `book` snapshot'larning 66% trade'dan keyin ≤300ms keladi → snapshot'ni oldingi lokal kitob bilan diff qilib `level` event chiqar.
- Level kamayishi odatda trade xabaridan OLDIN keladi (929/932). Farq p50 12ms, p95 32ms; 98.5% ±300ms ichida.
- Kitobdagi kamayishlar: trade ulushi hodisa soni bo'yicha ~0.5%, hajm bo'yicha ~0.1% (2026-10-24, 10 min, 1.2M kamayish). Qolgani cancel/requote.
- "Jim yo'qolish": exchange ba'zan qo'shilgan hajmning yo'qolishini `price_change` bilan yubormaydi (2–8s yashaydi, ikkala complement kitobda). Sababi aniqlanmagan (GTD expiry bo'lishi mumkin). Shadow resync tuzatadi.
- Bitta WS ulanishda ~60 token (~3.9k msg/s) uziladi → FeedPool (default 8 ulanish).
- Raw frame ichida newline bo'lishi mumkin → yozishdan oldin olib tashla.
- Raw log: 60 token ≈ 0.5 GB/soat (gzip).
- Lokal latency (`recvTs − timestamp`): p50 67ms, p95 82ms.

### Fee va bozor parametrlari
- `/clob-markets/{conditionId}` → `fd = {r:0.07, e:1, to:true}`. Gamma `feeSchedule` bilan mos.
- Taker fee: `fee = C × r × (p×(1−p))^e`. p=0.5 → 0.0175/share, p=0.9 → 0.0063.
- `fd` olinmasa — fallback YO'Q, bozor skip + log.
- Rebate: taker fee'larning 20% lik pool'i, pro-rata, kafolatsiz → `rebateMode: off`.
- `itode:true` → taker orderlar 250ms ushlab turiladi.
- Min order: 5 share (`mos`).
- Strategiya A uchun p≈0.5 da ask'lar yig'indisi < ~0.965 bo'lishi kerak (amalda kam uchraydi).

### v1 dagi xatolar (v2 ga O'TKAZILMAYDI)
- Quote narxi `bestAsk − 0.005` → tick'ga mos emas.
- Event A: `bestAsk < limit` ham fill deb sanaladi.
- Event B: shu tokendagi birinchi trade = to'liq fill (FIFO yo'q).
- Event C: level kamayishi = fill (cancel ham fill).
- Strategiya A va scratch'da taker fee yo'q; scratch best bid hajmini hisobga olmaydi.
- Rebate equity'ga qo'shiladi.
- Cooldown faqat xotirada.
- Stop-loss `narx − bestBid ≥ 3¢` keng spread'da darhol ishga tushadi.
- `scripts/stop.js` → `/api/shutdown` yo'q, server to'xtamaydi.
- Lock yo'q → ikki instance bitta faylga yozgan.

---

## Etap 1 — Feed qatlami
Fayllar: `lib/clob-ws.js` (ClobFeed, FeedPool, RawLog), `lib/market-rotator.js`, `lib/mm-feed.js`, `scripts/ws-probe.js`, `test/clob-ws.test.js`.
- Node 24 ichki `WebSocket` (tashqi dependency yo'q).
- L2 kitob har token: `bids/asks Map<price,size>`, BBO, `lastUpdateTs`, `tickSize`.
- Event'lar: `level(assetId, side, price, newSize, prevSize, ts, source)` (`price_change|snapshot|bbo_heal|resync`), `trade`, `tick`, `stale`, `fresh`, `reconnected`.
- PING 10s; 25s PONG yo'q → reconnect, backoff 1s→30s + jitter, qayta subscribe.
- Stale FAQAT: (re)subscribe'dan keyin snapshot yo'q YOKI ulanish unhealthy. Jimlik stale EMAS.
- Shadow resync (REST o'rniga, qaror 2026-10-24): FeedPool'da alohida "shadow" ulanish; round-robin har token ≤50s da (ochiq orderli token — 15s) subscribe → snapshot → `hash` bo'yicha asosiy kitob bilan solishtirish → unsubscribe. Asosiy ulanish uzilmaydi. Diff → kitob = snapshot + keyingi o'zgarishlar, level event `source:"resync"`. Sabab: exchange ba'zan qo'shilgan orderning yo'qolishini `price_change` bilan yubormaydi (ikkala complement tokenda ko'rinadi, 2–8s yashaydi).
- `hash` — butun kitob holatining hash'i: shadow snapshot hash'i asosiy oqim tarixida topiladi (66/66) → aniq sinxron nuqta.
- REST `/book` — faqat metrika (har 5 min bitta token, hash bo'yicha).
- Rotator: har coin (btc, eth, sol, xrp, doge) × 5m/15m → joriy + keyingi oyna. Keyingisi start'dan ≥60s oldin subscribe, tugagani 60s grace'dan keyin unsubscribe.
- RawLog: `data/ws-raw/YYYY-MM-DD-HH.jsonl.gz`, har 5s va exit'da to'liq gzip member, `BOTXRAY_RAWLOG_MAX_GB` (default 2) rolling limit.
- Server: `/api/mm/feed-health` (ulanishlar, msg/s, stale tokenlar, reconnect soni, drift: `driftDetected`, `driftPerTokenHour`, o'rtacha/max drift yoshi), `/api/shutdown` + `stop.js` tuzatish.
- Single-instance lock: `data/.lock` (pid+port), tirik jarayon bo'lsa `exit(1)`, o'lik pid lock'i avtomatik olinadi.
- Env: `BOTXRAY_NO_FEED`, `BOTXRAY_FEED_COINS`, `BOTXRAY_RAWLOG_MAX_GB`.
- `.gitignore`: `data/ws-raw/`, `data/*.json`, `data/*.jsonl`, `data/.lock`, `.env`, `node_modules/`.
- Qabul (2026-10-24 da o'zgartirildi): har drift ≤ 60s ichida avtomatik tuzaladi (max drift yoshi); top-of-book REST bilan ≥ 99% mos (hash bo'yicha); 30 min lokal server run'da reconnect bo'ronlari yo'q; faktlardan farq bo'lsa hisobotda. Xom drift/token-soat — faqat metrika (o'lchangan: ~1.3).

## Etap 2 — Fill modeli (`lib/fill-model.js`, `test/fill-model.test.js`)
- `QueueOrder` (SELL va BUY simmetrik). Navbat `activeAt = placedAt + latencyMs` (default 400) paytidagi level hajmidan olinadi; yangi yaxshiroq narx darajasi → `queueAhead = 0`. Latency oynasidagi eventlar e'tiborsiz.
- Post-only: faollashganda kitobni kesib o'tsa → reject.
- Fill manbalari: `trade_at_level`, `trade_through`, `cross`.
- DOUBLE-COUNT QOIDASI: level kamayishi (barcha source'lar) darhol qo'llanmaydi → pending buffer `{qty, ts, source}`. Trade bilan ±300ms ichida IKKI TOMONGA match. Trade hajmi — authority. Match bo'lmagan qism oyna tugaganda = cancel → `cancelMode`. `queueAhead ≤ levelSize` clamp faqat reconciliation'dan keyin.
- `cancelMode`: `pessimistic` (default, queueAhead o'zgarmaydi) | `proportional`.
- `source:"resync"` kamayishi (shadow resync / jim yo'qolish) — HECH QACHON fill emas: buffer'ga tushadi, trade bilan match bo'lmaydi → cancel → `cancelMode`.
- Mirrored kitob → `queueAhead` faqat o'z token kitobidan (complement bid'lar unda allaqachon bor, qo'shilmaydi).
- Ochiq savol: bizning YES ask P darajamizni iste'mol qilgan trade NO token'da 1−P narxda kelishi mumkin (side istisnolari). Trade matching'da complement token trade'larini ham hisobga olish kerakmi — Etap 2 boshida o'lchab hal qilinadi.
- `crossFill` default TRUE. Sabab: cross = bestBid ≥ bizning ask = narx bizdan o'tgan = har doim adverse fill. `false` zararli fill'larni tashlab PnL ni optimistik qiladi.
- Yordamchilar: `takerFee(shares, p, fd)`, `roundToTick` (SELL yuqoriga), `sharesForUsd` (min 5 share), `sweep` (kitob bo'ylab VWAP), `MarkoutTracker` (5s, 30s; SELL markout = fillPrice − midLater).
- Majburiy testlar:
  1. queue 100, trade 60 at level → fill 0, queueAhead 40.
  2. keyin trade 70 → fill 30.
  3. cancel 50: pessimistic o'zgarmaydi; proportional kamayadi.
  4. trade-through → darhol fill.
  5. latency oynasidagi trade → e'tiborsiz.
  6. trade'siz level kamayishi → fill yo'q.
  7. takerFee: p=0.5 → 0.0175; p=0.9 → 0.0063.
  M1. level 100→40 (t=0), trade 60 (t=+50ms) → fill 0, queueAhead 40.
  M2. xuddi shu, trade 130 → fill 30.
  M3. level 100→40, 400ms trade yo'q → cancel 60 (pessimistic → clamp 40; proportional → hisob).
  M4. trade avval, level keyin (+80ms) → M1 bilan bir xil.
  M5. bbo_heal sweep + trade-through → to'liq fill, ikki marta sanalmaydi.

## Etap 3 — Engine v2 (`lib/mm-v2.js`)
- Ma'lumot: feed (REST faqat bozor ro'yxati/metadata, `fd` kesh 10 min).
- `engine: 'v1'|'v2'` flag, default v2. v1 UI'da "yaroqsiz".
- Strategiya A: `edge = 1 − askYes − askNo − fee(yes) − fee(no) > minEdgeA (0.003)`; hajm best ask hajmi bilan cheklangan; taker narxi = t+250ms dagi kitob (itode). Alohida counter: "A imkoniyatlari soni".
- Strategiya B (SPLIT-SELL): pair sum 1.02–1.065, narxlar tick'ga yaxlitlangan, post-only. Re-peg = cancel + yangi QueueOrder (navbat oxiridan).
- Stop-loss (yangi): `bestBid_at_fill − bestBid_now ≥ stopMoveCents (3¢)` VA fill'dan keyin `≥ minHoldMs (5000)`. Test: spread 4¢ da fill → darhol scratch BO'LMAYDI.
- `exitMode`: `taker_scratch` (VWAP + fee + 250ms) | `passive_exit` (bestAsk−tick maker, TTL gacha re-peg) | `hold_to_resolution`.
- Clean MERGE 180s + cooldown 15m (cooldown state faylda saqlanadi).
- Stale token → yangi quote yo'q.
- `rebateMode: off` ('estimate' faqat ma'lumot ustuni, equity'ga qo'shilmaydi).
- Config default: balans $50, order $10, maxOpen 3, minSpread 2¢, latency 400ms, pessimistic, crossFill true, exitMode taker_scratch.
- State: `data/mm-paper-v2.json`. Sikllar: `data/mm-cycles-v2.jsonl` — strategiya, bozor, har oyoq fillSource, queueAheadAtPlace, time-to-fill, fees, scratch, markout5/30, net PnL, cancelMode, crossFill, exitMode.
- Stats: net PnL, EV/sikl (fillSource bo'yicha ham), scratch %, markout 5s/30s, jami taker fee, max DD, fill rate, o'rtacha time-to-fill.
- Qabul: engine testlari + 10 min jonli smoke-test (xato yo'q, sikllar yoziladi).

## Etap 4 — Run Monitor UI (`#/mm` ichida yangi tab)
- `/api/mm/v2/stream` (SSE): sikl, fill, scratch, equity push.
- Panel: holat + config; feed health; equity egri chizig'i + max DD; go/no-go kartasi (yashil/sariq/qizil, <300 sikl → "yetarli ma'lumot yo'q"); oxirgi 100 sikl jadvali; EV/sikl fillSource bo'yicha; ochiq orderlar jonli queueAhead bilan.
- Boshqaruv: Start / Stop / Reset v2 (tasdiq bilan); config faqat to'xtagan holatda o'zgaradi.
- i18n uz + en.

## Etap 5 — Server deploy (Contabo, Ubuntu)
Mijoz loyihalariga TA'SIR QILMASLIGI SHART.
1. Faqat o'qish hisoboti: `ss -tlnp`, `free -h`, `df -h`, `nproc`, running servislar, nginx sites, `timedatectl`. Tasdiqimsiz hech narsa o'rnatilmaydi.
2. User `xray` (sudo'siz), nvm + Node 24, `/home/xray/bot-x-ray` (mm-v2).
3. systemd: `User=xray`, `Restart=always`, `RestartSec=5`, `Nice=10`, `MemoryMax=768M`, `CPUQuota=100%`, `IOWeight=50`, `HOST=127.0.0.1`, `PORT=3797`.
4. `BOTXRAY_RAWLOG_MAX_GB` — df natijasiga qarab taklif.
5. Kirish faqat SSH tunnel: `ssh -L 3797:127.0.0.1:3797 ...`. Tashqi port / nginx — tegilmaydi.
6. `scripts/deploy.sh`: git pull → npm ci → systemctl restart → health check; rollback.
7. O'lchov: server vs lokal latency p50/p95, 30 min FeedPool uzilishlari, CPU/RAM.
8. Geoblock — faqat hisobotda qayd.

## Etap 6 — Replay (serverda, UI'dan)
- `scripts/replay.js` + UI tugmasi (worker_threads, progress SSE).
- Matritsa: cancelMode {pessimistic, proportional} × crossFill {true, false} × exitMode {taker_scratch, passive_exit, hold_to_resolution}.
- Natija jadvali UI'da + CSV. Ixtiyoriy sweep: minSpread {1,2,3}¢ × TTL {90,180}s.

## Etap 7 — 24–48 soat jonli paper (serverda)
- Config: Etap 3 default + Etap 6 dagi eng yaxshi exitMode.
- Go/no-go (≥300 sikl, pessimistic):
  | Metrika | Talab |
  |---|---|
  | EV/sikl (fee'dan keyin, rebate'siz) | > 0 |
  | Scratch % | < 10% |
  | Markout 30s o'rtacha | ≥ −0.3¢/share |
  | Max drawdown | < 15% |
- Qaror crossFill {true, false} natijalarining YOMONROG'I bo'yicha.

## Etap 8 — Live $50
Faqat Etap 7 = GO bo'lsa, alohida prompt bilan.
