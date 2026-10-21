# Connecting your broker

Bot X-Ray trades on paper until you connect a broker and arm it yourself. This file is the brief for writing an adapter. Ask Claude: "connect Bot X-Ray to my <broker> account", and it follows this.

Two different jobs, both done by Claude when you ask:
- **Converting a strategy** (what to trade): the "Trade it with a broker" tab turns a Polymarket bot into rules for your broker's markets, and Claude writes it as a plug-in in `lib/strategy/custom/` (see the README there). It runs on paper.
- **Connecting the broker** (how orders get sent): this file. Only needed once you've watched a strategy on paper and want real orders.

## What to check first

- The broker or exchange accepts customers where you live, and your account is allowed to trade the market the strategy uses: Kalshi's Bitcoin and Ether price markets, or US-listed options on IBIT and ETHA as spreads.
- It has an API for your account type. Use its paper or demo account first if it has one.
- Read its API docs from the broker's own site. Use only official endpoints.

## The file

Create `lib/brokers/<name>.js` (lowercase letters, numbers and dashes). Copy the shape of `stub.js`:

```js
export default {
  name: "<name>",          // matches BOTXRAY_BROKER in .env
  title: "<Broker name>",
  live: true,              // true once submit() really places orders
  venues: ["kalshi"],      // or ["options"]: which strategy market it trades
  note: "",
  async account(keys) {},  // -> { ok, mode: "paper" | "live", cash }  (mode from the broker, not from .env)
  async submit(keys, order) {}, // order: { venue, ticker, side: "yes" | "no", contracts, limit } -> { id, status }
  async positions(keys) {}, // -> [{ ticker, side, contracts, avgPrice }]
};
```

Rules for the adapter:

- Read keys only from the `keys` argument. Never write them to a file, log them or return them.
- Send limit orders only, at the `limit` price or better. Never a market order.
- For options, `side: "yes"` is a debit call spread and `side: "no"` a debit put spread: the two legs in `order.legs`, sent as one spread order, so the most it can lose is the debit.
- `account()` reports whether the broker says the keys are paper or live. The connector refuses to arm when that disagrees with `BOTXRAY_KEY_MODE`.
- Keep `node --test test/brokers.test.js` passing. Add a test with `fetch` stubbed, so it runs without the network.

## Keys

Put them in `.env` in the Bot X-Ray folder (it's ignored by git and never served):

```
BOTXRAY_BROKER=<name>
BOTXRAY_KEY_ID=...
BOTXRAY_SECRET=...
BOTXRAY_KEY_MODE=paper
```

Some brokers sign requests with a private key file instead of a secret: put its path in `BOTXRAY_SECRET` and read the file in the adapter.

## Going live

1. Run the strategy on paper until you've seen how it behaves across a few weeks.
2. Point it at the broker's paper account (`BOTXRAY_KEY_MODE=paper`) and check fills match.
3. Switch to live keys, set `BOTXRAY_KEY_MODE=live`, then in your own terminal run `node scripts/arm.js`. It shows the limits and asks you to type the confirmation. Arming lasts 24 hours.
4. Stop at any time with the Stop button, or `node scripts/arm.js --stop`.

Nothing in Bot X-Ray promises a profit. These markets can go to zero for the side you hold.
