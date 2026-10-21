# Verify Bot X-Ray

Run these before calling any change done. Each must pass.

1. **Offline tests.** `node scripts/test.js` → all pass (the three wallets' P&L maths, the pricing model and fees, the broker guard, the server and the MCP).
2. **Install check.** `node scripts/check.js` → `READY` (tests, data-source doctor, live smoke test that x-rays gabagool22 through the API).
3. **The video's numbers.** `node --test test/live.test.js` → 3 pass. Delete `data/cache` first for a cold run that goes to the network: 0x8dxd is a speed bot with 79% of 1,484 buys on the side of a 10-second Binance move and +$5,748 in the sample hour; gabagool22 is a pair bot at 96–99¢ a pair; coinman2 has 7,900 buys, 0 sells, both sides in 204 of 385 markets.
4. **The screens.** `node scripts/launch.js`, open each tab: Wallet, What it does, Skill or luck and Still working? on 0x8dxd, gabagool22 and coinman2; Who's winning now fills 15 rows (50 with Top 50), every row has a skill-or-luck label, and "Only edges luck can't explain" with "Sort by least likely to be luck" leaves only Real edge rows, rarest coin-flip odds first; Live gap counts seconds after Start; Strategy shows a scan (Scan now) with paper positions or a reason for each skipped market; Connect Claude shows the `claude mcp add` line.
5. **Claude.** `node scripts/mcp.js --help`, run the printed line, then in a new Claude Code chat: "Reverse engineer the Polymarket wallet 0x8dxd." → the answer leads with the verdict.
6. **Paper only by default.** `node scripts/arm.js` with no broker connected prints the stub's note and exits 1. The Strategy screen says "Paper".
7. **The kit.** `sh video/package.sh` (from a clean commit) builds `dist/` with the tarball, zip and filled prompt and no `{{` left. Then a new-user install: an empty folder, `claude --safe-mode`, paste `dist/bot-x-ray-prompt.md` (pointed at the local kit with `sh video/package.sh dist http://127.0.0.1:8899` and a static server on that port), and it ends READY with the app open and Claude connected.

Deployed means: part-timequant.com/kit/bot-x-ray.tar.gz, .zip and -prompt.md return 200, and the live prompt passes step 7 against them. Deploying the page is Lewis's call.
