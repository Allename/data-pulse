import React, { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  AreaChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";

function iso(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmt(n, digits = 1) {
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

const INK = "#ece7d8";
const MUTED = "#8f8a7c";
const ACCENT = "#ff5a1f";
const GRID = "#2c2a24";

function usePoll(url, ms, transform = (r) => r) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(url)
        .then((r) => r.json())
        .then((d) => alive && setData(transform(d)))
        .catch(() => {});
    load();
    if (ms) {
      const t = setInterval(load, ms);
      return () => {
        alive = false;
        clearInterval(t);
      };
    }
    return () => {
      alive = false;
    };
  }, [url]);
  return data;
}

function computeStats(days) {
  const now = new Date();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const prefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const today = days[iso()] || 0;
  let monthTotal = 0;
  for (let d = 1; d <= dayOfMonth; d++) monthTotal += days[`${prefix}-${String(d).padStart(2, "0")}`] || 0;
  const avg = dayOfMonth ? monthTotal / dayOfMonth : 0;
  const projection = avg * daysInMonth;

  return { today, monthTotal, avg, projection, dayOfMonth, daysInMonth, prefix };
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="tip">
      <div className="tip-label">{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="tip-row">
          <span>{p.name}</span>
          <b>{fmt(p.value, p.value < 10 ? 2 : 1)} GB</b>
        </div>
      ))}
    </div>
  );
}

function LiveStatus({ status, store }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  let cls = "idle";
  let text = "NOT CONFIGURED — run: node setup.mjs";
  if (status?.syncing) {
    cls = "busy";
    text = "SAMPLING ROUTER…";
  } else if (status?.error) {
    cls = "fault";
    text = `FAULT: ${status.error.toUpperCase()}`;
  } else if (store?.lastSync) {
    const mins = Math.max(0, Math.round((now - new Date(store.lastSync)) / 60000));
    cls = "live";
    text = mins === 0 ? "LIVE · SAMPLED JUST NOW" : `LIVE · LAST SAMPLE ${mins} MIN AGO`;
  }

  return (
    <div className={`status ${cls}`}>
      <span className="lamp" />
      {text}
    </div>
  );
}

function MonthGauge({ stats }) {
  const fill = (stats.dayOfMonth / stats.daysInMonth) * 100;
  return (
    <div className="gauge">
      <div className="gauge-head">
        <span>CYCLE PROGRESS</span>
        <span>
          DAY {stats.dayOfMonth}/{stats.daysInMonth}
        </span>
      </div>
      <div className="gauge-track">
        <div className="gauge-fill" style={{ width: `${fill}%` }}>
          {[25, 50, 75].map((p) => (
            <i key={p} className="tick" style={{ left: `${(p / fill) * 100}%` }} />
          ))}
        </div>
        {stats.projection > 0 && (
          <div
            className="gauge-marker"
            style={{ left: `${Math.min(fill * (stats.projection / Math.max(stats.monthTotal, stats.projection)), 100)}%` }}
            title={`Projected: ${fmt(stats.projection, 0)} GB`}
          />
        )}
      </div>
      <div className="gauge-foot">
        <span>METERED {fmt(stats.monthTotal)} GB</span>
        <span>PROJECTED {fmt(stats.projection, 0)} GB</span>
      </div>
    </div>
  );
}

export default function App() {
  const store = usePoll("/api/store", 20000) || { days: {}, lastSync: null };
  const status = usePoll("/api/status", 8000);
  const days = store.days || {};
  const stats = computeStats(days);

  const daily30 = useMemo(
    () =>
      Array.from({ length: 30 }, (_, i) => {
        const date = iso(-(29 - i));
        return {
          label: date.slice(5),
          gb: Math.round((days[date] || 0) * 100) / 100,
        };
      }),
    [days]
  );

  const monthCumulative = useMemo(() => {
    let run = 0;
    const arr = Array.from({ length: stats.daysInMonth }, (_, i) => {
      const key = `${stats.prefix}-${String(i + 1).padStart(2, "0")}`;
      if (days[key]) run += days[key];
      return {
        label: String(i + 1),
        metered: i < stats.dayOfMonth ? Math.round(run * 100) / 100 : null,
      };
    });
    return arr;
  }, [days]);

  const recent = Object.entries(days)
    .filter(([, gb]) => gb > 0)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 10);

  const delta = stats.today - stats.avg;

  return (
    <div className="sheet">
      <header className="masthead">
        <div className="wordmark">
          DATA<span>PULSE</span>
        </div>
        <LiveStatus status={status} store={store} />
      </header>

      <section className="hero">
        <div className="hero-main">
          <div className="hero-label">CONSUMED TODAY</div>
          <div className="hero-num">
            {fmt(stats.today, 2)}
            <small>GB</small>
          </div>
          {stats.avg > 0 && (
            <div className={`delta ${delta > 0 ? "over" : "under"}`}>
              {delta >= 0 ? "▲" : "▼"} {fmt(Math.abs(delta), 2)} GB VS DAILY PACE
            </div>
          )}
        </div>
        <MonthGauge stats={stats} />
      </section>

      <figure className="fig">
        <figcaption>
          FIG. 01 <em>DAILY CONSUMPTION · TRAILING 30 DAYS</em>
        </figcaption>
        <ResponsiveContainer width="100%" height={210}>
          <BarChart data={daily30} margin={{ top: 6, right: 4, left: -22, bottom: 0 }} barCategoryGap="18%">
            <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: MUTED, fontSize: 10, fontFamily: "IBM Plex Mono" }} tickLine={false} axisLine={{ stroke: INK }} interval={4} />
            <YAxis tick={{ fill: MUTED, fontSize: 10, fontFamily: "IBM Plex Mono" }} tickLine={false} axisLine={false} width={44} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(255,90,31,0.08)" }} />
            <ReferenceLine y={stats.avg} stroke={INK} strokeDasharray="6 3" strokeWidth={1} />
            <Bar name="USED" dataKey="gb" fill={ACCENT} isAnimationActive={false} maxBarSize={12} />
          </BarChart>
        </ResponsiveContainer>
        <div className="legend">
          <span className="key accent">DAILY TOTAL</span>
          <span className="key ink">— — PACE ({fmt(stats.avg, 1)} GB/DAY)</span>
        </div>
      </figure>

      <figure className="fig">
        <figcaption>
          FIG. 02 <em>BILLING CYCLE · CUMULATIVE METER</em>
        </figcaption>
        <ResponsiveContainer width="100%" height={210}>
          <AreaChart data={monthCumulative} margin={{ top: 6, right: 4, left: -22, bottom: 0 }}>
            <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: MUTED, fontSize: 10, fontFamily: "IBM Plex Mono" }} tickLine={false} axisLine={{ stroke: INK }} interval={2} />
            <YAxis tick={{ fill: MUTED, fontSize: 10, fontFamily: "IBM Plex Mono" }} tickLine={false} axisLine={false} width={44} />
            <Tooltip content={<ChartTooltip />} cursor={{ stroke: INK, strokeWidth: 1 }} />
            <Area
              name="METERED"
              type="stepAfter"
              dataKey="metered"
              stroke={ACCENT}
              strokeWidth={2}
              fill="rgba(232,73,15,0.08)"
              isAnimationActive={false}
              connectNulls
            />
          </AreaChart>
        </ResponsiveContainer>
        <div className="legend">
          <span className="key accent">CUMULATIVE METER · MONTH TO DATE</span>
          <span className="key ink">PROJECTED {fmt(stats.projection, 0)} GB BY DAY {stats.daysInMonth}</span>
        </div>
      </figure>

      <figure className="fig">
        <figcaption>
          LOG <em>RECENT DAYS</em>
        </figcaption>
        <div className="logbook">
          {recent.length === 0 ? (
            <div className="blank">
              AWAITING FIRST BASELINE SAMPLE.
              <br />
              USAGE APPEARS AFTER THE SECOND SYNC (~30 MIN).
            </div>
          ) : (
            recent.map(([date, gb], i) => (
              <div className="logline" key={date}>
                <span className="idx">{String(recent.length - i).padStart(2, "0")}</span>
                <span className="when">
                  {new Date(date + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).toUpperCase()}
                </span>
                <span className="lead" />
                <b>{fmt(gb, 2)} GB</b>
              </div>
            ))
          )}
        </div>
      </figure>

      <footer className="colophon">
        SAMPLED DIRECTLY FROM ROUTER WAN COUNTERS · HUAWEI HG8145X7 · ALL DATA STAYS ON THIS MACHINE
      </footer>
    </div>
  );
}
