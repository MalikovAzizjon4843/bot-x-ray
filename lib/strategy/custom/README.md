# Your own strategies (plug-ins)

Every bot Bot X-Ray x-rays traded Polymarket's yes-or-no markets. To trade the same idea with a broker, it has to be converted: the "Trade it with a broker" tab shows the conversion for each bot, the rules with numbers from its own trades, and what gets lost on the way.

Two conversions are built in (the Strategy screen runs them on paper): "price it like an option" on ETF option spreads and on Kalshi. **Every other conversion is written by Claude, into this folder.** Copy the prompt from the "Trade it with a broker" tab (or ask Claude to "convert <wallet> for my <broker>"), and Claude writes one file here following this page.

## The file

`lib/strategy/custom/<short-name>.js`, lowercase, one strategy per file:

```js
export default {
  name: "speed-crypto",                 // short, unique, lowercase
  title: "Speed trade on a crypto exchange",
  from: "0x8dxd",                       // the wallet it was converted from
  target: "crypto",                     // options | kalshi | crypto | stocks | futures

  // Called every scan (every 5 minutes while the app is open). Return what it would buy now.
  async scan({ config, spot, now }) {
    return [
      {
        ticker: "BTC-USD long 60s 1792110000", // unique per position
        label: "BTC up, 60-second hold",
        coin: "btc",
        side: "yes",                          // yes = the trade wins if it's right
        cost: 0.5,                            // what $1 of payoff costs, 0 to 1, after fees
        fair: 0.56,                           // what the strategy thinks it's worth, 0 to 1
        edge: 0.06,                           // fair - cost
        closes: now + 60,                     // unix seconds when it settles
        meta: { entry: 82300 },               // anything settle() needs later
      },
    ];
  },

  // Called after `closes`. Return how much of $1 it paid back (0 to 1), or null to try again later.
  async settle(position) {
    return null;
  },
};
```

How it runs:

- The engine opens a paper position for each signal with `edge` at least the minimum edge in the settings, inside the same limits as everything else: $25 a trade, $500 at risk, $100 on one expiry, 3 new trades a scan, and the daily loss stop.
- A trade that isn't a yes-or-no payoff (a spot position with a stop and a target, say) still reports in the same shape: `cost` and `fair` per $1 of payoff, and `settle()` returns the share of $1 it got back. Write how you mapped it in a comment at the top of the file.
- Plug-ins stay on paper. Sending their orders to a broker needs its own code in the broker adapter (`lib/brokers/TEMPLATE.md`), after you've watched it on paper.
- Switch one off in `data/strategy/config.json`: `"custom": { "speed-crypto": false }`.
- Use only public price data, and only markets your broker offers where you live.

## Check it

`node scripts/test.js` must still pass. Then press Scan now on the Strategy screen: the plug-in shows under "Your plug-ins" with what it would buy, or the error it hit.
