/**
 * Official USD→GEL rate from the National Bank of Georgia (public API, CORS-enabled).
 * Cached for 30 minutes; falls back to an estimate if NBG can't be reached.
 */
import type { ExchangeRate } from '../types';

const NBG_URL = 'https://nbg.gov.ge/gw/api/ct/monetarypolicy/currencies/en/json/?currencies=USD';
const CACHE_MS = 30 * 60 * 1000;
const TIMEOUT_MS = 5000;

let cached: { value: ExchangeRate; at: number } | undefined;
let inFlight: Promise<ExchangeRate> | undefined;

interface NbgResponse {
  date: string;
  currencies: { code: string; quantity: number; rate: number; validFromDate: string }[];
}

export function fetchUsdGelRate(fallbackRate: number): Promise<ExchangeRate> {
  if (cached && Date.now() - cached.at < CACHE_MS) return Promise.resolve(cached.value);
  inFlight ??= load(fallbackRate).finally(() => (inFlight = undefined));
  return inFlight;
}

async function load(fallbackRate: number): Promise<ExchangeRate> {
  try {
    const res = await fetch(NBG_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`NBG ${res.status}`);
    const [day] = (await res.json()) as NbgResponse[];
    const usd = day?.currencies.find((c) => c.code === 'USD');
    if (!usd || !(usd.rate > 0)) throw new Error('NBG: no USD rate');
    const value: ExchangeRate = {
      base: 'USD',
      quote: 'GEL',
      rate: usd.rate / (usd.quantity || 1),
      validFrom: usd.validFromDate ?? day.date,
      source: 'NBG',
    };
    cached = { value, at: Date.now() };
    return value;
  } catch {
    // Don't cache the fallback, so the next call retries NBG.
    return { base: 'USD', quote: 'GEL', rate: fallbackRate, validFrom: new Date().toISOString(), source: 'fallback' };
  }
}

// ---------- Monthly history (for converting past USD returns into lari) ----------

const MONTHLY_KEY = 'danazogi.nbg-monthly.v1';
const MONTHLY_BATCH = 6;

/**
 * Official USD→GEL rate on the 1st of each of the last `months` months (oldest first).
 * Past rates never change, so they're cached in localStorage permanently.
 */
export async function fetchUsdGelMonthly(months: number): Promise<{ month: string; rate: number }[]> {
  const stored = loadMonthly();
  const now = new Date();
  const wanted = Array.from({ length: months }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (months - 1 - i), 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const missing = wanted.filter((m) => !(stored[m] > 0));
  for (let i = 0; i < missing.length; i += MONTHLY_BATCH) {
    await Promise.all(
      missing.slice(i, i + MONTHLY_BATCH).map(async (month) => {
        const res = await fetch(`${NBG_URL}&date=${month}-01`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!res.ok) throw new Error(`NBG ${res.status}`);
        const [day] = (await res.json()) as NbgResponse[];
        const usd = day?.currencies.find((c) => c.code === 'USD');
        if (!usd || !(usd.rate > 0)) throw new Error(`NBG: no USD rate for ${month}`);
        stored[month] = usd.rate / (usd.quantity || 1);
      }),
    );
  }
  saveMonthly(stored);
  return wanted.map((month) => ({ month, rate: stored[month] }));
}

function loadMonthly(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(MONTHLY_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function saveMonthly(v: Record<string, number>) {
  try {
    localStorage.setItem(MONTHLY_KEY, JSON.stringify(v));
  } catch {
    // ignore
  }
}

// ---------- NBG monetary policy rate ----------

const POLICY_URL = 'https://nbg.gov.ge/gw/api/ct/monetarypolicy/rates?take=100'; // API maximum; ~12 years of decisions;
const POLICY_KEY = 'danazogi.nbg-policy.v1';
const POLICY_CACHE_MS = 12 * 60 * 60 * 1000;

export interface PolicyRateDecision {
  date: string; // ISO date the decision took effect
  rate: number; // % a year
}

/** All NBG policy-rate decisions, newest first. Cached 12 hours (decisions are rare). */
export async function fetchPolicyRates(): Promise<PolicyRateDecision[]> {
  try {
    const saved = JSON.parse(localStorage.getItem(POLICY_KEY) ?? 'null') as { at: number; value: PolicyRateDecision[] } | null;
    if (saved && Date.now() - saved.at < POLICY_CACHE_MS) return saved.value;
  } catch {
    // ignore
  }
  const res = await fetch(POLICY_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`NBG policy ${res.status}`);
  const body = (await res.json()) as { data?: { date: string; rate: string }[] };
  const value = (body.data ?? [])
    .map((d) => ({ date: d.date.slice(0, 10), rate: Number(d.rate) }))
    .filter((d) => d.rate > 0)
    .sort((a, b) => b.date.localeCompare(a.date));
  if (!value.length) throw new Error('NBG policy: no data');
  try {
    localStorage.setItem(POLICY_KEY, JSON.stringify({ at: Date.now(), value }));
  } catch {
    // ignore
  }
  return value;
}

/** Policy rate in force on a date. */
export function policyRateOn(decisions: PolicyRateDecision[], isoDate: string): number {
  return (decisions.find((d) => d.date <= isoDate) ?? decisions[decisions.length - 1]).rate;
}

// ---------- TIBR (Tbilisi Interbank Interest Rate), NBG ----------

const TIBR_URL = 'https://nbg.gov.ge/gw/api/ct/MonetaryPolicy/TIBR/Index';
const TIBR_KEY = 'danazogi.tibr-monthly.v1';
const TIBR_PAGE = 100; // API maximum
const TIBR_REFRESH_MS = 24 * 60 * 60 * 1000;

interface TibrRow {
  date: string;
  tibR6M: string;
}

/**
 * Monthly average of the 6-month TIBR (% a year), keyed "YYYY-MM", covering at least `months` months.
 * Past months never change: they're cached permanently; only the latest page is refreshed daily.
 */
export async function fetchTibrMonthly(months: number): Promise<Record<string, number>> {
  let saved: { at: number; monthly: Record<string, number> } | null = null;
  try {
    saved = JSON.parse(localStorage.getItem(TIBR_KEY) ?? 'null');
  } catch {
    // ignore
  }
  const oldestNeeded = new Date(new Date().getFullYear(), new Date().getMonth() - months, 1).toISOString().slice(0, 7);
  const haveHistory = saved && Object.keys(saved.monthly).some((m) => m <= oldestNeeded);
  if (saved && haveHistory && Date.now() - saved.at < TIBR_REFRESH_MS) return saved.monthly;

  // Daily rows, newest first. Full history once, then just the latest page.
  const pages = haveHistory ? 1 : Math.ceil((months * 22) / TIBR_PAGE) + 1;
  const rows: TibrRow[] = [];
  for (let p = 0; p < pages; p += 6) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(6, pages - p) }, async (_, i) => {
        const res = await fetch(`${TIBR_URL}?take=${TIBR_PAGE}&skip=${(p + i) * TIBR_PAGE}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!res.ok) throw new Error(`NBG TIBR ${res.status}`);
        return ((await res.json()) as { data?: TibrRow[] }).data ?? [];
      }),
    );
    batch.forEach((b) => rows.push(...b));
  }
  const sums = new Map<string, { total: number; n: number }>();
  for (const r of rows) {
    const v = Number(r.tibR6M);
    if (!(v > 0)) continue;
    const m = r.date.slice(0, 7);
    const s = sums.get(m) ?? { total: 0, n: 0 };
    s.total += v;
    s.n += 1;
    sums.set(m, s);
  }
  const fresh = Object.fromEntries([...sums].map(([m, s]) => [m, Math.round((s.total / s.n) * 1000) / 1000]));
  const monthly = { ...(saved?.monthly ?? {}), ...fresh };
  if (!Object.keys(monthly).length) throw new Error('NBG TIBR: no data');
  try {
    localStorage.setItem(TIBR_KEY, JSON.stringify({ at: Date.now(), monthly }));
  } catch {
    // ignore
  }
  return monthly;
}
