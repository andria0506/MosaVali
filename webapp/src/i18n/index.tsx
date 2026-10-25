import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Currency, Locale, LocalizedText, Money, ReasonCode } from '../types';
import ka from './ka.json';
import en from './en.json';

type Dict = { [key: string]: string | Dict };
// Months are arrays in the JSON; lookup indexes them like objects ("months.short.3").
const dictionaries = { ka, en } as unknown as Record<Locale, Dict>;
const STORAGE_KEY = 'danazogi.locale';

function lookup(dict: Dict, key: string): string | undefined {
  let node: string | Dict | undefined = dict;
  for (const part of key.split('.')) {
    if (typeof node !== 'object') return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

// Hand-rolled instead of Intl: browsers ship uneven "ka-GE" data (some fall back to en-US).
const separators: Record<Locale, { group: string; decimal: string }> = {
  ka: { group: ' ', decimal: ',' },
  en: { group: ',', decimal: '.' },
};

export function formatNumber(value: number, locale: Locale, maxFractionDigits = 1): string {
  const { group, decimal } = separators[locale];
  const fixed = Math.abs(value).toFixed(maxFractionDigits);
  const [int, frac] = fixed.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  const trimmed = frac?.replace(/0+$/, '');
  return `${value < 0 ? '−' : ''}${grouped}${trimmed ? decimal + trimmed : ''}`;
}

const symbols: Record<Currency, string> = { GEL: '₾', USD: '$' };

/** "4 700 ₾" in Georgian, "₾4,700" in English. Never shows cents. */
export function formatMoney(money: Money, locale: Locale): string {
  const n = formatNumber(Math.abs(Math.round(money.amount)), locale, 0);
  const sign = Math.round(money.amount) < 0 ? '−' : '';
  return locale === 'ka' ? `${sign}${n} ${symbols[money.currency]}` : `${sign}${symbols[money.currency]}${n}`;
}

interface I18n {
  locale: Locale;
  setLocale: (l: Locale) => void;
  /** Translate a UI key, with {{param}} interpolation. */
  t: (key: string, params?: Record<string, string | number>) => string;
  /** Render a model explanation (ReasonCode) from the "reasons" namespace. */
  tr: (reason: ReasonCode) => string;
  /** Pick the current language from backend-generated text. */
  lt: (text: LocalizedText) => string;
  /** Pick `${base}_ka`/`${base}_en` from a backend object, or `{ka, en}` when base is omitted. */
  L: <T extends object>(obj: T, base?: string) => string;
  /** Goal name from the backend ("buying a car"), capitalised for use as a title in English. */
  goalName: (goal: object) => string;
  money: (m: Money) => string;
  num: (n: number, maxFractionDigits?: number) => string;
  /** "სექტემბერი 2028" / "September 2028", or "17 ოქტ" / "Oct 17" with style "day". */
  date: (iso: string, style?: 'month' | 'day') => string;
}

const I18nContext = createContext<I18n | null>(null);

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'ka' || saved === 'en') return saved;
  } catch {
    // storage unavailable: fall through to default
  }
  return 'ka';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // ignore
    }
  }, []);

  const value = useMemo<I18n>(() => {
    const num = (n: number, d = 1) => formatNumber(n, locale, d);
    const t = (key: string, params?: Record<string, string | number>) => {
      const raw = lookup(dictionaries[locale], key) ?? lookup(dictionaries.en, key) ?? key;
      if (!params) return raw;
      return raw.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
        const v = params[name];
        if (v === undefined) return `{{${name}}}`;
        return typeof v === 'number' ? num(v) : v;
      });
    };
    const L = (obj: object, base?: string) => {
      const o = obj as Record<string, unknown>;
      const v = base ? o[`${base}_${locale}`] ?? o[`${base}_en`] : o[locale] ?? o.en;
      return v == null ? '' : String(v);
    };
    return {
      locale,
      setLocale,
      t,
      tr: (r) => t(`reasons.${r.code}`, r.params),
      lt: (text) => text[locale],
      L,
      // Georgian has no letter case (toUpperCase would switch to Mtavruli), so only English is capitalised.
      goalName: (goal) => {
        const s = L(goal);
        return locale === 'en' ? s.charAt(0).toUpperCase() + s.slice(1) : s;
      },
      money: (m) => formatMoney(m, locale),
      num,
      date: (iso, style = 'month') => {
        const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
        if (style === 'day') {
          const month = t(`months.short.${m - 1}`);
          return locale === 'ka' ? `${d} ${month}` : `${month} ${d}`;
        }
        return `${t(`months.long.${m - 1}`)} ${y}`;
      },
    };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
}
