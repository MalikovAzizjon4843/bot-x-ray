import { lineChart, bars, hbars, spark } from "./chart.js";
import {
  t,
  lang,
  setLang,
  translateTag,
  translateEdge,
  translateRule,
  translateVerdict,
  translateStill,
  translateLuckVerdict,
  translateKind,
  formatMonth,
  formatNiceDate,
  formatCloseTime,
} from "./i18n.js";

const $ = (s) => document.querySelector(s);
const main = $("#main");
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

async function api(path, body) {
  const r = await fetch(
    path,
    body
      ? {
          method: "POST",
          headers: { "content-type": "application/json", "x-bx": "1" },
          body: JSON.stringify(body),
        }
      : undefined,
  );
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}

// ---------- formatting ----------
const usd = (v) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  const a = Math.abs(v) < 0.5 ? 0 : Math.abs(v);
  const s =
    a >= 1e6
      ? `$${(a / 1e6).toFixed(2)}M`
      : a >= 1e4
        ? `$${Math.round(a / 1e3)}k`
        : `$${Math.round(a).toLocaleString("en-GB")}`;
  return v < 0 && a > 0 ? `−${s}` : s;
};
const signed = (v) => (Number.isFinite(v) && v >= 0 ? `+${usd(v)}` : usd(v));
const pct = (v, dp = 1) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  const s = Math.abs(100 * v).toFixed(dp);
  return `${v < 0 && Number(s) !== 0 ? "−" : ""}${s}%`;
};
const cents = (v) => (Number.isFinite(v) ? `${(100 * v).toFixed(1)}¢` : "–");
const nice = (d) => formatNiceDate(d);
const monthName = (m) => formatMonth(m);
const short = (w) => (w ? `${w.slice(0, 6)}…${w.slice(-4)}` : "");
const time = (t) =>
  new Date(t * 1000).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
const sup = (s) => esc(s).replace(/10\^(\d+)/, "10<sup>$1</sup>");
const stat = (value, label) =>
  `<div class="stat"><b>${value}</b><span>${label}</span></div>`;

// ---------- state and routing ----------
const WALLET_TABS = ["wallet", "does", "luck", "working", "convert"];
const state = {
  tab: "wallet",
  wallet: null,
  report: null,
  job: null,
  steps: [],
  error: null,
  presets: null,
  timers: [],
  convertTarget: null,
};
const saved = (() => {
  try {
    return localStorage.getItem("bx.wallet");
  } catch {
    return null;
  }
})();

function updateChromeLanguage() {
  const current = lang();
  document.documentElement.lang = current;
  const brandTagline = $("#brand-tagline");
  if (brandTagline) brandTagline.textContent = t("brand.tagline");
  const walletInput = $("#wallet");
  if (walletInput) {
    walletInput.placeholder = t("input.placeholder");
    walletInput.setAttribute("aria-label", t("input.placeholder"));
  }
  const btnXray = $("#btn-xray");
  if (btnXray) btnXray.textContent = t("btn.xray");

  for (const a of document.querySelectorAll("nav.tabs a")) {
    const k = a.dataset.tab;
    if (k) a.textContent = t(`tab.${k}`);
  }

  for (const btn of document.querySelectorAll(".lang-btn")) {
    btn.classList.toggle("active", btn.dataset.lang === current);
  }
}

function route() {
  const [, tab = "wallet", w] = location.hash.split("/");
  if (tab !== state.tab) window.scrollTo(0, 0);
  state.tab = tab;
  for (const a of document.querySelectorAll("nav.tabs a"))
    a.classList.toggle("on", a.dataset.tab === tab);
  if (w && decodeURIComponent(w) !== state.wallet)
    return runXray(decodeURIComponent(w));
  render();
}
const go = (tab, wallet = state.wallet) => {
  location.hash = `#/${tab}${wallet && WALLET_TABS.includes(tab) ? `/${encodeURIComponent(wallet)}` : ""}`;
};
for (const a of document.querySelectorAll("nav.tabs a"))
  a.addEventListener("click", (e) => {
    e.preventDefault();
    go(a.dataset.tab);
  });

$("#who").addEventListener("submit", (e) => {
  e.preventDefault();
  const w = $("#wallet").value.trim();
  if (w) {
    const tab = WALLET_TABS.includes(state.tab)
      ? state.tab
      : "wallet";
    location.hash = `#/${tab}/${encodeURIComponent(w)}`;
  }
});

// Language switcher clicks
for (const btn of document.querySelectorAll(".lang-btn")) {
  btn.addEventListener("click", () => {
    const code = btn.dataset.lang;
    if (code && code !== lang()) {
      setLang(code);
      updateChromeLanguage();
      render();
    }
  });
}

function clearTimers() {
  state.timers.forEach(clearTimeout);
  state.timers = [];
}
const later = (fn, ms) => state.timers.push(setTimeout(fn, ms));

async function runXray(wallet) {
  state.wallet = wallet;
  state.report = null;
  state.error = null;
  state.steps = [];
  $("#wallet").value = wallet;
  try {
    localStorage.setItem("bx.wallet", wallet);
  } catch {
    /* private window */
  }
  render();
  try {
    const { job } = await api("/api/xray", { wallet });
    state.job = job;
    const poll = async () => {
      if (state.job !== job) return;
      const j = await api(`/api/xray/${job}`);
      state.steps = j.steps;
      if (j.error) state.error = j.error.message;
      if (j.report) state.report = j.report;
      if (!j.done) setTimeout(poll, 600);
      render();
    };
    poll();
  } catch (e) {
    state.error = e.message;
    render();
  }
}

// ---------- screens ----------
function render() {
  clearTimers();
  updateChromeLanguage();
  const tTab = state.tab;
  if (tTab === "winning") return winning();
  if (tTab === "live") return liveScreen();
  if (tTab === "strategy") return strategy();
  if (tTab === "claude") return claude();
  if (!state.wallet) return welcome();
  if (state.error)
    return (main.innerHTML = `<div class="empty"><p class="kicker">${t("error.couldnt")} ${esc(state.wallet)}</p><h1>${esc(state.error)}</h1><p>${t("error.try")}</p></div>`);
  if (!state.report) return progress();
  (({ wallet: walletScreen, does, luck, working, convert: convertScreen })[tTab] || walletScreen)(
    state.report,
  );
}

function welcome() {
  main.innerHTML = `<div class="empty">
    <p class="kicker">${t("welcome.kicker")}</p>
    <h1>${t("welcome.h1")}</h1>
    <p class="sub">${t("welcome.sub")}</p>
    <p class="hand" style="margin-top:28px">${t("welcome.try")}</p>
  </div>`;
}

function progress() {
  const last = state.steps.at(-1);
  main.innerHTML = `<div class="progress"><p class="kicker">${t("progress.xraying")} ${esc(state.wallet)}</p>
    <p class="hand">${esc(last?.msg || t("progress.start"))}…</p>
    <p class="small">${state.steps
      .slice(0, -1)
      .map((s) => esc(s.msg))
      .join(" · ")}</p>
    <p class="small muted">${t("progress.note")}</p></div>`;
}

function header(r, kicker) {
  return `<p class="kicker">${esc(kicker)} · ${esc(r.name)} <span class="muted" title="${esc(r.wallet)}">${short(r.wallet)}</span></p>`;
}

function walletScreen(r) {
  const s = r.series,
    life = s.lifetime;
  const headline = s.stopped
    ? t("wallet.made.stopped", {
        name: r.name,
        pnl: usd(life.pnl),
        date: nice(s.main?.end ?? s.lastTrade),
      })
    : t("wallet.made.active", {
        name: r.name,
        pnl: usd(life.pnl),
        date: nice(s.first),
      });

  const subLine = t("wallet.sub", {
    volume: usd(life.volume),
    perDollar: pct(life.perDollar),
    trades: life.trades.toLocaleString("en-GB"),
    fees: usd(life.fees),
  });

  main.innerHTML = `${header(r, t("tab.wallet"))}
    <h1>${esc(headline)}</h1>
    <p class="sub">${subLine}</p>
    <div class="hero" id="curve"></div>
    <div class="stats">
      ${stat(usd(life.pnl), t("wallet.stat.lifetime"))}
      ${stat(usd(life.volume), t("wallet.stat.traded"))}
      ${stat(pct(life.perDollar), t("wallet.stat.perDollar"))}
      ${stat(usd(life.fees), t("wallet.stat.fees"))}
      ${stat(usd(life.income), t("wallet.stat.rebates"))}
      ${stat(r.leaderboard ? usd(r.leaderboard.pnl) : "–", t("wallet.stat.leaderboard"))}
    </div>
    <h2>${t("wallet.h2.monthly")}</h2>
    <div class="tablewrap"><table><tr><th>${t("wallet.th.month")}</th><th>${t("wallet.th.pnl")}</th><th>${t("wallet.th.traded")}</th><th>${t("wallet.th.profitPer")}</th><th>${t("wallet.th.fees")}</th><th>${t("wallet.th.days")}</th></tr>
    ${s.months
      .filter((m) => m.volume >= 1000 || Math.abs(m.pnl) >= 1000)
      .map(
        (m) =>
          `<tr><td>${monthName(m.month)}</td><td>${signed(m.pnl)}</td><td>${usd(m.volume)}</td><td>${pct(m.perDollar)}</td><td>${usd(m.fees)}</td><td>${m.days}</td></tr>`,
      )
      .join("")}</table></div>
    ${r.ruleEffects.length ? `<h2>${t("wallet.h2.ruleChanges")}</h2><div class="tablewrap"><table><tr><th>${t("wallet.th.date")}</th><th class="l">${t("wallet.th.change")}</th><th>${t("wallet.th.2wBefore")}</th><th>${t("wallet.th.2wAfter")}</th></tr>${r.ruleEffects.map((e) => `<tr><td>${nice(e.day)}</td><td class="l">${esc(translateRule(e.label))}${e.stoppedDaysAfter !== null ? `<span class="note-inline">${t("wallet.stoppedDaysAfter", { n: e.stoppedDaysAfter })}</span>` : ""}</td><td>${e.before === null ? "–" : signed(e.before)}</td><td>${e.after === null ? t("wallet.noTrading") : signed(e.after)}</td></tr>`).join("")}</table></div>` : ""}
    <p class="foot">${t("wallet.foot")}</p>`;
  const pts = s.curve.map(([d, v]) => [Date.parse(d), v]);
  const circles = [];
  if (s.stopped && s.main) {
    const p = s.curve.find(([d]) => d === s.main.end);
    if (p)
      circles.push({
        x: Date.parse(p[0]),
        y: p[1],
        label: t("wallet.stopped.label"),
        dx: 20,
        dy: 34,
      });
  }
  lineChart($("#curve"), {
    series: [{ points: pts }],
    fmt: usd,
    marks: r.series.ruleChanges.map((c) => ({
      x: Date.parse(c.day),
      label: translateRule(c.short),
    })),
    circles,
  });
}

function does(r) {
  const b = r.behaviour;
  const rx = b.reaction
    ? Object.entries(b.reaction).sort(
        (a, z) => (z[0] === "btc") - (a[0] === "btc") || z[1].buys - a[1].buys,
      )[0]
    : null;
  const COIN = { btc: "Bitcoin", eth: "Ether", sol: "Solana", xrp: "XRP" };
  const tagLbl = translateTag(r.tag, r.tagLabel);
  const verdictTxt = translateVerdict(r);

  main.innerHTML = `${header(r, t("tab.does"))}
    <p><span class="pill blue">${esc(tagLbl)}</span></p>
    <p class="verdict">${esc(verdictTxt)}</p>
    <p class="small" style="margin-top:10px">${t("does.from", {
      trades: b.trades.toLocaleString("en-GB"),
      start: esc(r.sample?.start.slice(0, 16).replace("T", " ")),
      end: esc(r.sample?.end.slice(0, 16).replace("T", " ")),
      why: esc(r.sample?.why),
    })}</p>
    <div class="cols" style="margin-top:20px">
      <div><h2>${t("does.h2.binance")}</h2>${rx ? `<p class="small">${t("does.binance.desc", { coin: COIN[rx[0]] || "Bitcoin" })}</p><div id="react"></div>` : `<p class="small">${esc(b.reactionError || b.reactionNote || t("does.binance.noShort"))}</p>`}</div>
      <div><h2>${t("does.h2.markets")}</h2><div id="kinds"></div></div>
    </div>
    <div class="stats">
      ${stat(`${b.bothSides} / ${b.markets}`, t("does.stat.bothSides"))}
      ${stat(b.pair ? `${Math.round(100 * b.pair.lo)}–${Math.round(100 * b.pair.hi)}¢` : "–", t("does.stat.pairCost"))}
      ${stat(b.balance !== null ? (b.balance >= 0.85 ? t("does.stat.balance.equal") : t("does.stat.balance.uneven")) : "–", t("does.stat.balance"))}
      ${stat(b.sells === 0 ? t("does.stat.sells.never") : pct(b.sells / b.trades), t("does.stat.sells"))}
      ${stat(b.settled.markets ? signed(b.settled.pnl) : "–", t("does.stat.sampleResult", { n: b.settled.markets }))}
      ${stat(rx && Number.isFinite(rx[1].edgeCents) ? `${rx[1].edgeCents.toFixed(1)}¢` : "–", t("does.stat.paidBelow"))}
    </div>
    ${r.byPrice.length ? `<h2>${t("does.h2.byPrice")}</h2><p class="small">${t("does.byPrice.desc")}</p><div class="tablewrap"><table><tr><th>${t("does.th.pricePaid")}</th><th>${t("does.th.buys")}</th><th>${t("does.th.spent")}</th><th>${t("does.th.avgPrice")}</th><th>${t("does.th.won")}</th><th>${t("wallet.th.pnl")}</th><th>${t("does.th.return")}</th></tr>${r.byPrice.map((x) => `<tr><td>${x.label}</td><td>${x.buys.toLocaleString("en-GB")}</td><td>${usd(x.spent)}</td><td>${Math.round(100 * x.avgPrice)}¢</td><td>${pct(x.won)}</td><td>${signed(x.pnl)}</td><td>${pct(x.ret)}</td></tr>`).join("")}</table></div>` : ""}
    <h2>${t("does.h2.sampleMarkets")}</h2>
    <div class="tablewrap"><table><tr><th>${t("does.th.market")}</th><th>${t("does.th.trades")}</th><th class="l">${t("does.th.bought")}</th><th>${t("does.th.pair")}</th><th>${t("does.th.winner")}</th><th>${t("wallet.th.pnl")}</th></tr>
    ${b.table
      .slice(0, 15)
      .map(
        (m) =>
          `<tr><td title="${esc(m.slug)}">${esc((m.title || m.slug || "").slice(0, 60))}</td><td>${m.trades}</td><td class="l">${m.sides.map((s) => `${Math.round(s.shares).toLocaleString("en-GB")} ${esc(s.side)} @ ${Math.round(100 * s.avg)}¢`).join(", ")}</td><td>${m.pair ? `${Math.round(100 * m.pair)}¢` : ""}</td><td>${esc(m.winner || t("does.open"))}</td><td>${m.pnl === null ? "" : signed(m.pnl)}</td></tr>`,
      )
      .join("")}</table></div>
    <p class="foot">${t("does.foot")}</p>`;
  if (rx) {
    const g = rx[1].byLag;
    const r10 = g.find((x) => x.lag === 10);
    hbars($("#react"), {
      data: g.map((x) => ({
        label: t("does.lastSeconds", { lag: x.lag }),
        sub: t("does.buysCount", { n: x.buys.toLocaleString("en-GB") }),
        value: x.share ?? 0,
      })),
      max: 1,
      fmt: (v) => pct(v, 0),
      ref: 0.5,
      refLabel: t("does.coinFlip"),
      circle: r10
        ? {
            label: t("does.lastSeconds", { lag: 10 }),
            note: r10.share >= 0.6 ? t("does.tradesTheLag") : t("does.ignoresBinance"),
          }
        : null,
    });
  }
  hbars($("#kinds"), {
    data: b.kinds.slice(0, 4).map((k) => ({
      label: translateKind(
        k.label
          .replace(/ \(.*\)$/, "")
          .replace("5- and 15-minute crypto Up or Down", "5/15-min Up or Down")
          .replace(
            "hourly and daily crypto Up or Down",
            "Hourly/daily Up or Down",
          ),
      ),
      value: k.share,
    })),
    max: 1,
    fmt: (v) => pct(v, 0),
  });
}

function luck(r) {
  const l = r.luck;
  const bigNum =
    l.streak && l.streak.days >= 15 ? sup(l.streak.odds) : pct(l.greenShare, 0);
  const bigLabel =
    l.streak && l.streak.days >= 15
      ? t("luck.headsInRow", { days: l.streak.days })
      : t("luck.greenDays");
  const lotto =
    l.streak?.lotto >= 2
      ? t("luck.lotto", { n: Math.floor(l.streak.lotto) })
      : "";
  const verdictTxt = translateLuckVerdict(l.verdict);

  main.innerHTML = `${header(r, t("tab.luck"))}
    <div class="big">${bigNum}</div>
    <p class="small">${esc(bigLabel)}${lotto ? ` <span class="note-inline">${esc(lotto.charAt(0).toLowerCase() + lotto.slice(1))}</span>` : ""}</p>
    <h1 style="margin-top:22px">${sup(verdictTxt)}</h1>
    <div class="hero" id="daily"></div>
    <div class="stats">
      ${stat(`${l.green} / ${l.days}`, t("luck.stat.greenOf"))}
      ${stat(l.streak ? `${l.streak.days} ${t("luck.days", { n: "" }).trim()}` : "–", l.streak ? t("luck.stat.longestRunDates", { from: nice(l.streak.from), to: nice(l.streak.to) }) : t("luck.stat.longestRun"))}
      ${stat(l.sharpe.toFixed(1), t("luck.stat.sharpe"))}
      ${stat(l.tStat.toFixed(1), t("luck.stat.tstat"))}
      ${stat(l.psr === null ? "–" : pct(l.psr, 2), t("luck.stat.psr"))}
      ${stat(l.worstDay ? signed(l.worstDay.pnl) : "–", l.worstDay ? t("luck.stat.worstDayDate", { date: nice(l.worstDay.day) }) : t("luck.stat.worstDay"))}
      ${stat(usd(l.maxDrawdown), t("luck.stat.maxDd"))}
      ${stat(sup(l.greenChance), t("luck.stat.coinGreen"))}
    </div>
    <p class="foot">${esc(l.note)} ${t("luck.foot")}</p>`;
  const data = r.daily.map(([x, y]) => ({ x, y }));
  const hl = [];
  if (l.worstDay && Math.abs(l.worstDay.pnl) > 0)
    hl.push({
      x: l.worstDay.day,
      label: `${t("luck.worstDayLabel")} ${signed(l.worstDay.pnl)}`,
      dx: 22,
      dy: l.worstDay.pnl < 0 ? 6 : -14,
    });
  bars($("#daily"), { data, fmt: usd, highlight: hl, xFmt: nice });
}

function working(r) {
  const s = r.series;
  const months = s.months.filter((m) => m.perDollar !== null);
  const stillTxt = translateStill(r.still);

  main.innerHTML = `${header(r, t("tab.working"))}
    <h1>${esc(stillTxt)}</h1>
    <h2>${t("working.h2.profitPerDollar")}</h2>
    <div class="hero" id="trend"></div>
    <div class="tablewrap"><table><tr><th>${t("working.th.window")}</th><th>${t("wallet.th.pnl")}</th><th>${t("wallet.th.traded")}</th><th>${t("wallet.th.profitPer")}</th><th>${t("wallet.th.fees")}</th><th>${t("working.th.trades")}</th></tr>
    ${s.recent.map((w) => `<tr><td>${t("working.lastDays", { n: w.days })}</td><td>${signed(w.pnl)}</td><td>${usd(w.volume)}</td><td>${pct(w.perDollar)}</td><td>${usd(w.fees)}</td><td>${w.trades.toLocaleString("en-GB")}</td></tr>`).join("")}
    <tr><td><b>${t("working.lifetime")}</b></td><td><b>${signed(s.lifetime.pnl)}</b></td><td>${usd(s.lifetime.volume)}</td><td>${pct(s.lifetime.perDollar)}</td><td>${usd(s.lifetime.fees)}</td><td>${s.lifetime.trades.toLocaleString("en-GB")}</td></tr></table></div>
    <h2>${t("working.h2.feesVsProfit")}</h2>
    <div id="fees" style="max-width:720px"></div>
    <p class="foot">${t("working.foot")} ${s.stopped ? "" : t("working.footActive")}</p>`;
  if (months.length) {
    const data = months.map((m) => ({ x: m.month, y: m.perDollar }));
    const last = data.at(-1);
    bars($("#trend"), {
      data,
      fmt: (v) => pct(v, 1),
      xFmt: monthName,
      height: 240,
      highlight: s.stopped
        ? []
        : [{ x: last.x, label: t("working.now"), dx: -24, dy: -24, anchor: "end" }],
    });
  }
  const before = s.lifetime.tradePnl;
  hbars($("#fees"), {
    data: [
      { label: t("working.bar.before"), value: Math.max(before, 0) },
      { label: t("working.bar.fees"), value: s.lifetime.fees, grey: true },
      { label: t("working.bar.kept"), value: Math.max(s.lifetime.pnl, 0) },
    ],
    fmt: usd,
    circle:
      s.lifetime.feeShare !== null && s.lifetime.feeShare > 0.3
        ? {
            label: t("working.bar.fees"),
            note: t("working.feesTook", { pct: pct(s.lifetime.feeShare, 0) }),
          }
        : null,
  });
}

function convertScreen(r) {
  const STATUS_DICT = {
    built: [t("convert.status.built"), "blue"],
    claude: [t("convert.status.claude"), ""],
    no: [t("convert.status.no"), "grey"],
  };
  const v = r.convert;
  if (!v)
    return (main.innerHTML = `${header(r, t("tab.convert"))}<p class="sub">${t("convert.rerun")}</p>`);
  const pick = state.convertTarget && v.targets[state.convertTarget] ? state.convertTarget : v.best;
  const targetObj = v.targets[pick];
  const order = Object.keys(v.targets).sort(
    (a, b) =>
      ["built", "claude", "no"].indexOf(v.targets[a].status) -
      ["built", "claude", "no"].indexOf(v.targets[b].status),
  );
  const any = order.some((k) => v.targets[k].status !== "no");

  main.innerHTML = `${header(r, t("tab.convert"))}
    <h1>${t("convert.traded", { name: r.name })} ${any ? t("convert.hereshow") : t("convert.noVersion")}</h1>
    <p class="sub"><b>${t("convert.onPoly")}</b> ${esc(v.idea)}</p>
    <ul class="small" style="margin:6px 0 0;padding-left:18px">${v.polymarket.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
    <div class="cards" style="margin-top:22px">
      ${order.map((k) => {
        const x = v.targets[k];
        const [lab, cls] = STATUS_DICT[x.status];
        return `<button class="target ${k === pick ? "on" : ""}" data-k="${k}"><b>${esc(x.label)}</b><span class="small">${esc(x.who)}</span><span class="pill ${cls}">${lab}</span></button>`;
      }).join("")}
    </div>
    <div class="cols" style="margin-top:8px">
      <div>
        <h2>${esc(targetObj.label)}: ${{ built: t("convert.builtIn"), claude: t("convert.claudeBuilds"), no: t("convert.doesntConvert") }[targetObj.status]}</h2>
        ${targetObj.status === "no" ? `<p>${esc(targetObj.why)}</p>` : `<p class="small">${esc(targetObj.instrument)}</p><ol class="rules">${targetObj.rules.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>
        <h2>${t("convert.lostH2")}</h2><ul class="rules">${targetObj.lost.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`}
      </div>
      <div>
        ${targetObj.status === "built" ? `<h2>${t("convert.h2.whoBuild")}</h2><p>${t("convert.builtin.desc")} <a href="#/strategy">${t("convert.openStrategy")}</a> ${t("convert.turnOn")} ${pick === "kalshi" ? "Kalshi" : "ETF options"}.</p>` : ""}
        ${targetObj.status === "claude" ? `<h2>${t("convert.h2.claudeBuilds")}</h2><p class="small">${t("convert.claude.desc")}</p><pre class="cmd" id="cprompt">${esc(targetObj.prompt)}</pre><div class="row"><button class="btn ghost" id="ccopy">${t("convert.copyPrompt")}</button><span class="small" id="ccopied"></span></div>` : ""}
        ${targetObj.status === "no" ? `<h2>${t("convert.h2.whereConvert")}</h2><p class="small">${order.filter((k) => v.targets[k].status !== "no").map((k) => esc(v.targets[k].label)).join(", ") || t("convert.nowhere")}</p>` : ""}
      </div>
    </div>
    <div class="card" style="margin-top:26px;max-width:900px">
      <p class="hand" style="margin:0 0 6px">${t("convert.whoDoesBox.title")}</p>
      <p style="margin:0">${t("convert.whoDoesBox.desc")}</p>
    </div>
    <p class="foot">${t("convert.foot", { name: r.name })}</p>`;

  for (const b of document.querySelectorAll("button.target"))
    b.onclick = () => {
      state.convertTarget = b.dataset.k;
      render();
    };
  if ($("#ccopy"))
    $("#ccopy").onclick = async () => {
      try {
        await navigator.clipboard.writeText($("#cprompt").textContent);
        $("#ccopied").textContent = t("convert.copied");
      } catch {
        $("#ccopied").textContent = t("convert.selectCopy");
      }
    };
}

const lbView = (() => {
  try {
    return JSON.parse(localStorage.getItem("bx.lb")) || {};
  } catch {
    return {};
  }
})();

async function winning() {
  const v = { period: "MONTH", limit: "15", show: "all", sort: "pnl", ...lbView };
  const PERIOD = {
    WEEK: t("winning.thisWeek").toLowerCase(),
    MONTH: t("winning.thisMonth").toLowerCase(),
    ALL: t("winning.allTime").toLowerCase(),
  };

  main.innerHTML = `<p class="kicker">${t("winning.kicker")}</p>
    <h1>${t("winning.h1")}</h1>
    <p class="sub">${t("winning.sub")}</p>
    <div class="row" style="margin:18px 0 6px">
      <select id="lp" class="chip"><option value="WEEK">${t("winning.thisWeek")}</option><option value="MONTH">${t("winning.thisMonth")}</option><option value="ALL">${t("winning.allTime")}</option></select>
      <select id="ll" class="chip"><option value="15">${t("winning.top15")}</option><option value="50">${t("winning.top50")}</option></select>
      <select id="lw" class="chip"><option value="all">${t("winning.everyWallet")}</option><option value="better">${t("winning.betterThan")}</option><option value="edge">${t("winning.onlyEdges")}</option></select>
      <select id="ls" class="chip"><option value="pnl">${t("winning.sortPnl")}</option><option value="skill">${t("winning.sortSkill")}</option></select>
    </div>
    <div id="lb" class="progress"><p class="hand">${t("winning.reading")}</p></div>`;

  const ctl = { lp: "period", ll: "limit", lw: "show", ls: "sort" };
  for (const [id, k] of Object.entries(ctl)) {
    $(`#${id}`).value = v[k];
    $(`#${id}`).onchange = (e) => {
      v[k] = e.target.value;
      try {
        localStorage.setItem("bx.lb", JSON.stringify(v));
        Object.assign(lbView, v);
      } catch {
        /* private window */
      }
      clearTimers();
      draw();
    };
  }

  const EDGE_PILL = { edge: "blue", probably: "", luck: "grey", few: "grey" };

  const draw = async (refresh = false) => {
    if (state.tab !== "winning") return;
    let s;
    try {
      s = await api(
        `/api/leaderboard?period=${v.period}&limit=${v.limit}${refresh ? "&refresh=1" : ""}`,
      );
    } catch (e) {
      $("#lb").innerHTML = `<p class="err">${esc(e.message)}</p>`;
      return;
    }
    const busy = s.status && !["Done", "Failed"].includes(s.status);
    const all = s.rows || [];
    let rows = all.filter((x) =>
      v.show === "edge"
        ? x.edge === "edge"
        : v.show === "better"
          ? x.edge === "edge" || x.edge === "probably"
          : true,
    );
    if (v.sort === "skill")
      rows = [...rows].sort(
        (a, b) =>
          (a.luck?.log10Chance ?? 0) - (b.luck?.log10Chance ?? 0) ||
          (b.luck?.tStat ?? 0) - (a.luck?.tStat ?? 0),
      );
    const edges = all.filter((x) => x.edge === "edge").length;
    const better = all.filter(
      (x) => x.edge === "edge" || x.edge === "probably",
    ).length;
    const fast = all.filter((x) =>
      ["speed", "maker", "pair", "updown"].includes(x.tag),
    ).length;

    $("#lb").className = "";
    $("#lb").innerHTML = `${
      busy
        ? `<p class="hand">${esc(s.status)}: ${s.done ?? 0} / ${s.total ?? v.limit}…</p>`
        : `<p class="small">${esc(s.error || `${all.length} ta yetakchi (${PERIOD[v.period]}), yangilandi: ${new Date(s.finishedAt).toLocaleTimeString("en-GB")}.`)} <a href="#" id="lbr">${t("winning.refresh")}</a></p>`
    }
      ${all.length && !busy ? `<p class="hand">${edges} / ${all.length} — haqiqiy ustunlik · ${better} — tanga tashlashdan ustun · ${fast} — qisqa Up/Down savdolari</p>` : ""}
      <div class="tablewrap"><table><tr><th>${t("winning.th.rank")}</th><th class="l">${t("winning.th.wallet")}</th><th>${t("winning.th.pnl")} ${PERIOD[v.period]}</th><th class="l">${t("winning.th.looksLike")}</th><th class="l">${t("winning.th.skillLuck")}</th><th>${t("winning.th.greenDays")}</th><th title="How often flipping a coin gives that many green days">${t("winning.th.coinOdds")}</th><th title="Buys after a Binance move that were on the side of the move">${t("winning.th.followsBin")}</th><th title="Fees as a share of what it traded">${t("winning.th.feeShare")}</th><th class="l">${t("winning.th.profitPerMonth")}</th></tr>
      ${rows
        .map(
          (x) =>
            `<tr class="click" data-w="${esc(x.wallet)}" data-n="${esc(x.name)}"><td>${x.rank}</td><td class="l">${esc(/^0x[0-9a-fA-F]{20,}/.test(x.name) ? short(x.name) : x.name)}</td><td>${signed(x.pnl)}</td><td class="l"><span class="pill ${x.tag === "speed" ? "blue" : x.tag === "quiet" || x.tag === "other" ? "grey" : ""}">${esc(translateTag(x.tag, x.tagLabel))}</span></td><td class="l"><span class="pill ${EDGE_PILL[x.edge] ?? "grey"}">${esc(translateEdge(x.edge, x.edgeLabel || "–"))}</span></td><td>${x.luck ? `${x.luck.green} / ${x.luck.days}` : "–"}</td><td>${x.luck ? (x.luck.log10Chance > -0.3 ? (lang() === "uz" ? "tez-tez" : "often") : sup(x.luck.chance.replace("1 in ", "1 / "))) : "–"}</td><td>${x.followsBinance === null || x.followsBinance === undefined ? "–" : pct(x.followsBinance, 0)}</td><td>${pct(x.feeRate, 2)}</td><td class="l">${spark((x.trend || []).map((t) => t.perDollar))} <span class="small">${(x.trend || []).map((t) => pct(t.perDollar, 1)).join(" → ")}</span></td></tr>`,
        )
        .join("")}</table></div>
      ${!busy && all.length && !rows.length ? `<p class="small">${t("winning.noneFilter", { n: all.length })}</p>` : ""}
      <p class="foot">${t("winning.foot")}</p>`;

    for (const tr of document.querySelectorAll("tr.click"))
      tr.onclick = () =>
        (location.hash = `#/luck/${encodeURIComponent(tr.dataset.n && !tr.dataset.n.startsWith("0x") ? tr.dataset.n : tr.dataset.w)}`);
    const rf = $("#lbr");
    if (rf)
      rf.onclick = (e) => {
        e.preventDefault();
        draw(true);
      };
    if (busy) later(draw, 1500);
  };
  draw();
}

async function liveScreen() {
  main.innerHTML = `<p class="kicker">${t("live.kicker")}</p><div id="lv"></div>`;
  const draw = async () => {
    if (state.tab !== "live") return;
    const s = await api("/api/live").catch((e) => ({
      error: e.message,
      rows: [],
      paper: [],
    }));
    const sm = s.summary;
    const running = s.running;
    const last = s.rows?.at(-1);

    $("#lv").innerHTML =
      `<h1>${running ? t("live.h1.watching") : t("live.h1.isGap")}</h1>
      <p class="sub">${running ? esc(s.window?.title || "") : t("live.sub.intro")}</p>
      <div class="row" style="margin:16px 0">${running ? `<button class="btn ghost" id="stop">${t("live.stop")}</button><span class="small">${t("live.runsUntil", { time: new Date(s.endsAt).toLocaleTimeString("en-GB") })}${s.error ? ` · <span class="err">${esc(s.error)}</span>` : ""}</span>` : `<button class="btn" id="go">${t("live.start20")}</button><span class="small">${t("live.busiest")}</span>`}</div>
      ${s.rows?.length ? `<div class="hero" id="lchart"></div>` : ""}
      ${
        sm && sm.seconds
          ? `<div class="stats">
        ${stat(sm.seconds.toLocaleString("en-GB"), t("live.stat.seconds", { n: sm.windows, s: sm.windows === 1 ? "" : "s" }))}
        ${stat(pct(sm.bargainShare.any, 0), t("live.stat.bargain"))}
        ${stat(sm.pair.minAfterFees ? `$${sm.pair.minAfterFees.toFixed(3)}` : "–", t("live.stat.cheapPair"))}
        ${stat(sm.pair.underOneAfterFees, t("live.stat.pairUnder1"))}
        ${stat(sm.marketVolVsModel ? `${sm.marketVolVsModel.toFixed(2)}×` : "–", t("live.stat.volRatio"))}
        ${stat(
          sm.lag[0]?.corr !== null && sm.lag[0]
            ? sm.lag
                .slice(0, 3)
                .map((x) => (x.corr === null ? "–" : x.corr.toFixed(2)))
                .join(" / ")
            : "–",
          t("live.stat.lag"),
        )}
      </div>`
          : ""
      }
      ${
        s.paper?.length
          ? `<h2>${t("live.h2.paperTrades")}</h2><p class="small">${t("live.paper.summary", {
              settled: sm.paper.settled,
              won: sm.paper.won,
              pnl: signed(sm.paper.pnl),
              staked: usd(sm.paper.staked),
            })}</p>
        <div class="tablewrap"><table><tr><th>${t("live.th.time")}</th><th class="l">${t("live.th.market")}</th><th>${t("live.th.side")}</th><th>${t("live.th.paid")}</th><th>${t("live.th.fairPrice")}</th><th>${t("live.th.result")}</th><th>${t("wallet.th.pnl")}</th></tr>
        ${s.paper.map((p) => `<tr><td>${time(p.t)}</td><td class="l">${esc(p.slug.replace("btc-updown-15m-", "BTC 15-min, "))}</td><td>${p.side}</td><td>${cents(p.price)}</td><td>${cents(p.fair)}</td><td>${p.result || t("does.open")}${p.result && p.final === false ? "*" : ""}</td><td>${p.pnl === undefined ? "" : signed(p.pnl)}</td></tr>`).join("")}</table></div>`
          : ""
      }
      <p class="foot">${t("live.foot")}</p>`;

    if ($("#go"))
      $("#go").onclick = async () => {
        await api("/api/live/start", { minutes: 20 });
        later(draw, 1200);
      };
    if ($("#stop"))
      $("#stop").onclick = async () => {
        await api("/api/live/stop", {});
        draw();
      };
    if (s.rows?.length) {
      const rows = s.rows.filter((r) => r.Up.ask && r.Up.bid).slice(-300);
      let win = rows.filter((r) => r.start === last.start);
      if (win.length < 60) {
        const prev = rows.filter((r) => r.start < last.start);
        if (prev.length > win.length)
          win = prev.filter((r) => r.start === prev.at(-1).start);
      }
      lineChart($("#lchart"), {
        series: [
          {
            points: win.map((r) => [r.t * 1000, r.fairUp]),
            color: "#9A958C",
            width: 2,
          },
          {
            points: win.map((r) => [r.t * 1000, (r.Up.ask + r.Up.bid) / 2]),
            width: 2.6,
          },
        ],
        still: true,
        yMin: 0,
        yMax: 1,
        height: 300,
        fmt: (v) => `${Math.round(v * 100)}¢`,
        xFmt: (v) =>
          new Date(v).toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
        circles:
          win.length > 5
            ? [
                {
                  x: win.at(-1).t * 1000,
                  y: win.at(-1).fairUp,
                  r: 10,
                  label: t("live.simpleModel"),
                  dx: -14,
                  dy: -18,
                  anchor: "end",
                },
              ]
            : [],
      });
    }
    if (running) later(draw, 1000);
  };
  draw();
}

async function strategy() {
  main.innerHTML = `<p class="kicker">${t("strategy.kicker")}</p><div id="st"><p class="hand">${t("strategy.loading")}</p></div>`;
  const draw = async () => {
    if (state.tab !== "strategy") return;
    let s;
    try {
      s = await api("/api/strategy");
    } catch (e) {
      $("#st").innerHTML = `<p class="err">${esc(e.message)}</p>`;
      return;
    }
    const c = s.config,
      st = s.stats,
      scan = s.scan,
      br = s.broker;
    const signals = scan
      ? scan.ladders
          .flatMap((l) =>
            l.contracts.filter((x) => x.signal).map((x) => ({ l, x })),
          )
          .sort((a, z) => z.x.best.edge - a.x.best.edge)
      : [];
    const closeStr = (tSec) => formatCloseTime(tSec);

    $("#st").innerHTML =
      `<h1>${t("strategy.h1")}</h1>
      <p class="sub">${t("strategy.sub", {
        minutes: c.everyMinutes,
        edge: Math.round(100 * c.minEdge),
        lo: Math.round(100 * c.band[0]),
        hi: Math.round(100 * c.band[1]),
      })}</p>
      <div class="row" style="margin:18px 0">
        <span class="pill ${br.armed ? "blue" : ""}">${br.armed ? `${t("strategy.armed")} ${closeStr(br.armedUntil)}` : t("strategy.paper")}</span>
        <label class="toggle"><input type="checkbox" id="run" ${c.running ? "checked" : ""}/> ${t("strategy.scanEvery", { n: c.everyMinutes })}</label>
        <label class="toggle"><input type="checkbox" id="mk" ${c.markets.kalshi ? "checked" : ""}/> Kalshi</label>
        <label class="toggle"><input type="checkbox" id="mo" ${c.markets.options ? "checked" : ""}/> ${t("strategy.etfOptions")}</label>
        <span class="small">$${c.stake} ${t("strategy.aTrade")}</span>
        <span class="spacer"></span>
        <button class="btn" id="scan">${t("strategy.scanNow")}</button>
      </div>
      <div class="stats">
        ${stat(st.open, t("strategy.stat.open"))}
        ${stat(usd(st.atRisk), t("strategy.stat.atRisk"))}
        ${stat(st.closed, t("strategy.stat.settled"))}
        ${stat(st.closed ? `${st.won} / ${st.closed}` : "–", t("strategy.stat.won"))}
        ${stat(st.closed ? signed(st.pnl) : "–", t("strategy.stat.pnl"))}
        ${stat(st.closed ? signed(st.expectedPnl) : "–", t("strategy.stat.expected"))}
      </div>
      <h2>${t("strategy.h2.lastScan")} ${scan ? `<span class="small">${new Date(scan.at).toLocaleTimeString("en-GB")} · ${scan.ladders.length} ${t("strategy.markets")} · ${scan.ladders.reduce((n, l) => n + l.contracts.length, 0)} ${t("strategy.contracts")}</span>` : ""}</h2>
      ${
        scan
          ? `${scan.notes.map((n) => `<p class="small">${esc(n)}</p>`).join("")}
        ${signals.length ? `<p class="hand">${t("strategy.pricedTooLow", { n: signals.length, s: signals.length === 1 ? "" : "s" })}</p>` : `<p class="small">${t("strategy.nothingTooLow", { edge: Math.round(100 * c.minEdge) })}</p>`}
        ${
          signals.length
            ? `<div class="tablewrap"><table><tr><th class="l">${t("strategy.th.contract")}</th><th class="l">${t("strategy.th.where")}</th><th>${t("strategy.th.closes")}</th><th>${t("strategy.th.buy")}</th><th>${t("strategy.th.costs")}</th><th>${t("strategy.th.fairPrice")}</th><th>${t("strategy.th.edge")}</th></tr>${signals
                .slice(0, 12)
                .map(
                  ({ l, x }) =>
                    `<tr><td class="l">${esc(x.label)}</td><td class="l">${l.venue === "kalshi" ? "Kalshi" : t("strategy.etfOptions")}</td><td>${closeStr(l.closes)}</td><td>${x.best.side === "yes" ? t("strategy.yesAbove") : t("strategy.noBelow")}</td><td>${cents(x.best.cost)}</td><td>${cents(x.best.fair)}</td><td>${cents(x.best.edge)}</td></tr>`,
                )
                .join("")}</table></div>`
            : ""
        }
        <h2>${t("strategy.h2.marketsRead")}</h2><div class="tablewrap"><table><tr><th class="l">${t("strategy.th.market")}</th><th>${t("strategy.th.closes")}</th><th>${t("strategy.th.price")}</th><th>${t("strategy.th.contractN")}</th><th>${t("strategy.th.modelVol")}</th><th>${t("strategy.th.marketVol")}</th><th class="l">${t("strategy.th.status")}</th></tr>
        ${scan.ladders.map((l) => `<tr><td class="l">${l.venue === "kalshi" ? `Kalshi ${l.coin.toUpperCase()}` : `${esc(l.symbol)} options`}</td><td>${closeStr(l.closes)}</td><td>${l.venue === "kalshi" ? usd(l.S) : `$${l.S.toFixed(2)}`}</td><td>${l.contracts.length}</td><td>${pct(l.sigma, 0)}</td><td>${pct(l.marketVol, 0)}</td><td class="l">${l.volOk ? t("strategy.toBuy", { n: l.contracts.filter((x) => x.signal).length }) : `<span class="muted">${t("strategy.skipped", { reason: l.ratio ? t("strategy.modelVolRatio", { ratio: l.ratio.toFixed(2) }) : t("strategy.noMarketVol") })}</span>`}</td></tr>`).join("")}</table></div>`
          : `<p class="small">${t("strategy.firstScan")}</p>`
      }
      <h2>${t("strategy.h2.plugins")}</h2>
      ${scan?.custom?.length ? `<p class="small">${t("strategy.plugins.desc")}</p><div class="tablewrap"><table><tr><th class="l">${t("strategy.plugins.th.plugin")}</th><th class="l">${t("strategy.plugins.th.from")}</th><th class="l">${t("strategy.plugins.th.for")}</th><th class="l">${t("strategy.plugins.th.lastScan")}</th></tr>${scan.custom.map((m) => `<tr><td class="l">${esc(m.title)}</td><td class="l">${esc(m.from || "–")}</td><td class="l">${esc(m.target || "–")}</td><td class="l">${m.error ? `<span class="err">${esc(m.error)}</span>` : m.off ? t("strategy.plugins.off") : t("strategy.toBuy", { n: m.signals.length })}</td></tr>`).join("")}</table></div>` : `<p class="small">${t("strategy.plugins.none")}</p>`}
      ${s.open.length ? `<h2>${t("strategy.h2.openPos")}</h2><div class="tablewrap"><table><tr><th class="l">${t("strategy.th.contract")}</th><th>${t("strategy.th.side")}</th><th>${t("strategy.th.paid")}</th><th>${t("strategy.th.fairThen")}</th><th>${t("strategy.th.stake")}</th><th>${t("strategy.th.closes")}</th></tr>${s.open.map((p) => `<tr><td class="l">${esc(p.label)}</td><td>${p.side}</td><td>${cents(p.cost)}</td><td>${cents(p.fair)}</td><td>${usd(p.stake)}</td><td>${closeStr(p.closes)}</td></tr>`).join("")}</table></div>` : ""}
      ${s.closed.length ? `<h2>${t("strategy.h2.settled")}</h2><div class="tablewrap"><table><tr><th class="l">${t("strategy.th.contract")}</th><th>${t("strategy.th.side")}</th><th>${t("strategy.th.paid")}</th><th>${t("strategy.th.paidOut")}</th><th>${t("wallet.th.pnl")}</th></tr>${s.closed.map((p) => `<tr><td class="l">${esc(p.label)}</td><td>${p.side}</td><td>${cents(p.cost)}</td><td>${cents(p.paid)}</td><td>${signed(p.pnl)}</td></tr>`).join("")}</table></div>` : ""}
      <h2>${t("strategy.h2.broker")}</h2>
      <div class="card" style="max-width:820px">
        <p style="margin-top:0"><b>${esc(br.note)}</b></p>
        <p class="small">${t("strategy.broker.where")}</p>
        <p class="small">${t("strategy.broker.keys")}: ${br.keysFound ? t("strategy.broker.yes") : t("strategy.broker.no")} · ${t("strategy.broker.adapter")}: ${esc(br.adapter)}${br.stopped ? ` · <b>${t("strategy.broker.stopOn")}</b>` : ""}. ${t("strategy.broker.armNote")} <code>node scripts/arm.js</code>.</p>
        ${br.armed ? `<div class="row"><button class="btn ghost" id="disarm">${t("strategy.disarm")}</button><button class="btn" id="halt">${t("strategy.stopAll")}</button></div>` : ""}
      </div>
      <div class="doc-box" style="margin-top:28px;max-width:820px">
        <div class="row" style="margin-bottom:12px">
          <p class="hand" style="margin:0;font-size:20px">${t("strategy.viewDoc")}</p>
          <span class="spacer"></span>
          <button class="btn ghost" id="btn-doc">${lang() === "uz" ? "Sharhni ko‘rish" : "View write-up"}</button>
        </div>
        <div id="doc-content" style="display:none;margin-top:14px"></div>
      </div>
      <p class="foot">${t("strategy.foot", { comm: c.optionsCommission.toFixed(2) })}</p>`;

    const set = async (patch) => {
      await api("/api/strategy/config", patch);
      draw();
    };
    $("#run").onchange = (e) => set({ running: e.target.checked });
    $("#mk").onchange = (e) =>
      set({
        markets: { kalshi: e.target.checked, options: c.markets.options },
      });
    $("#mo").onchange = (e) =>
      set({ markets: { kalshi: c.markets.kalshi, options: e.target.checked } });
    $("#scan").onclick = async (e) => {
      e.target.disabled = true;
      e.target.textContent = t("strategy.scanning");
      await api("/api/strategy/scan", {}).catch((x) => alert(x.message));
      draw();
    };
    if ($("#disarm"))
      $("#disarm").onclick = async () => {
        await api("/api/broker/disarm", {});
        draw();
      };
    if ($("#halt"))
      $("#halt").onclick = async () => {
        await api("/api/broker/stop", {});
        draw();
      };

    const docBtn = $("#btn-doc");
    if (docBtn) {
      docBtn.onclick = async () => {
        const cEl = $("#doc-content");
        if (cEl.style.display !== "none") {
          cEl.style.display = "none";
          docBtn.textContent = lang() === "uz" ? "Sharhni ko‘rish" : "View write-up";
          return;
        }
        try {
          docBtn.disabled = true;
          const resp = await api(`/api/strategy-doc/coinman2-option-pricing?lang=${lang()}`);
          cEl.innerHTML = `<pre style="font-size:14px;background:#fffdf9;padding:16px;border-radius:8px;border:1px solid var(--line);">${esc(resp.content)}</pre>`;
          cEl.style.display = "block";
          docBtn.textContent = lang() === "uz" ? "Yopish" : "Close";
        } catch (e) {
          alert(e.message);
        } finally {
          docBtn.disabled = false;
        }
      };
    }

    later(draw, 30000);
  };
  draw();
}

async function claude() {
  const p =
    state.presets ||
    (state.presets = await api("/api/presets").catch(() => ({})));
  main.innerHTML = `<p class="kicker">${t("claude.kicker")}</p>
    <h1>${t("claude.h1")}</h1>
    <p class="sub">${t("claude.sub")}</p>
    <pre class="cmd" id="cmd">${esc(p.mcp || "node scripts/mcp.js --help")}</pre>
    <div class="row"><button class="btn ghost" id="copy">${t("claude.copy")}</button><span class="small" id="copied"></span></div>
    <h2>${t("claude.h2.askLike")}</h2>
    <ul class="hand" style="font-size:24px;line-height:1.5">
      <li>${t("claude.ex1")}</li>
      <li>${t("claude.ex2")}</li>
      <li>${t("claude.ex3")}</li>
      <li>${t("claude.ex4")}</li>
      <li>${t("claude.ex5")}</li>
      <li>${t("claude.ex6")}</li>
    </ul>
    <p class="foot">${t("claude.foot")}</p>`;

  $("#copy").onclick = async () => {
    try {
      await navigator.clipboard.writeText($("#cmd").textContent);
      $("#copied").textContent = t("claude.copied");
    } catch {
      $("#copied").textContent = t("claude.selectCopy");
    }
  };
}

// ---------- start ----------
(async () => {
  updateChromeLanguage();
  try {
    state.presets = await api("/api/presets");
    $("#chips").innerHTML = state.presets.wallets
      .map(
        (w) =>
          `<button class="chip" data-w="${esc(w.name)}">${esc(w.name)}</button>`,
      )
      .join("");
    for (const b of document.querySelectorAll(".chip"))
      b.onclick = () =>
        (location.hash = `#/${WALLET_TABS.includes(state.tab) ? state.tab : "wallet"}/${encodeURIComponent(b.dataset.w)}`);
  } catch {
    /* the chips are a shortcut only */
  }
  if (!location.hash && saved)
    location.hash = `#/wallet/${encodeURIComponent(saved)}`;
  window.addEventListener("hashchange", route);
  route();
})();
