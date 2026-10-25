import type { Currency, ISODate, LocalizedText, Money, ReasonCode, Tone } from './common';

/** Official USD→GEL rate. */
export interface ExchangeRate {
  base: 'USD';
  quote: 'GEL';
  rate: number; // GEL per 1 USD
  validFrom: ISODate;
  /** "NBG" = official National Bank of Georgia rate; "fallback" = estimate when it can't be fetched. */
  source: 'NBG' | 'fallback';
}

export interface Stock {
  ticker: string;
  name: string;
  exchange: 'NASDAQ' | 'NYSE' | 'LSE';
  currency: Currency;
  sector: string; // i18n key under "sectors."
  country: string; // ISO 3166 alpha-2
  price: Money;
  /** Price in GEL at the current official rate. */
  localPrice: Money;
  /** Worst 12-month fall over the last 5 years, %. */
  worstDrawdownPct: number;
  /** Change over the last 12 months, %, when live history is available. */
  change1yPct?: number;
  /** "live" = market price now; "sample" = fallback data when markets can't be reached. */
  priceSource: 'live' | 'sample';
  priceAsOf: ISODate;
  availableAtBog: boolean;
}

/** Price history for a chart. */
export interface PriceHistory {
  ticker: string;
  currency: Currency;
  points: { date: ISODate; value: number }[];
  source: 'live' | 'sample';
}

export interface NewsItem {
  id: string;
  ticker?: string;
  title: LocalizedText;
  summary?: LocalizedText;
  source: string;
  /** Link to the original article. */
  url?: string;
  /** Language the article was published in, when it wasn't translated. */
  originalLanguage?: 'ka' | 'en';
  publishedAt: ISODate;
  /** "caution" = risk-related headline (shown first); tone is never "danger". */
  tone: Tone;
  /** Risk topic, when the headline is risk-related. */
  riskTag?: 'regulation' | 'earnings' | 'lawsuit' | 'currency' | 'sector' | 'macro';
}

export interface ExposureChange {
  before: number; // 0–1
  after: number;
}

export interface StockFit {
  goalId: string;
  ticker: string;
  proposedAmount: Money;
  /** Share of the stock bucket held by the single largest position. */
  concentration: ExposureChange;
  usdExposure: ExposureChange;
  sectorShare: ExposureChange;
  /** Worst-case loss of the whole goal portfolio, in spending currency. */
  worstCaseLoss: { before: Money; after: Money };
  staysWithinRisk: boolean;
  analysis: LocalizedText;
  /** Plain-language description generated from real price history; replaces `analysis` when present. */
  summary?: ReasonCode[];
  /** Facts computed from real price history (returns, volatility). */
  facts?: ReasonCode[];
  flags: ReasonCode[];
}

/** Risk-related news for one stock. "live" = fetched from a news index now; "sample" = fallback data. */
export interface NewsFeed {
  ticker: string;
  items: NewsItem[];
  source: 'live' | 'sample';
  provider: string; // "Yahoo Finance", "GDELT" or "sample"
  fetchedAt: ISODate;
}
