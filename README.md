# Bot X-Ray

Reverse engineer any Polymarket trading bot from its public trades. Paste a wallet or a username and see what the bot actually does, whether it was skill or luck, and whether it still works. It also shows who's winning Polymarket's crypto markets this month, runs a live check of the gap the speed bots lived on, and runs the one strategy that held up on paper, ready for you to connect your own broker.

Every trade on Polymarket is public, so none of this needs an account, and reading the data works from anywhere. Bot X-Ray never places an order on Polymarket. It's one small Node.js app with no dependencies, and it runs on your computer.

## Install

**With an AI coding agent (easiest).** Paste the setup prompt from part-timequant.com/polymarket into Claude Code or Codex. It checks your machine, installs this, tests every data source from your connection, sets the paper strategy up for where you live, opens it and connects Claude.

**By hand.** Install Node.js 18 or newer from [nodejs.org](https://nodejs.org), then in this folder:

```bash
node scripts/check.js
```

```bash
node scripts/launch.js
```

There's no `npm install` step. Next time, double-click `start.command` (Mac) or `start.bat` (Windows), or run `./start.sh` (Linux). Stop it with `node scripts/stop.js`.

## The screens

| Screen | What it shows |
|---|---|
| Wallet | Lifetime P&L curve with the dates Polymarket changed the rules marked (5 Jan, about 18 Feb, 30 Mar 2026); month by month P&L, volume, profit per dollar and fees |
| What it does | The verdict in one sentence, the markets it trades, whether it buys both sides and what a pair costs it, whether it ever sells, the Binance reaction test and P&L by the price it paid |
| Skill or luck | Green days, the longest winning streak and its coin-flip odds, Sharpe, t-stat, probabilistic Sharpe, worst day and biggest drop |
| Still working? | The last 30, 60 and 90 days against its lifetime, profit per dollar by month, and how much of its profit fees took |
| Trade it with a broker | How the bot's trick converts from Polymarket to markets a broker offers (options, Kalshi, a crypto exchange, a stock broker, futures): the rules with numbers from its own trades, what's lost, and who builds it |
| Who's winning now | The top crypto earners this week, this month or all time, each tagged by strategy and checked for skill or luck; filter to the ones a coin flip can't explain |
| Live gap | Once a second: Bitcoin on Binance against Polymarket's 15-minute market, the cheapest Up + Down after fees, and every "bargain" a simple model sees, logged as a $10 paper trade and settled when the market ends |
| Strategy (paper) | The loop that's still running (below), on markets you can trade |
| Connect Claude | One command so Claude Code can do all of this from a chat |

The three bots from the video are one click away: `0x8dxd` (the speed trade), `gabagool22` (the pair trade) and `coinman2` (the "$1M bot", which prices markets like options). For those three, "What it does" reads the same sample of trades the video used, so the numbers match.

All three strategies are written up in [`strategies/`](strategies/README.md): coinman2's, which the Strategy screen runs, and gabagool22's and 0x8dxd's, with the rules, the record and why each one stopped.

## The strategy

coinman2 trades markets like "will Ethereum be above $2,600 on Friday". It works out the real chance from the live price and how much the price usually moves, buys whichever side is priced too low, and holds it to the end. It never sells. That's options pricing applied to a yes-or-no market.

Bot X-Ray runs that loop on paper, every 5 minutes while the app is open:

1. Read every "above this price by this date" contract on two markets:
   - **Kalshi's Bitcoin and Ether price markets.** Kalshi is a US-regulated exchange. It takes US residents and some other countries (the UK isn't one).
   - **Bitcoin and Ether ETF options (IBIT, ETHA), as one-strike-wide spreads.** "Above $47 by Friday" is a call spread and "below" is a put spread, both bought for a fixed debit. They need an options account with a broker that offers US-listed options where you live.
2. Price each one from the live price and realised volatility (the last 2 and 7 days of 5-minute prices).
3. Buy the side the model says is at least 3¢ too cheap after fees, only if it's priced 20¢ to 95¢. coinman2's own trades lost money below 20¢.
4. Skip a market whenever the model's volatility and the market's own volatility disagree by more than 1.5 times. The live check showed why: a simple model found a "bargain" 92% of the time, and those bargains were the model being wrong.
5. Hold to the end, then settle against the result.

`node scripts/setup.js --country US` turns both markets on; any other country turns Kalshi off (switch it back on in the Strategy screen if Kalshi takes customers where you live). Paper fills are at the quoted ask plus fees. Option quotes are CBOE's free ones, 15 minutes late.

## Converting a bot to your broker

Every bot here traded Polymarket's yes-or-no markets, and you don't trade those. The "Trade it with a broker" tab converts each one to markets a broker offers, with the rules spelled out and the numbers taken from the bot's own trades:

| The bot's trick | Options | Kalshi | Crypto exchange | Stock broker | Futures |
|---|---|---|---|---|---|
| Prices it like an option (coinman2) | **Built in** | **Built in** | Doesn't convert | Doesn't convert | Claude builds it |
| Speed trade (0x8dxd) | Doesn't convert | Claude builds it | Claude builds it | Claude builds it | Claude builds it |
| Pair trade (gabagool22) | Doesn't convert | Claude builds it | Doesn't convert | Doesn't convert | Doesn't convert |
| Resting orders | Claude builds it | Claude builds it | Claude builds it | Doesn't convert | Doesn't convert |
| Up or Down bets | Claude builds it | Claude builds it | Claude builds it | Claude builds it | Claude builds it |

**Built in** means Bot X-Ray ships it and the Strategy screen runs it on paper. **Claude builds it** means Bot X-Ray gives Claude the rules and a ready prompt, and Claude writes that version as a plug-in in `lib/strategy/custom/` (the contract is in the README there). It then runs on paper in the same loop and inside the same risk limits. **Doesn't convert** comes with the reason: a spot position can't copy a yes-or-no payoff, and nothing at a broker pays $1 whichever way the price goes for less than $1.

Each conversion also lists what's lost on the way: speed, fees, trading hours, settlement. That's why every one starts on paper.

## Your own broker

Bot X-Ray trades on paper until you connect a broker and arm it yourself:

- Ask Claude: "connect Bot X-Ray to my <broker> account". It writes `lib/brokers/<name>.js` following `lib/brokers/TEMPLATE.md`.
- Put your keys in a `.env` file in this folder (`BOTXRAY_BROKER`, `BOTXRAY_KEY_ID`, `BOTXRAY_SECRET`, `BOTXRAY_KEY_MODE=paper` or `live`). Keys stay in that file: they're never written to `data/`, never sent to the browser and never logged.
- Arm in your own terminal with `node scripts/arm.js`. It shows the limits and asks you to type the confirmation, and arming lasts 24 hours. The app and Claude can only disarm or stop.
- Every order is a limit order inside the risk limits in `data/strategy/config.json`: $25 a trade, $500 at risk at most, $100 on one expiry, 3 new trades a scan, and no new trades after a $100 loss in a day.

## Claude

```bash
node scripts/mcp.js --help
```

prints the `claude mcp add` line for this folder. Run it once, then ask Claude things like "Reverse engineer the Polymarket wallet 0x8dxd", "Convert 0x8dxd's strategy for my crypto exchange" or "Who's winning Polymarket's crypto markets this month?". Tools: `reverse_engineer_wallet`, `convert_to_broker`, `whos_winning`, `live_gap_check`, `strategy_scan`, `strategy_status`. None of them can arm live trading.

From a terminal, `node scripts/xray.js <wallet or username>` prints the same report.

## Where the numbers come from

| Data | Source |
|---|---|
| Daily P&L, fees, rebates, volume | `data-api.polymarket.com/v2/user-pnl` |
| Trades, merges, redeems | `data-api.polymarket.com/activity` |
| Leaderboard | `data-api.polymarket.com/v1/leaderboard` |
| Market results | `gamma-api.polymarket.com/markets` |
| Live order book | `clob.polymarket.com/book` |
| 1-second Bitcoin prices | Binance (or its market-data mirror) |
| Spot prices | Coinbase, Kraken, Binance |
| Strategy markets | Kalshi's public market data; CBOE's delayed option quotes |

The rule-change dates: taker fees on 15-minute crypto markets from 5 January 2026 ([The Block](https://www.theblock.co/post/384461/polymarket-adds-taker-fees-to-15-minute-crypto-markets-to-fund-liquidity-rebates)); the half-second taker delay removed around 18 February ([Protos](https://protos.com/polymarket-ends-trading-loophole-for-bitcoin-quants/)); the new crypto fee curve on 30 March (Polymarket's fee documentation).

Results are cached in `data/cache`, so a wallet you've x-rayed before opens at once. Past P&L of someone else's wallet is history. It says nothing about what you would make.

## Tests

```bash
node scripts/test.js
```

runs the offline tests (the three wallets' real P&L series are in `test/fixtures`). `node --test test/live.test.js` re-checks the video's numbers over the network.
