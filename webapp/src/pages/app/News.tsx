import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, ExternalLink } from 'lucide-react';
import { useI18n } from '../../i18n';
import { useSession } from '../../state/SessionContext';
import { markAllRead } from '../../lib/readAlerts';
import { STOCKS } from '../../lib/stocks';
import { fetchCompanyNews, type LiveNews } from '../../services/news';
import { useApi } from '../../services/useApi';
import { Badge, Loading, Screen } from '../../components/app/kit';
import { Page, PageHead, Panel, UnderlineTabs } from '../../components/app/dash';

const caution = (tone: string) => tone === 'critical' || tone === 'warn';

/**
 * News: live headlines for the stocks the app can explore (risk-related first, labelled), next to
 * the updates the profiler produced from the bank data (the former Alerts tab).
 */
export default function News() {
  const { t, L } = useI18n();
  const { profile, session } = useSession();
  const [params, setParams] = useSearchParams();
  const alerts = profile?.profile.alerts;
  const ticker = STOCKS.some((s) => s.ticker === params.get('ticker')) ? params.get('ticker')! : STOCKS[0].ticker;

  // Opening the tab marks every update read (the badge uses local read-state).
  useEffect(() => {
    if (session && alerts?.length) markAllRead(session.consent_id, alerts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.consent_id, alerts?.length]);

  if (!profile) return <Screen><Loading /></Screen>;

  return (
    <Page>
      <PageHead title={t('app.news.title')} sub={t('app.news.lead')} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="order-2 lg:order-1 lg:col-span-2">
          <Panel flush title={t('app.news.headlines')}>
            <div className="px-5">
              <UnderlineTabs
                label={t('app.news.headlines')}
                value={ticker}
                onChange={(v) => setParams({ ticker: v }, { replace: true })}
                items={STOCKS.map((s) => ({ id: s.ticker, label: s.ticker.replace('.L', '') }))}
              />
            </div>
            <Headlines key={ticker} ticker={ticker} />
          </Panel>
          <p className="mt-3 text-micro text-mute-night">{t('app.news.disclaimer')}</p>
        </div>

        <div className="order-1 lg:order-2">
          <Panel title={t('app.news.updates')} sub={t('app.alerts.lead')}>
            {(alerts ?? []).length === 0 ? (
              <p className="text-label text-mute-night">{t('app.alerts.empty')}</p>
            ) : (
              <ol className="relative space-y-4 before:absolute before:bottom-2 before:left-[5px] before:top-2 before:w-px before:bg-line-night">
                {(alerts ?? []).map((a, i) => (
                  <li key={i} className="relative pl-6">
                    <span
                      className={`absolute left-0 top-1.5 h-[11px] w-[11px] rounded-full border-2 border-night-1 ${caution(a.tone) ? 'bg-caution-400' : 'bg-paper/60'}`}
                    />
                    <p className="text-label text-paper/90">{L(a)}</p>
                    <p className="mt-0.5 text-micro text-mute-night">{t(`app.alerts.kinds.${a.kind}`)}</p>
                  </li>
                ))}
              </ol>
            )}
            <Link to="/app/analysis#buffer" className="mt-4 inline-flex min-h-tap items-center gap-1.5 text-label text-accent-300 hover:text-accent-400">
              {t('app.news.toReserve')} <ArrowRight size={16} />
            </Link>
          </Panel>
        </div>
      </div>
    </Page>
  );
}

function Headlines({ ticker }: { ticker: string }) {
  const { t, lt, date } = useI18n();
  const meta = STOCKS.find((s) => s.ticker === ticker)!;
  const news = useApi<LiveNews>(() => fetchCompanyNews(ticker, meta.keywords), [ticker]);

  return (
    <div className="pt-1">
      <div className="flex items-center justify-between gap-3 px-5 py-3">
        <p className="min-w-0 truncate text-label">
          {meta.name} <span className="text-mute-night">· {t(`app.stocks.profiles.${meta.profile}`)}</span>
        </p>
        <Link
          to={`/app/stocks/${encodeURIComponent(ticker)}`}
          className="inline-flex min-h-tap shrink-0 items-center gap-1.5 text-label text-accent-300 hover:text-accent-400"
        >
          {t('app.news.toStock')} <ArrowRight size={16} />
        </Link>
      </div>
      {news.loading && (
        <div className="px-5 pb-5">
          <Loading blocks={[56, 56, 56]} />
        </div>
      )}
      {!news.loading && !news.data?.items.length && <p className="px-5 pb-5 text-label text-mute-night">{t('app.stocks.newsUnavailable')}</p>}
      {news.data && news.data.items.length > 0 && (
        <ul className="divide-y divide-line-night/70 border-t border-line-night">
          {news.data.items.map((n) => (
            <li key={n.id}>
              <a href={n.url} target="_blank" rel="noreferrer" className="group flex items-start gap-3 px-5 py-4 hover:bg-night-2/70">
                <span className="min-w-0 flex-1">
                  <span className="mb-2 flex flex-wrap items-center gap-2 text-micro text-mute-night">
                    <span className="rounded-md bg-night-3 px-1.5 py-0.5 font-medium text-paper/80">{n.source}</span>
                    {date(n.publishedAt, 'day')}
                    {n.riskTag && <Badge tone="caution">{t(`app.stocks.risk.${n.riskTag}`)}</Badge>}
                  </span>
                  <span className="block text-body text-paper/90 group-hover:text-paper" lang="en">
                    {lt(n.title)}
                  </span>
                </span>
                <ExternalLink size={16} className="mt-1 shrink-0 text-mute-night" />
              </a>
            </li>
          ))}
        </ul>
      )}
      {news.data && <p className="border-t border-line-night px-5 py-3 text-micro text-mute-night">{t('app.stocks.newsVia', { provider: news.data.provider })}</p>}
    </div>
  );
}
