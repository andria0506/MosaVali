/**
 * Live market data from Yahoo Finance (through the dev/preview relay /api/yahoo, see vite.config.ts):
 * current price plus 5 years of weekly closes, from which the worst 12-month fall and the
 * 1-year change are computed. Cached for 15 minutes (also across reloads).
 */
export interface MarketData {
  ticker: string;
  price: number; // in `currency`
  currency: string;
  asOf: string; // ISO time of the last trade
  /** Weekly closes, oldest first. */
  history: { date: string; close: number }[];
  /** Largest peak-to-trough fall within any 12-month window of the history, %. */
  worstDrawdownPct: number;
  /** Change over the last 12 months, %. */
  change1yPct: number;
}

const CACHE_MS = 15 * 60 * 1000;
const STORAGE_KEY = 'danazogi.market-cache.v1';
const WEEKS_PER_YEAR = 52;

type Entry = { value: MarketData; at: number };
const cache = new Map<string, Entry>(Object.entries(loadCache()));
const inFlight = new Map<string, Promise<MarketData>>();

export function fetchMarket(ticker: string): Promise<MarketData> {
  const hit = cache.get(ticker);
  if (hit && Date.now() - hit.at < CACHE_MS) return Promise.resolve(hit.value);
  let pending = inFlight.get(ticker);
  if (!pending) {
    pending = load(ticker).finally(() => inFlight.delete(ticker));
    inFlight.set(ticker, pending);
  }
  return pending;
}

/** Cached market data without fetching (undefined if not loaded yet). */
export function peekMarket(ticker: string): MarketData | undefined {
  return cache.get(ticker)?.value;
}

/** Last weekly close on or before a date (for valuing a holding as of a past snapshot). */
export function closeOn(data: MarketData, isoDate: string): number {
  const day = isoDate.slice(0, 10);
  let close = data.history[0]?.close ?? data.price;
  for (const p of data.history) {
    if (p.date > day) break;
    close = p.close;
  }
  return close;
}

interface ChartResponse {
  chart: {
    result?: {
      meta: { regularMarketPrice: number; currency: string; regularMarketTime: number };
      timestamp?: number[];
      indicators: { quote: { close: (number | null)[] }[] };
    }[];
    error?: { description: string } | null;
  };
}

async function load(ticker: string): Promise<MarketData> {
  const params = new URLSearchParams({ range: '5y', interval: '1wk' });
  const res = await fetch(`/api/yahoo/v8/finance/chart/${encodeURIComponent(ticker)}?${params}`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok || !res.headers.get('content-type')?.includes('json')) throw new Error(`Yahoo chart ${res.status}`);
  const body = (await res.json()) as ChartResponse;
  const r = body.chart.result?.[0];
  if (!r || !(r.meta.regularMarketPrice > 0)) throw new Error(body.chart.error?.description ?? 'no price');

  const closes = r.indicators.quote[0]?.close ?? [];
  const history = (r.timestamp ?? [])
    .map((t, i) => ({ date: new Date(t * 1000).toISOString().slice(0, 10), close: closes[i] }))
    .filter((p): p is { date: string; close: number } => typeof p.close === 'number' && p.close > 0);

  const value: MarketData = {
    ticker,
    price: r.meta.regularMarketPrice,
    currency: r.meta.currency,
    asOf: new Date(r.meta.regularMarketTime * 1000).toISOString(),
    history,
    worstDrawdownPct: Math.round(worstDrawdown(history.map((p) => p.close)) * 100),
    change1yPct: change1y(history.map((p) => p.close), r.meta.regularMarketPrice),
  };
  cache.set(ticker, { value, at: Date.now() });
  saveCache();
  return value;
}

/** Largest fall from a peak within the previous 52 weeks, over the whole series (0–1). */
function worstDrawdown(closes: number[]): number {
  let worst = 0;
  for (let i = 0; i < closes.length; i++) {
    let peak = 0;
    for (let k = Math.max(0, i - WEEKS_PER_YEAR); k <= i; k++) peak = Math.max(peak, closes[k]);
    if (peak > 0) worst = Math.max(worst, 1 - closes[i] / peak);
  }
  return worst;
}

function change1y(closes: number[], price: number): number {
  const yearAgo = closes[Math.max(0, closes.length - 1 - WEEKS_PER_YEAR)];
  return yearAgo ? Math.round((price / yearAgo - 1) * 1000) / 10 : 0;
}

function loadCache(): Record<string, Entry> {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function saveCache() {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(cache)));
  } catch {
    // storage full or unavailable: memory cache still works
  }
}
