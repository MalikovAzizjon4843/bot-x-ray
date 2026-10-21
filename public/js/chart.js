// SVG charts in the graph-paper look: ink lines, small grey labels, and blue hand-drawn marks (circles, ticks,
// arrows and notes) on the moments that tell the story. Same helpers as the poly-lag-replay animation.
const NS = "http://www.w3.org/2000/svg";
export const INK = "#141412",
  GREY = "#9A958C",
  BLUE = "#1C6DF2";

const el = (tag, attrs = {}, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs))
    if (v !== undefined && v !== null) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
};

// A wobbly pen loop that overshoots its start.
export function handCircle(cx, cy, rx, ry, seed = 1) {
  const pts = [];
  for (let i = 0; i < 90; i++) {
    const a = -0.6 + (i / 89) * Math.PI * 2.15;
    const k =
      1 +
      0.05 * Math.sin(3 * a + seed) +
      0.03 * Math.sin(5 * a + 2 * seed) +
      0.04 * (i / 89);
    pts.push([cx + rx * k * Math.cos(a), cy + ry * k * Math.sin(a)]);
  }
  return pts;
}
// A hand-drawn line from a through control c to b.
export function handCurve(a, c, b, seed = 1) {
  const pts = [];
  for (let i = 0; i < 40; i++) {
    const t = i / 39,
      u = 1 - t,
      w = 1.6 * Math.sin(t * Math.PI * 3 + seed);
    pts.push([
      u * u * a[0] + 2 * u * t * c[0] + t * t * b[0] + w * 0.4,
      u * u * a[1] + 2 * u * t * c[1] + t * t * b[1] + w,
    ]);
  }
  return pts;
}
const d = (pts) =>
  pts
    .map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`)
    .join("");

// Draw-on like a pen: the dash-offset trick.
let still = false; // live charts redraw every second, so their marks appear without animating
function penIn(path, delay = 0) {
  if (still) return;
  const L = path.getTotalLength?.() || 600;
  path.style.strokeDasharray = `${L}`;
  path.style.strokeDashoffset = `${L}`;
  path.style.transition = `stroke-dashoffset 900ms cubic-bezier(.2,.7,.2,1) ${delay}ms`;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => (path.style.strokeDashoffset = "0")),
  );
}
export function stroke(
  svg,
  pts,
  { color = BLUE, width = 2.6, delay = 0, arrow = false } = {},
) {
  const p = el(
    "path",
    {
      d: d(pts),
      fill: "none",
      stroke: color,
      "stroke-width": width,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    },
    svg,
  );
  if (arrow) {
    const [e, q] = [pts.at(-1), pts.at(-4)];
    const ang = Math.atan2(e[1] - q[1], e[0] - q[0]);
    const h = (s) => [
      e[0] - 11 * Math.cos(ang + s),
      e[1] - 11 * Math.sin(ang + s),
    ];
    el(
      "path",
      {
        d: d([h(0.5), e, h(-0.5)]),
        fill: "none",
        stroke: color,
        "stroke-width": width,
        "stroke-linecap": "round",
      },
      svg,
    );
  }
  penIn(p, delay);
  return p;
}
export function note(
  svg,
  x,
  y,
  text,
  { anchor = "start", size = 22, delay = 0, color = BLUE } = {},
) {
  const t = el(
    "text",
    {
      x,
      y,
      "text-anchor": anchor,
      fill: color,
      "font-family": "Caveat, cursive",
      "font-size": size,
    },
    svg,
  );
  t.textContent = text;
  if (still) return t;
  t.style.opacity = "0";
  t.style.transition = `opacity 500ms ease ${delay + 500}ms`;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => (t.style.opacity = "1")),
  );
  return t;
}
const label = (svg, x, y, text, anchor = "end", color = GREY, size = 12) => {
  const t = el(
    "text",
    {
      x,
      y,
      "text-anchor": anchor,
      fill: color,
      "font-size": size,
      "font-family": "Archivo, sans-serif",
    },
    svg,
  );
  t.textContent = text;
  return t;
};

function niceTicks(lo, hi, n = 4) {
  const span = hi - lo || Math.abs(hi) || 1;
  const step0 = span / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || mag * 10;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step)
    out.push(Math.round(v / step) * step);
  return out;
}

// A time series. series: [{ points: [[x(Date ms), y]], color, width }]. marks: [{ x, label }] vertical hand ticks.
// circles: [{ x, y, label, dx, dy }]. fmt: y-axis label formatter.
export function lineChart(
  host,
  {
    series,
    width = 1100,
    height = 380,
    fmt = (v) => v,
    marks = [],
    circles = [],
    zero = false,
    yMin,
    yMax,
    xFmt,
    still: noAnim = false,
  } = {},
) {
  still = noAnim;
  host.innerHTML = "";
  const svg = el(
    "svg",
    { viewBox: `0 0 ${width} ${height}`, role: "img" },
    host,
  );
  const pad = { l: 70, r: 24, t: 34, b: 30 };
  const all = series.flatMap((s) => s.points);
  if (!all.length) return svg;
  const xs = all.map((p) => p[0]),
    ys = all.map((p) => p[1]);
  const x0 = Math.min(...xs),
    x1 = Math.max(...xs);
  let y0 = yMin ?? Math.min(...ys, zero ? 0 : Infinity),
    y1 = yMax ?? Math.max(...ys, zero ? 0 : -Infinity);
  if (y0 === y1) {
    y0 -= 1;
    y1 += 1;
  }
  const padY = (y1 - y0) * 0.06;
  if (yMin === undefined) y0 -= padY;
  if (yMax === undefined) y1 += padY;
  const X = (v) =>
    pad.l + ((v - x0) / (x1 - x0 || 1)) * (width - pad.l - pad.r);
  const Y = (v) =>
    pad.t + (1 - (v - y0) / (y1 - y0)) * (height - pad.t - pad.b);
  for (const t of niceTicks(y0, y1)) {
    el(
      "line",
      {
        x1: pad.l,
        x2: width - pad.r,
        y1: Y(t),
        y2: Y(t),
        stroke: t === 0 ? GREY : "rgba(20,20,18,0.08)",
        "stroke-width": t === 0 ? 1.2 : 1,
      },
      svg,
    );
    label(svg, pad.l - 10, Y(t) + 4, fmt(t));
  }
  // x labels: first, middle, last
  const xf =
    xFmt ||
    ((v) =>
      new Date(v).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "2-digit",
      }));
  for (const v of [x0, (x0 + x1) / 2, x1])
    label(
      svg,
      X(v),
      height - 8,
      xf(v),
      v === x0 ? "start" : v === x1 ? "end" : "middle",
    );
  for (const s of series) {
    el(
      "path",
      {
        d: d(s.points.map(([x, y]) => [X(x), Y(y)])),
        fill: "none",
        stroke: s.color || INK,
        "stroke-width": s.width || 2.4,
        "stroke-linejoin": "round",
        "stroke-linecap": "round",
        opacity: s.opacity ?? 1,
      },
      svg,
    );
  }
  marks.forEach((m, i) => {
    if (m.x < x0 || m.x > x1) return;
    const x = X(m.x);
    stroke(
      svg,
      handCurve(
        [x, pad.t + 4],
        [x + 2, (pad.t + height - pad.b) / 2],
        [x - 1, height - pad.b],
        i + 1,
      ),
      { width: 1.8, delay: 200 + i * 250 },
    );
    // Write the note where the line isn't: near the bottom if the line is high at this date, else near the top.
    const near = series[0].points.reduce(
      (a, p) => (Math.abs(p[0] - m.x) < Math.abs(a[0] - m.x) ? p : a),
      series[0].points[0],
    );
    const lineHigh = Y(near[1]) < (pad.t + height - pad.b) / 2;
    const ny = lineHigh
      ? height - pad.b - 12 - (i % 2) * 22
      : pad.t + 14 + (i % 2) * 22;
    note(svg, x + 6, ny, m.label, { delay: 200 + i * 250, size: 21 });
  });
  circles.forEach((c, i) => {
    const cx = X(c.x),
      cy = Y(c.y);
    stroke(svg, handCircle(cx, cy, c.r || 16, c.r || 16, 1.7 + i), {
      delay: 600 + i * 300,
    });
    if (c.label)
      note(svg, cx + (c.dx ?? 22), cy + (c.dy ?? -20), c.label, {
        anchor: c.anchor || "start",
        delay: 600 + i * 300,
      });
  });
  return { svg, X, Y };
}

// Vertical bars around a zero line: [{ x(label), y }]. Positive bars ink, negative grey.
export function bars(
  host,
  {
    data,
    width = 1100,
    height = 260,
    fmt = (v) => v,
    highlight = [],
    xFmt = (v) => v,
  } = {},
) {
  host.innerHTML = "";
  still = false;
  const svg = el(
    "svg",
    { viewBox: `0 0 ${width} ${height}`, role: "img" },
    host,
  );
  const pad = { l: 70, r: 20, t: 26, b: 26 };
  if (!data.length) return svg;
  const ys = data.map((p) => p.y);
  let y0 = Math.min(0, ...ys),
    y1 = Math.max(0, ...ys);
  if (y0 === y1) y1 = 1;
  const Y = (v) =>
    pad.t + (1 - (v - y0) / (y1 - y0)) * (height - pad.t - pad.b);
  const bw = (width - pad.l - pad.r) / data.length;
  for (const t of niceTicks(y0, y1, 3)) {
    el(
      "line",
      {
        x1: pad.l,
        x2: width - pad.r,
        y1: Y(t),
        y2: Y(t),
        stroke: t === 0 ? GREY : "rgba(20,20,18,0.08)",
      },
      svg,
    );
    label(svg, pad.l - 10, Y(t) + 4, fmt(t));
  }
  data.forEach((p, i) => {
    const x = pad.l + i * bw;
    el(
      "rect",
      {
        x: x + bw * 0.12,
        width: Math.max(bw * 0.76, 0.8),
        y: Math.min(Y(p.y), Y(0)),
        height: Math.max(Math.abs(Y(p.y) - Y(0)), 0.8),
        fill: p.y >= 0 ? INK : GREY,
      },
      svg,
    );
  });
  label(svg, pad.l, height - 6, xFmt(data[0].x), "start");
  label(svg, width - pad.r, height - 6, xFmt(data.at(-1).x), "end");
  highlight.forEach((h, i) => {
    const idx = data.findIndex((p) => p.x === h.x);
    if (idx < 0) return;
    const cx = pad.l + (idx + 0.5) * bw,
      cy = Y(data[idx].y);
    const right = idx > data.length * 0.75;
    stroke(svg, handCircle(cx, cy, 16, 16, 2 + i), { delay: 500 + i * 300 });
    note(svg, cx + (right ? -22 : h.dx ?? 22), cy + (h.dy ?? 4), h.label, { anchor: right ? "end" : h.anchor || "start", delay: 500 + i * 300 });
  });
  return svg;
}

// Horizontal bars with labels: [{ label, value, sub }], a reference line (e.g. 50%) and optional circle on one row.
export function hbars(
  host,
  {
    data,
    width = 640,
    row = 44,
    max,
    fmt = (v) => v,
    ref,
    refLabel,
    circle,
  } = {},
) {
  host.innerHTML = "";
  still = false;
  const height = data.length * row + 30;
  const svg = el(
    "svg",
    { viewBox: `0 0 ${width} ${height}`, role: "img" },
    host,
  );
  const L = 190,
    R = circle ? 200 : 70;
  const M =
    max ?? Math.max(...data.map((x) => Math.abs(x.value)), ref ?? 0) * 1.05;
  const X = (v) => L + (Math.max(v, 0) / M) * (width - L - R);
  data.forEach((x, i) => {
    const y = 10 + i * row;
    label(svg, L - 12, y + row / 2 - 2, x.label, "end", INK, 13.5);
    if (x.sub) label(svg, L - 12, y + row / 2 + 13, x.sub, "end", GREY, 11);
    el(
      "rect",
      {
        x: L,
        y: y + row * 0.25,
        width: Math.max(X(x.value) - L, 1),
        height: row * 0.42,
        fill: x.grey ? GREY : INK,
        rx: 2,
      },
      svg,
    );
    label(svg, X(x.value) + 8, y + row / 2 + 4, fmt(x.value), "start", INK, 13);
  });
  if (ref !== undefined) {
    const x = X(ref);
    el(
      "line",
      {
        x1: x,
        x2: x,
        y1: 4,
        y2: height - 22,
        stroke: GREY,
        "stroke-dasharray": "4 4",
      },
      svg,
    );
    if (refLabel) label(svg, x, height - 6, refLabel, "middle", GREY, 11.5);
  }
  if (circle) {
    const i = data.findIndex((x) => x.label === circle.label);
    if (i >= 0) {
      const y = 10 + i * row + row / 2;
      const cx = X(data[i].value) + 26;
      stroke(svg, handCircle(cx, y, 34, 17, 3), { delay: 500 });
      if (circle.note) note(svg, cx + 40, y + 6, circle.note, { delay: 500 });
    }
  }
  return svg;
}

// A tiny trend line for tables.
export function spark(values, { w = 90, h = 24 } = {}) {
  const v = values.filter((x) => Number.isFinite(x));
  if (v.length < 2) return "";
  const lo = Math.min(...v, 0),
    hi = Math.max(...v);
  const pts = v.map((y, i) => [
    2 + (i / (v.length - 1)) * (w - 4),
    h - 2 - ((y - lo) / (hi - lo || 1)) * (h - 4),
  ]);
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path d="${d(pts)}" fill="none" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
}
