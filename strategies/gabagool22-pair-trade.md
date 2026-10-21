# gabagool22: the pair trade

**Status: stopped on 21 February 2026.** The rules are here so you can see how it worked and test it yourself. As it was written, it doesn't work today.

## What it did

gabagool22 traded Polymarket's 15-minute "Bitcoin Up or Down" and "Ether Up or Down" markets. Every one of those markets pays $1 to one side. So if you buy one Up and one Down for less than $1 together, you're paid $1 whichever way the price goes.

The rules, read from its trades:

1. In each 15-minute market, buy Up and Down in near-equal amounts. In one market on 10 December 2025 it bought 6,656 Up and 6,617 Down.
2. Only buy when a pair costs under $1. It paid 96¢ to 99¢ a pair.
3. Ignore where Bitcoin is going. After a big move on Binance, its buys followed the move 51% of the time: a coin flip.
4. Hold both sides to the end and collect $1 a pair.

In that sample hour it bought both sides in 10 of 10 markets, and all 10 made money (+$9 to +$140). $31,196 went in and $31,799 came back, +1.9%.

## The record

- $865k on $71.4M traded, 30 October 2025 to 21 February 2026 (leaderboard: $813k).
- 111 green days in a row, 31 October to 18 February. The worst day in that run was +$2,467.
- Its profit on every dollar traded fell every month: 2.1%, 1.9%, 1.6%, 1.1%, 0.8%.

## Why it stopped

- **5 January 2026:** taker fees on the 15-minute crypto markets, 1.56¢ a share at 50¢.
- **About 18 February 2026:** Polymarket removed its half-second taker delay on crypto markets, with no announcement. That delay gave resting orders like gabagool22's time to pull a stale price. Without it, faster traders picked them off.
- It made $5k to $12k a day up to 18 February, then +$1,666, +$171, and −$22 on 21 February. Then it stopped.

## Does it work now?

Not for anyone buying at the asking price. In a live check on 15 October 2026, Up plus Down cost 98¢ to $1.01 (median $1.01), and after fees a pair never cost under $1 (the cheapest was $1.002). Bot X-Ray's Live gap screen runs the same check once a second, so you can see it for yourself.

## Taking it to a broker

Only Kalshi has the same shape: Yes and No on one event, settling at $1. The "Trade it with a broker" tab for gabagool22 has the rules and a prompt for Claude to build it as a paper plug-in. Check a Kalshi pair costs under $1 after fees before trusting it.
