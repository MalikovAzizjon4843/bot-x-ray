// Converting a Polymarket bot into something you can trade with a broker.
//
// Every bot in Bot X-Ray traded Polymarket's yes-or-no markets, and you don't trade those. So each kind of bot
// gets a conversion: what it did on Polymarket, the version of that trick on markets a broker offers, the rules
// with numbers taken from the wallet's own trades, what's lost on the way, and who builds it.
//
// Two conversions are built in and run on paper in the Strategy screen: "price it like an option" on Kalshi
// and on ETF option spreads. Every other conversion is written by Claude, from the spec this file produces,
// as a plug-in in lib/strategy/custom/ (see the README there). The screens and the MCP say which is which.

// The broker-side markets a conversion can target.
export const TARGETS = {
  options: {
    label: "Options",
    who: "a broker with US-listed options where you live",
    instrument:
      "call and put spreads on the Bitcoin and Ether ETFs (IBIT, ETHA)",
  },
  kalshi: {
    label: "Kalshi",
    who: "US residents and the other countries Kalshi accepts",
    instrument: "Kalshi's Bitcoin and Ether price markets",
  },
  crypto: {
    label: "Crypto exchange",
    who: "any crypto exchange that takes customers where you live",
    instrument:
      "Bitcoin and Ether spot (or perpetuals where you're allowed them)",
  },
  stocks: {
    label: "Stock broker, no options",
    who: "any stock broker",
    instrument: "the Bitcoin and Ether ETFs (IBIT, ETHA) as shares",
  },
  futures: {
    label: "Futures",
    who: "a futures broker",
    instrument: "CME micro Bitcoin and Ether futures",
  },
};

const COIN = { btc: "Bitcoin", eth: "Ether", sol: "Solana", xrp: "XRP" };
const ETF = { btc: "IBIT", eth: "ETHA" };

// What the wallet's trades say, as numbers the conversion can use.
export function evidence(r) {
  const b = r.behaviour || {};
  const fromShares = (b.coins || []).filter((x) => x.share >= 0.1).map((x) => x.coin);
  const text = (b.table || []).map((m) => `${m.slug || ""} ${m.title || ""}`.toLowerCase()).join(" ");
  const coins = fromShares.length ? fromShares : Object.keys(COIN).filter((c) => new RegExp(`\\b(${c}|${COIN[c].toLowerCase()}${c === "eth" ? "|ethereum" : ""})\\b`).test(text));
  const rx = b.reaction
    ? Object.entries(b.reaction).sort(
        (a, z) => (z[0] === "btc") - (a[0] === "btc") || z[1].buys - a[1].buys,
      )[0]
    : null;
  const bestLag = rx
    ? rx[1].byLag
        .filter((g) => g.share !== null)
        .sort((a, z) => z.share - a.share)[0]
    : null;
  const profitable = (r.byPrice || []).filter((x) => x.pnl > 0);
  const band = profitable.length
    ? [
        Math.min(...profitable.map((x) => BAND_LO[x.key])),
        Math.max(...profitable.map((x) => BAND_HI[x.key])),
      ]
    : null;
  const s = r.series || {};
  const r2 = (v, dp = 2) => (v === null || v === undefined ? null : Math.round(v * 10 ** dp) / 10 ** dp);
  return {
    coins: coins.length ? coins : ["btc"],
    leadCoin: rx?.[0] ?? null,
    lagSeconds: bestLag?.lag ?? null,
    followShare: r2(bestLag?.share ?? null),
    moveThreshold: 0.0003,
    pairCost: b.pair ? [r2(b.pair.lo), r2(b.pair.hi)] : null,
    balance: r2(b.balance ?? null),
    sellShare: b.trades ? r2(b.sells / b.trades, 3) : null,
    priceBand: band,
    feeRate: s.lifetime?.volume ? r2(s.lifetime.fees / s.lifetime.volume, 4) : null,
    perDollar: r2(s.lifetime?.perDollar ?? null, 4),
    horizon: horizonOf(b),
  };
}
const BAND_LO = {
  "<5": 0,
  "5-20": 0.05,
  "20-80": 0.2,
  "80-95": 0.8,
  "95-99": 0.95,
  "99+": 0.99,
};
const BAND_HI = {
  "<5": 0.05,
  "5-20": 0.2,
  "20-80": 0.8,
  "80-95": 0.95,
  "95-99": 0.99,
  "99+": 1,
};
function horizonOf(b) {
  const top = b.kinds?.[0]?.kind;
  if (top === "updown") return "15-minute";
  if (top === "updown-other") return "hourly and daily";
  if (top === "price-level") return "daily and weekly";
  return "short";
}

const c = (v) => `${Math.round(100 * v)}¢`;
const p0 = (v) => `${Math.round(100 * v)}%`;

// The conversion for each kind of bot, given its evidence. status: "built" (runs in the Strategy screen),
// "claude" (Claude builds it as a plug-in from the spec), "no" (there's no honest broker version).
export function conversions(tag, e) {
  const coins = e.coins.filter((x) => ETF[x]);
  const etfs = (coins.length ? coins : ["btc"])
    .map((x) => ETF[x])
    .join(" and ");
  const named = (coins.length ? coins : ["btc"])
    .map((x) => COIN[x])
    .join(" and ");
  const band = e.priceBand
    ? `${c(e.priceBand[0])} to ${c(e.priceBand[1])}`
    : "20¢ to 95¢";
  switch (tag) {
    case "options":
    case "levels":
      return {
        idea: `It prices "will ${named} be above this price on this date" like an option, buys the side priced too low and ${tag === "options" ? "holds it to the end" : "trades in and out"}.`,
        polymarket: [
          `Markets: ${named} price levels, ${e.horizon}.`,
          `Bought sides priced ${band}${e.priceBand ? " (where its own trades made money)" : ""}.`,
          e.sellShare === 0
            ? "Never sold: held every position to the end."
            : `Sold ${p0(e.sellShare)} of the time.`,
        ],
        targets: {
          options: {
            status: "built",
            rules: [
              `"Above K by Friday" becomes a call spread from K to the next strike on IBIT (Bitcoin) and ETHA (Ether); "below" becomes the matching put spread. Both are bought for a fixed debit.`,
              "Price each spread from the live price and the last 2 and 7 days of volatility.",
              "Buy when the model says it's at least 3¢ in the dollar too cheap after commissions, only on sides priced 20¢ to 95¢ (below 20¢ is where coinman2 lost money).",
              "Hold to expiry. Skip any expiry where the model's volatility and the market's disagree by more than 1.5×.",
            ],
            lost: [
              "Quotes here are 15 minutes late; your broker's are live.",
              "ETF options trade 9:30 to 4 New York time; Bitcoin moves all weekend.",
              "Options settle on the ETF's close, not Bitcoin's price.",
            ],
          },
          kalshi: {
            status: "built",
            rules: [
              "The same \"above K at the close\" contract on Bitcoin and Ether.",
              "Same pricing, same 3¢ edge after Kalshi's fee, same band, hold to the end.",
            ],
            lost: [
              "Only US residents and the countries Kalshi accepts.",
              "Kalshi settles on a 60-second average of CF Benchmarks' index.",
            ],
          },
          futures: {
            status: "claude",
            rules: [
              "Options on CME micro Bitcoin and Ether futures, as call and put spreads, priced the same way.",
              "Same edge and band, hold to expiry.",
            ],
            lost: [
              "Needs a futures account with options permission.",
              "Futures options are bigger: one contract is a lot of money for a test.",
            ],
          },
          crypto: {
            status: "no",
            why: "A spot position can't copy a yes-or-no payoff: it wins or loses by how far the price moves, not by whether it ends above K. Use an options broker or Kalshi.",
          },
          stocks: {
            status: "no",
            why: "Shares can't copy a yes-or-no payoff. Use options on the same ETF, or Kalshi.",
          },
        },
      };
    case "speed":
      return {
        idea: `It watched ${COIN[e.leadCoin] || "Bitcoin"} on Binance and bought on Polymarket before Polymarket's price caught up.`,
        polymarket: [
          `After ${COIN[e.leadCoin] || "Bitcoin"} moved more than 0.03% on Binance in the last ${e.lagSeconds ?? 10} seconds, ${e.followShare !== null ? p0(e.followShare) : "most"} of its buys were on the side of the move.`,
          `Held each position until its ${e.horizon} market ended.`,
          `Kept about ${e.perDollar !== null ? `${(100 * e.perDollar).toFixed(1)}¢` : "2¢"} on every dollar.`,
        ],
        targets: {
          crypto: {
            status: "claude",
            rules: [
              `Leader: the fastest ${named} price you can read (a major exchange's live trades). Laggard: your exchange's ${named} price.`,
              `When the leader moves more than 0.03% in ${e.lagSeconds ?? 10} seconds and your exchange hasn't moved yet, buy (or sell short where allowed) on your exchange.`,
              "Exit after the laggard catches up, or after 60 seconds, whichever comes first.",
              "Limit orders only, one position at a time.",
            ],
            lost: [
              "Speed: this edge now lasts under a second and needs a server next to the exchange. From home you'll be late. The live gap tab measures it.",
              "Exchange fees on both legs take most of a 0.03% move.",
            ],
          },
          stocks: {
            status: "claude",
            rules: [
              `Leader: ${named} on a crypto exchange. Laggard: ${etfs} during US market hours.`,
              `When ${named} moves more than 0.05% in ${e.lagSeconds ?? 10} seconds, buy ${etfs} in the same direction; exit after 60 seconds or once it catches up.`,
            ],
            lost: [
              "ETF market makers close this gap in milliseconds.",
              "US hours only.",
            ],
          },
          futures: {
            status: "claude",
            rules: [
              `Leader: ${named} spot. Laggard: the CME micro future.`,
              "Same trigger and exit as the crypto version.",
            ],
            lost: [
              "Same speed problem, and the future has its own funding gap to spot.",
            ],
          },
          kalshi: {
            status: "claude",
            rules: [
              "The same trick on Kalshi's hourly and 15-minute Bitcoin markets: buy the side of a fresh Binance move before Kalshi's price catches up.",
            ],
            lost: ["US only.", "Same speed problem as Polymarket now has."],
          },
          options: {
            status: "no",
            why: "An option's bid-ask spread is wider than the whole edge of a few seconds' move.",
          },
        },
      };
    case "pair":
      return {
        idea: "It bought Up and Down together for under $1, because one of them always pays $1.",
        polymarket: [
          `Paid ${e.pairCost ? `${c(e.pairCost[0])} to ${c(e.pairCost[1])}` : "96¢ to 99¢"} for a pair, in near-equal amounts.`,
          "Ignored Binance. Held both sides to the end.",
        ],
        targets: {
          kalshi: {
            status: "claude",
            rules: [
              "Buy Yes and No on the same Kalshi contract whenever both asks plus Kalshi's fees add up to less than $1.",
              "Equal numbers of each, hold to the end.",
            ],
            lost: [
              "US only.",
              "On Polymarket the live check found a pair never cost under $1 after fees; check Kalshi the same way before trusting it.",
            ],
          },
          options: {
            status: "no",
            why: "The options version (a box spread) is closed by market makers in microseconds, and commissions on four legs cost more than the gap.",
          },
          crypto: {
            status: "no",
            why: "Nothing on an exchange pays $1 whichever way the price goes for less than $1.",
          },
          stocks: {
            status: "no",
            why: "Nothing on a stock broker pays $1 whichever way the price goes for less than $1.",
          },
          futures: {
            status: "no",
            why: "The futures version (cash-and-carry) is a funding trade, not this one.",
          },
        },
      };
    case "maker":
      return {
        idea: "It mostly left resting orders and let other traders fill them, so it earned the spread and rebates instead of paying fees.",
        polymarket: [
          `Paid ${e.feeRate !== null ? `${(100 * e.feeRate).toFixed(2)}%` : "very little"} of what it traded in fees.`,
          "Quoted both sides and kept its prices close to fair.",
        ],
        targets: {
          crypto: {
            status: "claude",
            rules: [
              `Post limit buy and sell orders a little inside the spread on ${named}, priced around a fair value from the live price.`,
              "Cancel and re-post when the fair value moves. Cap how much you can hold either way.",
            ],
            lost: [
              "Rebates only exist on some exchanges and fee tiers.",
              "Fast traders pick off stale quotes: the reason gabagool22 stopped.",
            ],
          },
          kalshi: {
            status: "claude",
            rules: [
              "Post resting Yes and No orders around the model's fair price on Kalshi's Bitcoin markets.",
            ],
            lost: ["US only.", "Thin markets: fills can be slow."],
          },
          options: {
            status: "claude",
            rules: [
              `Post limit orders inside the bid-ask on the ${etfs} spreads the strategy already prices.`,
            ],
            lost: ["Retail brokers pay no rebates; you only save the spread."],
          },
          stocks: {
            status: "no",
            why: "Retail stock brokers don't pay you for resting orders, and the spread on these ETFs is a cent.",
          },
          futures: {
            status: "no",
            why: "CME queues favour the fastest firms; a home setup sits at the back.",
          },
        },
      };
    case "updown":
      return {
        idea: `It bet on whether ${named} would be up or down at the end of a short window.`,
        polymarket: [
          `Markets: ${e.horizon} Up or Down.`,
          e.sellShare !== null ? `Sold ${p0(e.sellShare)} of the time.` : "",
        ].filter(Boolean),
        targets: {
          kalshi: {
            status: "claude",
            rules: [
              "The same up-or-down question on Kalshi's hourly Bitcoin markets.",
            ],
            lost: ["US only."],
          },
          options: {
            status: "claude",
            rules: [
              `A same-day call spread (up) or put spread (down) on ${etfs} at the money, closed at the end of the window.`,
            ],
            lost: ["Options spreads are wide at this time scale."],
          },
          crypto: {
            status: "claude",
            rules: [
              `Buy (up) or sell (down) ${named}, with a stop and a target the same distance away, closed at the end of the window. That's the nearest thing to a yes-or-no payoff.`,
            ],
            lost: [
              "The payoff isn't fixed: a big move wins or loses more than the bet.",
            ],
          },
          stocks: {
            status: "claude",
            rules: [`The same trade on ${etfs} shares during US hours.`],
            lost: ["US hours only."],
          },
          futures: {
            status: "claude",
            rules: ["The same trade on the CME micro future."],
            lost: ["Contract size is large for a test."],
          },
        },
      };
    default:
      return {
        idea: "It mostly trades markets with no broker version (sports, politics, one-off events).",
        polymarket: [],
        targets: Object.fromEntries(
          Object.keys(TARGETS).map((k) => [
            k,
            {
              status: "no",
              why: "A broker has no market on the same question.",
            },
          ]),
        ),
      };
  }
}

// The full conversion for an x-ray report: per target, plus the spec and the prompt Claude builds it from.
export function convert(r, target) {
  const e = evidence(r);
  const conv = conversions(r.tag, e);
  const t = target && TARGETS[target] ? target : null;
  const pick =
    t ||
    Object.keys(conv.targets).find((k) => conv.targets[k].status === "built") ||
    Object.keys(conv.targets).find(
      (k) => conv.targets[k].status === "claude",
    ) ||
    "options";
  const chosen = conv.targets[pick];
  const spec = {
    from: { wallet: r.wallet, name: r.name, tag: r.tag },
    evidence: e,
    target: { id: pick, ...TARGETS[pick] },
    status: chosen.status,
    rules: chosen.rules || [],
    lost: chosen.lost || [],
    why: chosen.why || null,
  };
  return {
    idea: conv.idea,
    polymarket: conv.polymarket,
    targets: conv.targets,
    best: pick,
    spec,
    prompt: buildPrompt(r, spec),
  };
}

// What to paste into Claude Code (in the bot-x-ray folder) to build a conversion that isn't built in.
export function buildPrompt(r, spec) {
  if (spec.status === "no") return null;
  if (spec.status === "built")
    return `Bot X-Ray already runs this version on paper: open the Strategy screen and turn on ${spec.target.label === "Options" ? "ETF options" : "Kalshi"}.`;
  return [
    `In the bot-x-ray folder, convert ${r.name}'s Polymarket strategy into a paper strategy for ${spec.target.label.toLowerCase()} (${spec.target.instrument}).`,
    "Read lib/strategy/custom/README.md and follow it: write lib/strategy/custom/<short-name>.js so it shows up on the Strategy screen and runs on paper inside the existing risk limits.",
    `Rules to convert (from Bot X-Ray's x-ray of ${r.name}):`,
    ...spec.rules.map((x) => `- ${x}`),
    "What doesn't carry over, so build the check for it in:",
    ...spec.lost.map((x) => `- ${x}`),
    `Evidence from its trades: ${JSON.stringify(spec.evidence)}.`,
    "Use only public price data. Keep it on paper. Show me what it would have bought in the last scan, and stop there.",
  ].join("\n");
}

export const STATUS_LABEL = {
  built: "Built in, runs on paper",
  claude: "Claude builds it",
  no: "Doesn't convert",
};

export function toText(r, target) {
  const v = convert(r, target);
  const lines = [
    `# Trading ${r.name}'s strategy with a broker`,
    "",
    `On Polymarket: ${v.idea}`,
    ...v.polymarket.map((x) => `- ${x}`),
    "",
    "| Where | Converts? | How |",
    "|---|---|---|",
  ];
  for (const [k, t] of Object.entries(v.targets))
    lines.push(
      `| ${TARGETS[k].label} (${TARGETS[k].who}) | ${STATUS_LABEL[t.status]} | ${t.status === "no" ? t.why : t.rules[0]} |`,
    );
  const s = v.spec;
  lines.push("", `## ${TARGETS[s.target.id].label}: ${STATUS_LABEL[s.status]}`);
  if (s.status === "no") lines.push(s.why);
  else
    lines.push(
      "Rules:",
      ...s.rules.map((x) => `- ${x}`),
      "What's lost in the conversion:",
      ...s.lost.map((x) => `- ${x}`),
    );
  if (v.prompt)
    lines.push(
      "",
      s.status === "claude" ? "Claude builds this one. The prompt for it:" : "",
      "```",
      v.prompt,
      "```",
    );
  lines.push(
    "",
    'Bot X-Ray ships two conversions, run on paper: options spreads and Kalshi, for the "price it like an option" strategy. Everything else here is converted by Claude from these rules, as a plug-in in lib/strategy/custom/. Nothing converted trades real money until you connect a broker and arm it yourself.',
  );
  return lines.join("\n");
}

// Every target with its rules and the Claude prompt, for the screen.
export function convertAll(r) {
  const v = convert(r);
  const targets = {};
  for (const k of Object.keys(v.targets)) {
    const one = convert(r, k);
    targets[k] = { ...TARGETS[k], ...v.targets[k], prompt: one.prompt };
  }
  return { idea: v.idea, polymarket: v.polymarket, best: v.best, targets, evidence: v.spec.evidence };
}
