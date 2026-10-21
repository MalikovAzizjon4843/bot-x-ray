# coinman2: the option-pricing loop

**Status: still trading.** Built into Bot X-Ray: the Strategy screen runs it on paper every 5 minutes on markets you can trade.

## What it did

coinman2 trades markets like "Will Ether be above $2,600 on Friday?". From 1 March to 21 April 2026 it made 7,900 buys and 0 sells. It holds every position to the end.

The rules, read from those trades:

1. Work out the real chance of "above $X by the date" from the live price and how much the coin usually moves.
2. Buy whichever side is priced below that chance.
3. Buy only sides priced 20¢ to 95¢. Its trades below 20¢ lost money.
4. Hold to the end. Never sell.

| Price paid | Spent | Won | P&L |
|---|---|---|---|
| Under 5¢ | $4.8k | 0% | −$4.8k |
| 5–20¢ | $34k | 7% | −$13k |
| 20–80¢ | $419k | 65.4% | +$86k |
| 80–95¢ | $528k | 96.1% | +$42k |
| 95–99¢ | $165k | 99.4% | +$5k |

## Its scars

A −$145,694 day, a $322k loss from November 2025 to February 2026, and down $41k since 1 September 2026 (−$561 over the 30 days to 19 October).

## How Bot X-Ray runs it

On Kalshi's Bitcoin and Ether price markets (US), and on Bitcoin and Ether ETF options (IBIT, ETHA) as one-strike-wide spreads. It adds one rule coinman2's trades don't show: skip a market when the model's volatility and the market's disagree by more than 1.5 times. The full loop is in the main README under "The strategy", and the code is in `lib/strategy/`.
