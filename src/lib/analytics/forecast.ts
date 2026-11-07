/**
 * Sales forecasting.
 *
 * - Holt-Winters (additive seasonality, damped additive trend, weekly season on daily data) when there are
 *   at least 8 weeks of history with enough non-zero days to fit a pattern.
 * - Moving-average fallback otherwise, flagged `lowData` with wider bands.
 *
 * Bands are approximate 95% intervals: per-step variance grows as sigma² · (1 + (h-1)·alpha²), and horizon
 * totals assume independent step errors (they understate uncertainty a little — labelled as approximate in the UI).
 */

export const SEASON = 7;
export const MIN_HW_DAYS = 56; // 8 weeks
export const MIN_HW_NONZERO_DAYS = 10;
const Z95 = 1.96;

export type ForecastMethod = "holt_winters" | "moving_average";

export interface ForecastPoint {
  /** 1-based step ahead */
  h: number;
  value: number;
  low: number;
  high: number;
}

export interface Forecast {
  method: ForecastMethod;
  lowData: boolean;
  points: ForecastPoint[];
  sigma: number;
  params?: { alpha: number; beta: number; gamma: number; phi: number };
}

export interface HorizonTotal {
  value: number;
  low: number;
  high: number;
}

interface HWFit {
  sse: number;
  n: number;
  level: number;
  trend: number;
  seasonals: number[];
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

function fitHoltWinters(y: number[], m: number, alpha: number, beta: number, gamma: number, phi: number): HWFit {
  const first = y.slice(0, m);
  const second = y.slice(m, 2 * m);
  let level = mean(first);
  let trend = second.length === m ? (mean(second) - mean(first)) / m : 0;
  const seasonals = first.map((v) => v - level);

  let sse = 0;
  let n = 0;
  for (let t = 0; t < y.length; t++) {
    const s = seasonals[t % m];
    const pred = level + phi * trend + s;
    if (t >= m) {
      sse += (y[t] - pred) ** 2;
      n++;
    }
    const newLevel = alpha * (y[t] - s) + (1 - alpha) * (level + phi * trend);
    trend = beta * (newLevel - level) + (1 - beta) * phi * trend;
    seasonals[t % m] = gamma * (y[t] - newLevel) + (1 - gamma) * s;
    level = newLevel;
  }
  return { sse, n, level, trend, seasonals };
}

const ALPHAS = [0.05, 0.1, 0.2, 0.3, 0.5, 0.7];
const BETAS = [0, 0.02, 0.05, 0.1, 0.2];
const GAMMAS = [0.05, 0.1, 0.2, 0.3, 0.5];
const PHI = 0.9;

export function holtWinters(y: number[], horizon: number, m = SEASON): Forecast {
  let best: { fit: HWFit; alpha: number; beta: number; gamma: number } | null = null;
  for (const alpha of ALPHAS)
    for (const beta of BETAS)
      for (const gamma of GAMMAS) {
        const fit = fitHoltWinters(y, m, alpha, beta, gamma, PHI);
        if (!best || fit.sse < best.fit.sse) best = { fit, alpha, beta, gamma };
      }
  const { fit, alpha, beta, gamma } = best!;
  const sigma = Math.sqrt(fit.sse / Math.max(fit.n - 3, 1));

  const points: ForecastPoint[] = [];
  let phiSum = 0;
  for (let h = 1; h <= horizon; h++) {
    phiSum += PHI ** h;
    const s = fit.seasonals[(y.length + h - 1) % m];
    const value = Math.max(0, fit.level + phiSum * fit.trend + s);
    const band = Z95 * sigma * Math.sqrt(1 + (h - 1) * alpha * alpha);
    points.push({ h, value, low: Math.max(0, value - band), high: value + band });
  }
  return { method: "holt_winters", lowData: false, points, sigma, params: { alpha, beta, gamma, phi: PHI } };
}

export function movingAverage(y: number[], horizon: number, window = 28): Forecast {
  const recent = y.slice(-Math.min(window, y.length));
  const avg = mean(recent);
  // With very little history, fall back to a Poisson-ish spread so bands are never zero-width.
  const sigma = Math.max(std(recent), Math.sqrt(Math.max(avg, 0)), recent.length < 7 ? avg : 0);
  const widen = 1.5;
  const points: ForecastPoint[] = [];
  for (let h = 1; h <= horizon; h++) {
    const band = Z95 * sigma * widen * Math.sqrt(1 + 1 / Math.max(recent.length, 1));
    points.push({ h, value: avg, low: Math.max(0, avg - band), high: avg + band });
  }
  return { method: "moving_average", lowData: true, points, sigma };
}

/** True when the series has enough history for Holt-Winters. */
export function hasEnoughData(y: number[]): boolean {
  return y.length >= MIN_HW_DAYS && y.filter((v) => v > 0).length >= MIN_HW_NONZERO_DAYS;
}

/** Trim leading zeros (before the scope's first sale) so a new brand isn't modelled as months of zeros. */
export function trimLeadingZeros(y: number[]): number[] {
  const i = y.findIndex((v) => v !== 0);
  return i === -1 ? [] : y.slice(i);
}

export function forecastSeries(y: number[], horizon: number): Forecast {
  const series = trimLeadingZeros(y);
  if (series.length === 0) {
    return {
      method: "moving_average",
      lowData: true,
      sigma: 0,
      points: Array.from({ length: horizon }, (_, i) => ({ h: i + 1, value: 0, low: 0, high: 0 })),
    };
  }
  return hasEnoughData(series) ? holtWinters(series, horizon) : movingAverage(series, horizon);
}

/** Sum the first `days` steps into a horizon total with an approximate 95% band. */
export function horizonTotal(f: Forecast, days: number): HorizonTotal {
  const pts = f.points.slice(0, days);
  const value = pts.reduce((a, p) => a + p.value, 0);
  // Recover per-step half-widths and combine as independent errors.
  const variance = pts.reduce((a, p) => a + ((p.high - p.value) / Z95) ** 2, 0);
  const band = Z95 * Math.sqrt(variance);
  return { value, low: Math.max(0, value - band), high: value + band };
}

/** Zero-fill a sparse {date -> value} map into a contiguous daily array ending at `end` (inclusive). */
export function denseDaily(values: Map<string, number>, start: string, end: string): { dates: string[]; y: number[] } {
  const dates: string[] = [];
  const y: number[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (d <= last) {
    const key = d.toISOString().slice(0, 10);
    dates.push(key);
    y.push(values.get(key) ?? 0);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return { dates, y };
}

export interface MonthProjection {
  monthToDate: number;
  daysElapsed: number;
  daysInMonth: number;
  /** straight-line: MTD / elapsed × days in month */
  pace: number;
  /** MTD + forecast for the remaining days */
  forecast: number;
  forecastLow: number;
  forecastHigh: number;
}

export function projectMonth(mtd: number, daysElapsed: number, daysInMonth: number, f: Forecast | null): MonthProjection {
  const remaining = Math.max(daysInMonth - daysElapsed, 0);
  const pace = daysElapsed > 0 ? (mtd / daysElapsed) * daysInMonth : 0;
  const rest = f && remaining > 0 ? horizonTotal(f, remaining) : { value: 0, low: 0, high: 0 };
  return {
    monthToDate: mtd,
    daysElapsed,
    daysInMonth,
    pace,
    forecast: mtd + rest.value,
    forecastLow: mtd + rest.low,
    forecastHigh: mtd + rest.high,
  };
}
