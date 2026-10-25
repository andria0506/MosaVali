/**
 * Stock exploration — /app/stocks and /app/stocks/:ticker.
 * Live prices come from the Yahoo Finance relay (live/sample labelled); the
 * "Effect on your plan" panel is the backend's stock-check model. A single
 * stock never enters the plan or a trade (rule PROD-01) — exploration only.
 */
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronRight, ExternalLink } from 'lucide-react';
import { Badge, Loading, ModelChip, Screen, Segmented } from '../../components/app/kit';
import { PriceChart } from '../../components/app/charts';
import { Change, KV, Page, PageHead, Panel, Sparkline, UnderlineTabs, td, th } from '../../components/app/dash';
import { useI18n } from '../../i18n';
import { api } from '../../services/backend';
import { fetchMarket, type MarketData } from '../../services/market';
import { fetchCompanyNews, type LiveNews } from '../../services/news';
import { fetchUsdGelRate } from '../../services/rates';
import { useApi } from '../../services/useApi';
import { useSession } from '../../state/SessionContext';
import type { ExchangeRate, StockCheck, StockProfile } from '../../types';
import { STOCKS } from '../../lib/stocks';

// London listings quote in pence (GBp); show pounds like a broker app would.
const priceText = (m: MarketData) =>
  m.currency === 'GBp'
    ? `£${(m.price / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `${m.currency === 'USD' ? '$' : `${m.currency} `}${m.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

function TickerTile({ ticker }: { ticker: string }) {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line-night bg-night-3 text-[10px] font-medium tracking-wide">
      {ticker.replace('.L', '').slice(0, 4)}
    </span>
  );
}

function Row({ s }: { s: (typeof STOCKS)[number] }) {
  const { t, num } = useI18n();
  const navigate = useNavigate();
  const market = useApi<MarketData>(() => fetchMarket(s.ticker), [s.ticker]);
  const m = market.data;
  const to = `/app/stocks/${encodeURIComponent(s.ticker)}`;
  return (
    <tr className="cursor-pointer transition-colors hover:bg-night-2/70" onClick={() => navigate(to)}>
      <td className={td}>
        <Link to={to} className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
          <TickerTile ticker={s.ticker} />
          <span className="min-w-0">
            <span className="block font-medium">{s.ticker.replace('.L', '')}</span>
            <span className="block truncate text-micro text-mute-night">{s.name}</span>
          </span>
        </Link>
      </td>
      <td className={`${td} hidden text-mute-night md:table-cell`}>{t(`app.stocks.profiles.${s.profile}`)}</td>
      <td className={`${td} hidden sm:table-cell`}>{m && <Sparkline points={m.history.slice(-52).map((p) => p.close)} />}</td>
      <td className={`${td} num text-right`}>
        {market.loading ? <span className="text-mute-night">…</span> : market.error ? <span className="text-micro text-mute-night">{t('app.stocks.priceUnavailable')}</span> : m && priceText(m)}
      </td>
      <td className={`${td} text-right`}>
        {m && (
          <Change value={m.change1yPct}>
            {m.change1yPct >= 0 ? '+' : '−'}
            {num(Math.abs(m.change1yPct), 1)}%
          </Change>
        )}
      </td>
      <td className={`${td} num hidden text-right text-caution-300 lg:table-cell`}>{m && `−${num(m.worstDrawdownPct, 0)}%`}</td>
      <td className="pr-4">
        <ChevronRight size={16} className="text-mute-night" />
      </td>
    </tr>
  );
}

/** A highlight card: price, 1-year change and a sparkline (live, cached with the table rows). */
function Highlight({ s }: { s: (typeof STOCKS)[number] }) {
  const { t, num } = useI18n();
  const market = useApi<MarketData>(() => fetchMarket(s.ticker), [s.ticker]);
  const m = market.data;
  return (
    <Link
      to={`/app/stocks/${encodeURIComponent(s.ticker)}`}
      className="block min-w-0 rounded-[1.25rem] border border-line-night bg-gradient-to-b from-night-1 to-night-1/60 p-4 transition-colors hover:border-paper/25"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0">
          <span className="block text-label font-medium">{s.name}</span>
          <span className="block text-micro text-mute-night">{s.ticker.replace('.L', '')}</span>
        </span>
        {m && <Sparkline points={m.history.slice(-52).map((p) => p.close)} width={72} height={28} />}
      </div>
      <p className="num mt-3 text-[1.25rem] leading-tight tracking-[-0.02em]">{m ? priceText(m) : '…'}</p>
      {m && (
        <p className={`num mt-1 text-micro ${m.change1yPct >= 0 ? 'text-accent-300' : 'text-caution-300'}`}>
          {m.change1yPct >= 0 ? '+' : '−'}
          {num(Math.abs(m.change1yPct), 1)}% · {t('app.stocks.year')}
        </p>
      )}
    </Link>
  );
}

const HIGHLIGHTS = ['AAPL', 'NVDA', 'BGEO.L', 'TBCG.L'];

export function StocksList() {
  const { t } = useI18n();
  const [filter, setFilter] = useState<'all' | StockProfile>('all');
  const rows = STOCKS.filter((s) => filter === 'all' || s.profile === filter);
  return (
    <Page>
      <PageHead title={t('app.stocks.title')} sub={t('app.stocks.lead')} badge={<Badge>{t('app.stocks.liveShort')}</Badge>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {STOCKS.filter((s) => HIGHLIGHTS.includes(s.ticker)).map((s) => (
          <Highlight key={s.ticker} s={s} />
        ))}
      </div>
      <Panel flush>
        <div className="px-5">
          <UnderlineTabs
            label={t('app.stocks.title')}
            value={filter}
            onChange={setFilter}
            items={[
              { id: 'all', label: t('app.stocks.filterAll') },
              { id: 'big_tech', label: t('app.stocks.profiles.big_tech') },
              { id: 'ge_bank', label: t('app.stocks.profiles.ge_bank') },
            ]}
          />
        </div>
        <div className="overflow-x-auto pb-2 pt-3" tabIndex={0} role="region" aria-label={t('app.stocks.title')}>
          <table className="w-full">
            <thead>
              <tr>
                <th className={th}>{t('app.stocks.colInstrument')}</th>
                <th className={`${th} hidden md:table-cell`}>{t('app.stocks.colType')}</th>
                <th className={`${th} hidden sm:table-cell`}>{t('app.stocks.colChart')}</th>
                <th className={`${th} text-right`}>{t('app.stocks.colPrice')}</th>
                <th className={`${th} text-right`}>{t('app.stocks.year')}</th>
                <th className={`${th} hidden text-right lg:table-cell`}>{t('app.stocks.colWorst')}</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line-night/70 border-t border-line-night">
              {rows.map((s) => (
                <Row key={s.ticker} s={s} />
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <p className="mt-4 text-micro text-mute-night">{t('app.stocks.exploreOnly')}</p>
    </Page>
  );
}

const SHARES = ['0.05', '0.1', '0.2', '0.3'] as const;
const EPISODES = ['S08', 'S15', 'S20', 'S22'] as const;
const EP_NAME: Record<string, string> = { S08: '2008–09', S15: '2014–15', S20: '2020', S22: '2022' };

function EffectPanel({ profile, ticker }: { profile: StockProfile; ticker: string }) {
  const { t, L, lt, money, num } = useI18n();
  const { session, missionKey: mission, monthly } = useSession();
  const [share, setShare] = useState<(typeof SHARES)[number]>('0.2');
  const check = useApi<StockCheck>(
    () => (session && mission ? api.stockCheck(session, profile, Number(share), mission, monthly ?? undefined) : Promise.resolve(null as unknown as StockCheck)),
    [session?.consent_id, profile, share, mission, monthly],
  );
  if (!mission) return null;
  const c = check.data;
  const signed = (v: number) => `${v >= 0 ? '+' : '−'}${num(Math.abs(v) * 100, 0)}%`;
  const gel = (v: number) => money({ amount: v, currency: 'GEL' });
  return (
    <Panel title={t('app.stocks.effectTitle')} sub={c ? t('app.stocks.effectLabel', { profile: L(c.profile, 'name') }) : undefined} action={<ModelChip label={t('app.planTab.simulated')} />}>
      <Segmented label={t('app.stocks.shareLabel')} value={share} onChange={setShare} options={SHARES.map((s) => ({ id: s, label: `${num(Number(s) * 100, 0)}%` }))} />
      {check.loading && !c && (
        <div className="mt-4">
          <Loading blocks={[160]} />
        </div>
      )}
      {c && (
        <>
          {/* Chance, before and after */}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-line-night bg-night-2/60 p-3">
              <p className="text-micro text-mute-night">{t('app.stocks.colPlan')}</p>
              <p className="num mt-1 text-figure-sm">{num(c.plan.probability * 100, 0)}%</p>
            </div>
            <div className="rounded-xl border border-line-night bg-night-2/60 p-3">
              <p className="text-micro text-mute-night">{t('app.stocks.colStock', { ticker: ticker.replace('.L', '') })}</p>
              <p className={`num mt-1 text-figure-sm ${c.with_stock.probability < c.plan.probability ? 'text-caution-300' : 'text-accent-300'}`}>
                {num(c.with_stock.probability * 100, 0)}%
              </p>
            </div>
          </div>
          <p className="mt-1.5 text-micro text-mute-night">{t('app.stocks.rowChance')}</p>
          <table className="mt-4 w-full text-label">
            <thead>
              <tr>
                <th className="pb-2 text-left text-[11px] font-medium uppercase tracking-[0.06em] text-mute-night" />
                <th className="pb-2 text-right text-[11px] font-medium uppercase tracking-[0.06em] text-mute-night">{t('app.stocks.colPlan')}</th>
                <th className="pb-2 text-right text-[11px] font-medium uppercase tracking-[0.06em] text-mute-night">+ {ticker.replace('.L', '')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-night/70 border-t border-line-night">
              <tr>
                <td className="py-2 text-mute-night">{t('app.stocks.rowBadCase')}</td>
                <td className="num py-2 text-right">−{gel(c.plan.worst5_shortfall_gel)}</td>
                <td className="num py-2 text-right">−{gel(c.with_stock.worst5_shortfall_gel)}</td>
              </tr>
              {EPISODES.map((e) => (
                <tr key={e}>
                  <td className="py-2 text-mute-night">{EP_NAME[e]}</td>
                  <td className={`num py-2 text-right ${c.plan.episodes[e] < 0 ? 'text-caution-300' : 'text-accent-300'}`}>{signed(c.plan.episodes[e])}</td>
                  <td className={`num py-2 text-right ${c.with_stock.episodes[e] < 0 ? 'text-caution-300' : 'text-accent-300'}`}>{signed(c.with_stock.episodes[e])}</td>
                </tr>
              ))}
              <tr>
                <td className="py-2 text-mute-night">{t('app.stocks.rowHalving')}</td>
                <td className="num py-2 text-right text-mute-night">—</td>
                <td className="num py-2 text-right text-caution-300">{num(c.stock.halving_probability * 100, 0)}%</td>
              </tr>
            </tbody>
          </table>
        </>
      )}
      <p className="mt-3 text-micro text-caution-300">{c ? lt(c.rule) : t('app.stocks.prod01')}</p>
    </Panel>
  );
}

export function StockDetail() {
  const { t, lt, num, date } = useI18n();
  const { ticker = '' } = useParams();
  const { missions } = useSession();
  const meta = STOCKS.find((s) => s.ticker === ticker);
  const market = useApi<MarketData>(() => fetchMarket(ticker), [ticker]);
  const rate = useApi<ExchangeRate>(() => fetchUsdGelRate(missions?.market.fx_spot ?? 2.7));
  const news = useApi<LiveNews>(() => fetchCompanyNews(ticker, meta?.keywords ?? [ticker]), [ticker]);

  if (!meta) {
    return (
      <Screen>
        <PageHead title={t('app.stocks.title')} back={{ to: '/app/stocks', label: t('app.stocks.title') }} />
        <Panel>
          <p className="text-body">{t('app.stocks.unknown')}</p>
        </Panel>
      </Screen>
    );
  }
  const m = market.data;
  const gel = m && m.currency === 'USD' && rate.data ? m.price * rate.data.rate : null;
  const yearPoints = m ? m.history.slice(-52).map((p) => ({ date: p.date, value: p.close })) : [];

  return (
    <Page>
      <PageHead
        back={{ to: '/app/stocks', label: t('app.stocks.title') }}
        title={
          <span className="flex items-center gap-3">
            {ticker.replace('.L', '')}
            <span className="rounded-md border border-line-night bg-night-2 px-2 py-0.5 text-micro font-medium tracking-wide text-mute-night">{t(`app.stocks.profiles.${meta.profile}`)}</span>
          </span>
        }
        sub={meta.name}
        actions={
          <Link to={`/app/news?ticker=${encodeURIComponent(ticker)}`} className="inline-flex min-h-tap items-center rounded-full border border-line-night px-4 text-label text-paper/85 hover:bg-night-2">
            {t('app.stocks.allNews')}
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {/* Price */}
          <Panel
            title={t('app.stocks.price')}
            sub={m ? `${t('app.stocks.liveLabel')} · ${t('app.stocks.asOf', { at: date(m.asOf.slice(0, 10), 'day') })}` : t('app.stocks.liveLabel')}
          >
            {market.loading && <Loading blocks={[60, 160]} />}
            {market.error && <p className="text-body text-caution-300">{t('app.stocks.priceUnavailable')}</p>}
            {m && (
              <>
                <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
                  <p className="num text-figure">{priceText(m)}</p>
                  <Change value={m.change1yPct}>
                    {m.change1yPct >= 0 ? '+' : '−'}
                    {num(Math.abs(m.change1yPct), 1)}% · {t('app.stocks.year')}
                  </Change>
                  {gel && (
                    <p className="num pb-1 text-label text-mute-night">
                      ≈ ₾{num(gel, 0)}
                      {rate.data?.source === 'fallback' ? ` ${t('app.stocks.estimated')}` : ''}
                    </p>
                  )}
                </div>
                <div className="mt-4">
                  <PriceChart points={yearPoints} height={220} />
                </div>
              </>
            )}
          </Panel>

          {/* News */}
          <Panel flush title={t('app.stocks.newsTitle')} sub={news.data ? t('app.stocks.newsVia', { provider: news.data.provider }) : undefined}>
            {news.loading && (
              <div className="px-5 pb-5">
                <Loading blocks={[40, 40]} />
              </div>
            )}
            {!news.loading && !news.data?.items.length && <p className="px-5 pb-5 text-label text-mute-night">{t('app.stocks.newsUnavailable')}</p>}
            {news.data && news.data.items.length > 0 && (
              <ul className="divide-y divide-line-night/70 border-t border-line-night">
                {news.data.items.map((n) => (
                  <li key={n.id}>
                    <a href={n.url} target="_blank" rel="noreferrer" className="group flex items-start justify-between gap-3 px-5 py-3.5 hover:bg-night-2/70">
                      <span className="min-w-0">
                        <span className="block text-label text-paper/90 group-hover:text-paper" lang="en">
                          {lt(n.title)}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-2 text-micro text-mute-night">
                          {n.source} · {date(n.publishedAt, 'day')}
                          {n.riskTag && <Badge tone="caution">{t(`app.stocks.risk.${n.riskTag}`)}</Badge>}
                        </span>
                      </span>
                      <ExternalLink size={14} className="mt-1 shrink-0 text-mute-night" />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="space-y-4">
          <EffectPanel profile={meta.profile} ticker={ticker} />
          {m && (
            <Panel title={t('app.stocks.keyFigures')}>
              <KV
                rows={[
                  { label: t('app.stocks.price'), value: priceText(m) },
                  { label: t('app.stocks.change1y'), value: `${m.change1yPct >= 0 ? '+' : '−'}${num(Math.abs(m.change1yPct), 1)}%`, tone: m.change1yPct >= 0 ? 'safe' : 'caution' },
                  { label: t('app.stocks.worstFall'), value: `−${num(m.worstDrawdownPct, 0)}%`, tone: 'caution' },
                  { label: t('app.stocks.currency'), value: m.currency === 'GBp' ? 'GBP' : m.currency },
                  ...(rate.data ? [{ label: t('app.stocks.rate'), value: `₾${num(rate.data.rate, 4)}` }] : []),
                ]}
              />
            </Panel>
          )}
        </div>
      </div>
      <p className="mt-4 text-micro text-mute-night">{t('app.stocks.exploreOnly')}</p>
    </Page>
  );
}
