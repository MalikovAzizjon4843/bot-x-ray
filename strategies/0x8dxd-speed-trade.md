# 0x8dxd: the speed trade

**Status: stopped on 25 March 2026.** It came back in August, lost money and stopped again. The rules are here so you can see how it worked and test it yourself. As it was written, it doesn't work today.

## What it did

0x8dxd traded Polymarket's 15-minute "Up or Down" markets on Bitcoin, Ether, Solana and XRP. It watched Bitcoin's price on Binance and bought on Polymarket before Polymarket's price caught up.

The rules, read from its trades:

1. Watch Binance every second.
2. When Bitcoin moves more than 0.03% in 10 seconds, buy the side of the move on Polymarket: Up after a rise, Down after a fall. It did this 79% of the time (1,484 buys).
3. Buy only below a fair price worked out from Binance. On average it paid 1.4¢ a share under it.
4. Keep going all market long. It bought both sides of every market in the sample, in uneven amounts.
5. Hold to the end.

The lag it lived on was several seconds, not the "100 milliseconds" the X threads talk about. Within 2 seconds of a move its buys followed the move 54% of the time, within 4 seconds 58%, and within 10 seconds 79%.

In one sample hour (10 February 2026) it made 3,697 trades across 12 markets: $81,229 spent, $86,977 back, +$5,748.

## The record

- $2.17M on $90.8M traded, 5 December 2025 to 25 March 2026 (leaderboard: $2.05M).
- 103 of 109 trading days green.
- Every month earned about the same 2.3% to 2.5% of what it traded: $322k in December, $536k in January, $772k in February, $503k in March.
- It paid $322k in fees from 5 January on.

## Why it stopped

- **5 January 2026:** taker fees on the 15-minute crypto markets. It kept going and paid them.
- **25 March 2026:** its last full day (−$6,245).
- **30 March 2026:** Polymarket's new crypto fee curve, 1.75¢ a share at 50¢. On a 10¢ share the fee went from 2% to 6.3% of the trade.
- **10 to 25 August 2026:** it came back, made 3,438 trades on $567k, lost $1,468, and stopped for good.

## Does it work now?

Not at the speed a home computer can trade. In a live check on 15 October 2026, Polymarket's price moved in the same second as Binance. Whatever lag is left is under a second, and catching that takes servers next to the exchange. Bot X-Ray's Live gap screen shows the lag live.

## Taking it to a broker

The same idea, trading on a fast market's move before a slower one catches up, can be tried on Kalshi, a crypto exchange, a stock broker or futures. The "Trade it with a broker" tab for 0x8dxd has the rules for each and a prompt for Claude to build one as a paper plug-in. Each one loses the same thing: someone faster is already doing it.
