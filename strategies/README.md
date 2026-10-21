# The three strategies

The rules behind the three bots from the video, worked out from their public trades. One still runs. Two stopped when Polymarket changed its rules.

| File | Bot | What it does | Status |
|---|---|---|---|
| [coinman2-option-pricing.md](coinman2-option-pricing.md) | coinman2 | Prices "above $X by Friday" markets like options and buys the side priced too low | Still trading. Built in: the Strategy screen runs it on paper |
| [gabagool22-pair-trade.md](gabagool22-pair-trade.md) | gabagool22 | Buys Up and Down together for under $1 a pair | Stopped 21 Feb 2026 |
| [0x8dxd-speed-trade.md](0x8dxd-speed-trade.md) | 0x8dxd | Buys on Polymarket after Bitcoin moves on Binance, before Polymarket's price catches up | Stopped 25 Mar 2026 |

Every number comes from Polymarket's public data and Binance's 1-second prices. Run any of them on another wallet with `node scripts/xray.js <wallet>`, or ask Claude "Reverse engineer the Polymarket wallet 0x8dxd".

A bot's past profit is history. It says nothing about what you would make. Everything here runs on paper until you connect your own broker and arm it yourself.
