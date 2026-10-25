/**
 * Live company news per stock, risk-related headlines first.
 *
 * Sources, in order:
 *   1. Yahoo Finance search — fast and current. Yahoo blocks browser (CORS) calls, so it goes
 *      through the dev/preview server relay at /api/yahoo (see vite.config.ts).
 *   2. GDELT DOC 2.0 — free, no key, CORS-enabled, works on static hosting, but slow and
 *      rate-limited to one request per 5 s per IP.
 * Both match loosely, so only headlines that name the company are kept; headlines about a
 * risk topic are tagged and shown first. Results are cached for 30 minutes (also across reloads).
 */
import type { NewsItem } from '../types';

const CACHE_MS = 30 * 60 * 1000;
const MAX_ITEMS = 3;
const STORAGE_KEY = 'danazogi.news-cache.v3';

// Risk topics, most specific first.
const RISK_TAGS: { tag: NonNullable<NewsItem['riskTag']>; pattern: RegExp }[] = [
  { tag: 'lawsuit', pattern: /\b(lawsuits?|sues?|sued|court|settle(ment)?|litigation|class action|verdict|jury)\b/i },
  { tag: 'regulation', pattern: /\b(regulat\w*|antitrust|probe|investigat\w*|subpoena\w*|FTC|DOJ|SEC|export (ban|curbs?|controls?|restrictions?|rules?)|sanctions?|tariffs?|fined?|bans?|banned|recall)\b/i },
  { tag: 'earnings', pattern: /\b(downgrade[sd]?|profit warning|miss(es|ed)?|cuts? (guidance|forecast|outlook)|cuts? (its |the )?(\w+ )?(price |valuation )?target|weak (guidance|forecast|outlook)|(stocks?|shares?) (fall|falls|fell|drop\w*|slump\w*|tumbl\w*|sink\w*|sank|plung\w*|slid\w*)|(slips?|slides?|sinks?|tumbles?|plunges?|slumps?) \d+%?)\b/i },
  { tag: 'sector', pattern: /\b(layoffs?|job cuts|shortage|slowdown|strike)\b/i },
];

export interface LiveNews {
  items: NewsItem[];
  provider: string;
  fetchedAt: string;
}

interface Headline {
  title: string;
  url: string;
  source: string;
  publishedAt: string;
}

type CacheEntry = { value: LiveNews; at: number };
const cache = new Map<string, CacheEntry>(Object.entries(loadCache()));
const inFlight = new Map<string, Promise<LiveNews>>();

export function fetchCompanyNews(ticker: string, keywords: string[]): Promise<LiveNews> {
  const hit = cache.get(ticker);
  if (hit && Date.now() - hit.at < CACHE_MS) return Promise.resolve(hit.value);
  let pending = inFlight.get(ticker);
  if (!pending) {
    pending = load(ticker, keywords).finally(() => inFlight.delete(ticker));
    inFlight.set(ticker, pending);
  }
  return pending;
}

async function load(ticker: string, keywords: string[]): Promise<LiveNews> {
  const providers: [string, () => Promise<Headline[]>][] = [
    ['Yahoo Finance', () => fromYahoo(ticker)],
    ['GDELT', () => fromGdelt(keywords)],
  ];
  let lastError: unknown;
  for (const [provider, fetchHeadlines] of providers) {
    try {
      const value = { items: select(await fetchHeadlines(), ticker, keywords), provider, fetchedAt: new Date().toISOString() };
      cache.set(ticker, { value, at: Date.now() });
      saveCache();
      return value;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

/** Keep headlines that name the company; risk-related first, then newest. */
function select(headlines: Headline[], ticker: string, keywords: string[]): NewsItem[] {
  const names = new RegExp(`\\b(${[...keywords.map(escape), ticker].join('|')})\\b`, 'i');
  const seen = new Set<string>();
  const picked = headlines
    .filter((h) => h.title && names.test(h.title))
    .filter((h) => {
      const key = h.title.toLowerCase().replace(/\W+/g, ' ').slice(0, 60);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((h) => ({ h, risk: isSubject(h.title, names) ? RISK_TAGS.find((r) => r.pattern.test(h.title))?.tag : undefined }))
    .sort((a, b) => Number(!!b.risk) - Number(!!a.risk) || b.h.publishedAt.localeCompare(a.h.publishedAt))
    .slice(0, MAX_ITEMS);

  return picked.map(({ h, risk }, i) => ({
    id: `live-${ticker}-${i}`,
    ticker,
    title: { ka: h.title, en: h.title },
    source: h.source,
    url: h.url,
    originalLanguage: 'en',
    publishedAt: h.publishedAt,
    tone: risk ? 'caution' : 'neutral',
    riskTag: risk,
  }));
}

/**
 * Is the company what the headline is about? Passing mentions — named late in the headline, or as
 * one entry in a list ("…faced by Microsoft, Amazon, and Google") — don't make it a risk for that company.
 */
function isSubject(title: string, names: RegExp): boolean {
  const m = names.exec(title);
  if (!m) return false;
  const inList = new RegExp(`(,\\s*(and\\s+)?${escape(m[0])}\\b|\\b${escape(m[0])}\\s*,)`, 'i').test(title);
  return m.index < title.length * 0.5 && !inList;
}

// ---------- Yahoo Finance (through the dev/preview relay) ----------

interface YahooNews {
  title: string;
  publisher: string;
  link: string;
  providerPublishTime: number;
}

async function fromYahoo(ticker: string): Promise<Headline[]> {
  const params = new URLSearchParams({ q: ticker, newsCount: '40', quotesCount: '0' });
  const res = await fetch(`/api/yahoo/v1/finance/search?${params}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok || !res.headers.get('content-type')?.includes('json')) throw new Error(`Yahoo ${res.status}`);
  const { news = [] } = (await res.json()) as { news?: YahooNews[] };
  return news.map((n) => ({
    title: n.title,
    url: n.link,
    source: n.publisher,
    publishedAt: new Date(n.providerPublishTime * 1000).toISOString(),
  }));
}

// ---------- GDELT (direct, rate-limited) ----------

const GDELT_URL = 'https://api.gdeltproject.org/api/v2/doc/doc';
const GDELT_GAP_MS = 6000;
let gdeltQueue: Promise<unknown> = Promise.resolve();
let gdeltLastAt = 0;

interface GdeltArticle {
  url: string;
  title: string;
  seendate: string; // "20261020T174500Z"
  domain: string;
}

/** One GDELT request at a time, spaced app-wide; never retried straight after a 429 (that extends the block). */
function fromGdelt(keywords: string[]): Promise<Headline[]> {
  const run = async () => {
    const wait = gdeltLastAt + GDELT_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    gdeltLastAt = Date.now();
    const names = keywords.map((k) => `"${k}"`).join(' OR ');
    const query = `${keywords.length > 1 ? `(${names})` : names} sourcelang:english`;
    const params = new URLSearchParams({ query, mode: 'artlist', format: 'json', maxrecords: '75', sort: 'datedesc', timespan: '1month' });
    const res = await fetch(`${GDELT_URL}?${params}`, { signal: AbortSignal.timeout(15000) });
    const text = await res.text();
    if (!res.ok || !text.trim().startsWith('{')) throw new Error(`GDELT ${res.status}: ${text.slice(0, 80)}`);
    const { articles = [] } = JSON.parse(text) as { articles?: GdeltArticle[] };
    return articles.map((a) => ({ title: a.title, url: a.url, source: a.domain, publishedAt: gdeltDate(a.seendate) }));
  };
  const result = gdeltQueue.then(run, run);
  gdeltQueue = result.catch(() => undefined);
  return result;
}

function gdeltDate(seen: string): string {
  const m = seen.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : new Date().toISOString();
}

// ---------- helpers ----------

function loadCache(): Record<string, CacheEntry> {
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
    // ignore
  }
}

function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\&]/g, '\\$&');
}
