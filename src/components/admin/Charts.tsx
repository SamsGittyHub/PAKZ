"use client";
/**
 * Chart wrappers (Recharts). Values are formatted by kind; functions can't cross the server boundary.
 * Mark specs: 2px lines, recessive grid, single y-axis, crosshair tooltip, legend when ≥ 2 series.
 */
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import { fmt } from "@/lib/format";

export type ValueKind = "money" | "num" | "pct";
export interface SeriesSpec { key: string; label: string; slot?: number; dashed?: boolean }

const color = (slot = 1) => `var(--series-${slot})`;
const formatter = (kind: ValueKind) => (v: number) =>
  kind === "money" ? fmt.money(v) : kind === "pct" ? fmt.pct(v) : fmt.num(Math.round(v * 10) / 10);
const axisFmt = (kind: ValueKind) => (v: number) =>
  kind === "money" ? fmt.money(v).replace(/\.00$/, "") : kind === "pct" ? fmt.pct(v, 0) : fmt.compact(v);
const xFmt = (v: string) => (/^\d{4}-\d{2}-\d{2}/.test(v) ? fmt.shortDate(v) : v);

const axisProps = { stroke: "var(--axis)", tick: { fill: "var(--ink-3)", fontSize: 11 }, tickLine: false } as const;
const tooltipStyle = {
  contentStyle: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--ink)" },
  labelStyle: { color: "var(--ink-2)" },
  cursor: { stroke: "var(--axis)" },
};

export function TimeSeriesChart({ data, x = "bucket", series, kind = "money", height = 240, area = false }: {
  data: object[]; x?: string; series: SeriesSpec[]; kind?: ValueKind; height?: number; area?: boolean;
}) {
  const Chart = area ? AreaChart : LineChart;
  return (
    <div style={{ height }} role="img" aria-label={`Chart of ${series.map((s) => s.label).join(", ")}`}>
      <ResponsiveContainer width="100%" height="100%">
        <Chart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis dataKey={x} {...axisProps} tickFormatter={xFmt} minTickGap={24} />
          <YAxis {...axisProps} axisLine={false} width={56} tickFormatter={axisFmt(kind)} />
          <Tooltip {...tooltipStyle} formatter={(v) => formatter(kind)(Number(v))} labelFormatter={(l) => xFmt(String(l))} />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12, color: "var(--ink-2)" }} iconType="plainline" />}
          {series.map((s, i) =>
            area ? (
              <Area isAnimationActive={false} key={s.key} type="linear" dataKey={s.key} name={s.label} stroke={color(s.slot ?? i + 1)} fill={color(s.slot ?? i + 1)}
                fillOpacity={0.12} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }} />
            ) : (
              <Line isAnimationActive={false} key={s.key} type="linear" dataKey={s.key} name={s.label} stroke={color(s.slot ?? i + 1)} strokeWidth={2}
                strokeDasharray={s.dashed ? "4 3" : undefined} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }} />
            ),
          )}
        </Chart>
      </ResponsiveContainer>
    </div>
  );
}

export function BarsChart({ data, x, series, kind = "money", height = 240, stacked = false }: {
  data: object[]; x: string; series: SeriesSpec[]; kind?: ValueKind; height?: number; stacked?: boolean;
}) {
  return (
    <div style={{ height }} role="img" aria-label={`Bar chart of ${series.map((s) => s.label).join(", ")}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis dataKey={x} {...axisProps} tickFormatter={xFmt} minTickGap={12} />
          <YAxis {...axisProps} axisLine={false} width={56} tickFormatter={axisFmt(kind)} />
          <Tooltip {...tooltipStyle} cursor={{ fill: "var(--surface-2)" }} formatter={(v) => formatter(kind)(Number(v))} />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {series.map((s, i) => (
            <Bar isAnimationActive={false} key={s.key} dataKey={s.key} name={s.label} fill={color(s.slot ?? i + 1)} radius={stacked ? 0 : [4, 4, 0, 0]}
              stackId={stacked ? "a" : undefined} maxBarSize={36} stroke="var(--surface)" strokeWidth={stacked ? 2 : 0} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** History (solid) + forecast (dashed) with a shaded 95% band. */
export function ForecastChart({ data, kind = "money", height = 260 }: {
  data: { date: string; actual?: number | null; forecast?: number | null; low?: number | null; high?: number | null }[];
  kind?: ValueKind; height?: number;
}) {
  const rows = data.map((d) => ({ ...d, band: d.low != null && d.high != null ? [d.low, d.high] : null }));
  return (
    <div style={{ height }} role="img" aria-label="Actual sales and forecast with confidence band">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis dataKey="date" {...axisProps} tickFormatter={xFmt} minTickGap={28} />
          <YAxis {...axisProps} axisLine={false} width={56} tickFormatter={axisFmt(kind)} />
          <Tooltip {...tooltipStyle}
            formatter={(v) => Array.isArray(v) ? `${formatter(kind)(Number(v[0]))} – ${formatter(kind)(Number(v[1]))}` : formatter(kind)(Number(v))}
            labelFormatter={(l) => xFmt(String(l))} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Area type="linear" dataKey="band" name="95% band" stroke="none" fill="var(--series-1)" fillOpacity={0.14} isAnimationActive={false} />
          <Line isAnimationActive={false} type="linear" dataKey="actual" name="Actual" stroke="var(--ink-2)" strokeWidth={2} dot={false} connectNulls={false} />
          <Line isAnimationActive={false} type="linear" dataKey="forecast" name="Forecast" stroke="var(--series-1)" strokeWidth={2} strokeDasharray="5 3" dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
