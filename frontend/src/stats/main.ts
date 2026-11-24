import "./stats.css";

interface Sample { t: number; cpu: number | null; mem_used: number | null; tabs: number; running: number }
interface Stats {
  uptime: number;
  cpu: { percent: number | null; cores: number | null; load: number[] | null };
  memory: { used: number | null; total: number | null; server_rss: number | null };
  clients: { browsers: number; tabs: number; tabs_cte: number; tabs_iq2: number };
  simulations: { workers: number; running_programs: number; sandbox: string };
  totals: { connections: number; program_runs: number };
  history: Sample[];
}

const $ = (id: string) => document.getElementById(id)!;
const gb = (b: number | null | undefined) => (b == null ? "–" : `${(b / 1024 ** 3).toFixed(1)} GB`);
const pct = (v: number | null | undefined) => (v == null ? "–" : `${v.toFixed(0)}%`);
function dur(s: number): string {
  const d = Math.floor(s / 86400), h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60;
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
}

function tiles(s: Stats): void {
  const memPct = s.memory.used != null && s.memory.total ? (100 * s.memory.used) / s.memory.total : null;
  const t: [string, string, string][] = [
    ["Unique browsers", `${s.clients.browsers}`, "with the simulator open"],
    ["Open tabs", `${s.clients.tabs}`, `${s.clients.tabs_cte} CTE · ${s.clients.tabs_iq2} IQ2`],
    ["Running programs", `${s.simulations.running_programs}`, `${s.simulations.workers} simulations loaded`],
    ["CPU", pct(s.cpu.percent), s.cpu.load ? `load ${s.cpu.load.map((v) => v.toFixed(2)).join(" / ")} · ${s.cpu.cores ?? "?"} cores` : ""],
    ["Memory", pct(memPct), `${gb(s.memory.used)} of ${gb(s.memory.total)}`],
    ["Server process", gb(s.memory.server_rss), `sandbox: ${s.simulations.sandbox}`],
    ["Uptime", dur(s.uptime), "since the server started"],
    ["Since start", `${s.totals.program_runs}`, `program runs · ${s.totals.connections} connections`],
  ];
  $("tiles").innerHTML = t.map(([k, v, sub]) => `<div class="tile"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${sub}</div></div>`).join("");
}

/** One single-series line chart (own y-axis), with a crosshair + tooltip on hover. */
function lineChart(el: HTMLElement, title: string, now: string, pts: { t: number; v: number | null }[], yMax: number, fmt: (v: number) => string): void {
  const W = 520, H = 150, L = 34, R = 8, T = 8, B = 20;
  const data = pts.filter((p) => p.v != null) as { t: number; v: number }[];
  const t0 = data.length ? data[0].t : 0, t1 = data.length ? data[data.length - 1].t : 1;
  const x = (t: number) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R);
  const y = (v: number) => T + (1 - v / yMax) * (H - T - B);
  const ticks = [0, yMax / 2, yMax];
  const grid = ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="10" fill="var(--muted)">${fmt(v)}</text>`).join("");
  const path = data.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(Math.min(p.v, yMax)).toFixed(1)}`).join("");
  const span = t1 - t0;
  el.innerHTML = `<h3>${title}<span class="now">${now}</span></h3>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${title}: ${now}">
      ${grid}
      <line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" stroke="var(--axis)"/>
      <text x="${L}" y="${H - 4}" font-size="10" fill="var(--muted)">-${Math.round(span / 60) || "<1"} min</text>
      <text x="${W - R}" y="${H - 4}" font-size="10" fill="var(--muted)" text-anchor="end">now</text>
      <path d="${path}" fill="none" stroke="var(--series)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
      <line class="cross" y1="${T}" y2="${H - B}" stroke="var(--muted)" stroke-dasharray="3 3" visibility="hidden"/>
      <circle class="dot" r="4" fill="var(--series)" stroke="var(--surface)" stroke-width="2" visibility="hidden"/>
      <rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent"/>
    </svg>`;
  const svg = el.querySelector("svg")!;
  const cross = svg.querySelector<SVGLineElement>(".cross")!;
  const dot = svg.querySelector<SVGCircleElement>(".dot")!;
  let tip = el.querySelector<HTMLDivElement>(".tip");
  if (!tip) { tip = document.createElement("div"); tip.className = "tip"; tip.hidden = true; el.appendChild(tip); }
  svg.onpointermove = (e) => {
    if (!data.length) return;
    const r = svg.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * W;
    let best = data[0];
    for (const p of data) if (Math.abs(x(p.t) - sx) < Math.abs(x(best.t) - sx)) best = p;
    const bx = x(best.t), by = y(Math.min(best.v, yMax));
    cross.setAttribute("x1", `${bx}`); cross.setAttribute("x2", `${bx}`); cross.setAttribute("visibility", "visible");
    dot.setAttribute("cx", `${bx}`); dot.setAttribute("cy", `${by}`); dot.setAttribute("visibility", "visible");
    const ago = Math.round(t1 - best.t);
    tip!.hidden = false;
    tip!.textContent = `${fmt(best.v)} · ${ago ? `${ago}s ago` : "now"}`;
    const box = el.getBoundingClientRect();
    tip!.style.left = `${(bx / W) * r.width + r.left - box.left}px`;
    tip!.style.top = `${(by / H) * r.height + r.top - box.top}px`;
  };
  svg.onpointerleave = () => { cross.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); tip!.hidden = true; };
}

function charts(s: Stats): void {
  const h = s.history;
  const memTotal = s.memory.total ?? 1;
  const niceMax = (vals: number[]) => Math.max(4, Math.ceil((Math.max(0, ...vals) * 1.25) / 2) * 2);
  lineChart($("c-cpu"), "CPU", pct(s.cpu.percent), h.map((p) => ({ t: p.t, v: p.cpu })), 100, (v) => `${v.toFixed(0)}%`);
  lineChart($("c-mem"), "Memory used", `${gb(s.memory.used)} of ${gb(s.memory.total)}`,
    h.map((p) => ({ t: p.t, v: p.mem_used == null ? null : (100 * p.mem_used) / memTotal })), 100, (v) => `${v.toFixed(0)}%`);
  lineChart($("c-tabs"), "Open tabs", `${s.clients.tabs}`, h.map((p) => ({ t: p.t, v: p.tabs })), niceMax(h.map((p) => p.tabs)), (v) => v.toFixed(0));
  lineChart($("c-run"), "Running programs", `${s.simulations.running_programs}`, h.map((p) => ({ t: p.t, v: p.running })), niceMax(h.map((p) => p.running)), (v) => v.toFixed(0));
}

async function poll(): Promise<void> {
  const live = $("live");
  try {
    const r = await fetch("../api/stats", { cache: "no-store" });
    if (!r.ok) throw new Error(String(r.status));
    const s = (await r.json()) as Stats;
    tiles(s);
    charts(s);
    live.textContent = "live";
    live.className = "st-live ok";
  } catch {
    live.textContent = "server unreachable";
    live.className = "st-live";
  }
}

void poll();
setInterval(() => { if (!document.hidden) void poll(); }, 2000);
