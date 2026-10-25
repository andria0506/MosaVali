import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ScrollText } from 'lucide-react';
import { useI18n } from '../../i18n';
import { useSession } from '../../state/SessionContext';
import { ButtonLink } from '../../components/ui/Button';
import { Loading, ModelChip, Screen, ToneIcon } from '../../components/app/kit';
import { BarRow, KV, Kpis, More, Page, PageHead, Panel, Ring, td, th } from '../../components/app/dash';

const INCOME_TYPES = ['salaried', 'self_employed', 'seasonal', 'pensioner', 'remittance'] as const;

/**
 * Analysis: what the backend's models measured from the bank data. Four key figures, the protected
 * reserve (cash-need regression) and spending by category lead; the monthly limit (spending
 * regression), the peer model's savings finder, inflation, warnings and model versions sit behind
 * "More analysis". Risk capacity lives on the Plan tab, step 2.
 */
export default function Analysis() {
  const { t, L, money, num } = useI18n();
  const { profile: p, persona } = useSession();

  // Coming from News or Plan with #buffer: scroll once the data is on screen.
  useEffect(() => {
    if (p && window.location.hash) document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
  }, [p]);

  if (!p) return <Screen><Loading /></Screen>;

  const ing = p.ingestion;
  const liq = p.liquidity;
  const spend = p.spending;
  const cap = p.profile.capacity;
  const gel = (amount: number) => money({ amount, currency: 'GEL' });
  const pct = (x: number, d = 0) => `${num(x * 100, d)}%`;
  const alerts = p.profile.alerts;
  const incomeType = INCOME_TYPES.includes(ing.income_type as (typeof INCOME_TYPES)[number]) ? ing.income_type : 'salaried';
  const peerRows = p.peers.rows.filter((r) => r.discretionary).sort((a, b) => b.monthly_saving - a.monthly_saving).slice(0, 5);
  const categories = ing.categories.filter((c) => c.monthly > 1).sort((a, b) => b.monthly - a.monthly);
  const TOP = 5;
  const maxCat = Math.max(1, ...categories.map((c) => c.monthly));
  const contributions = liq.contributions.slice(0, 4);
  const maxEffect = Math.max(1, ...contributions.map((c) => Math.abs(c.effect_gel)));
  const firstName = persona?.source === 'custom' ? null : L(ing.psu, 'name').split(' ')[0];

  return (
    <Page>
      <PageHead
        title={firstName ? t('app.analysis.titleNamed', { name: firstName }) : t('app.analysis.title')}
        sub={t('app.analysis.lead', { n: ing.transaction_count, months: ing.months_of_history })}
        actions={
          <>
            <ButtonLink to="/app/profile/privacy" variant="inverse">
              <ScrollText size={16} /> {t('app.analysis.auditShort')}
            </ButtonLink>
            <ButtonLink to="/app/plan" variant="accent">
              {t('app.analysis.toMissions')} <ArrowRight size={16} />
            </ButtonLink>
          </>
        }
      />

      {p.partial_data && (
        <Panel tone="caution" className="mb-4">
          <p className="text-label">{t('app.home.partialData')}</p>
        </Panel>
      )}

      <Kpis
        items={[
          { label: t('app.home.totalSavings'), value: gel(ing.totals.assets_gel), sub: t('app.analysis.accounts', { n: ing.accounts.length }) },
          { label: t('app.home.protected'), value: gel(liq.buffer_gel), sub: t('app.home.protectedSub') },
          { label: t('app.home.free'), value: gel(liq.free_to_invest_gel), tone: liq.free_to_invest_gel > 0 ? 'safe' : undefined, sub: t('app.analysis.ofTotalShort', { pct: pct(liq.free_to_invest_gel / Math.max(1, ing.totals.assets_gel)) }) },
          { label: t('app.home.monthlyLimit'), value: gel(spend.affordable_monthly_gel), sub: t('app.analysis.perMonth') },
        ]}
      />

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Protected reserve — cash-need regression */}
        <Panel id="buffer" className="lg:col-span-2" title={t('app.analysis.reserveTitle')} sub={t(`app.profile.basis.${liq.reserve_basis}`)} action={<ModelChip label={t('app.analysis.models.liquidity')} />}>
          <div className="grid gap-6 md:grid-cols-2">
            <Ring
              centerLabel={t('app.analysis.total')}
              centerValue={gel(ing.totals.assets_gel)}
              slices={[
                { key: 'reserve', label: t('app.home.protected'), value: liq.buffer_gel, color: '#4FC48A' },
                { key: 'free', label: t('app.home.free'), value: Math.max(0, liq.free_to_invest_gel), color: '#3A403E' },
              ]}
              legendValue={(v, s) => `${gel(v)} · ${pct(s)}`}
            />
            <KV
              rows={[
                { label: t('app.planflow.cashNeed'), value: gel(liq.expected_need_gel) },
                { label: t('app.analysis.required'), value: gel(liq.required_buffer_gel) },
                ...(liq.buffer_shortfall_gel > 0 ? [{ label: t('app.analysis.shortfall'), value: gel(liq.buffer_shortfall_gel), tone: 'caution' as const }] : []),
              ]}
            />
          </div>
          <More inline label={t('app.more.why')} lessLabel={t('app.more.less')}>
            <div className="mt-2 border-t border-line-night pt-4">
              <KV
                rows={[
                  { label: t('app.analysis.cautiousNeed', { pct: num(liq.coverage_target * 100, 0) }), value: gel(liq.cautious_need_gel) },
                  { label: t('app.analysis.minimum', { n: num(liq.minimum_months, 0) }), value: gel(liq.minimum_gel) },
                ]}
              />
            </div>
            {contributions.length > 0 && (
              <div className="mt-5 border-t border-line-night pt-4">
                <p className="text-micro uppercase tracking-[0.06em] text-mute-night">{t('app.planflow.whyTitle')}</p>
                <div className="mt-1">
                  {contributions.map((c) => (
                    <BarRow
                      key={c.key}
                      label={L(c, 'label')}
                      share={Math.abs(c.effect_gel) / maxEffect}
                      tone={c.effect_gel >= 0 ? 'caution' : 'safe'}
                      value={`${c.effect_gel >= 0 ? '+' : '−'}${gel(Math.abs(c.effect_gel))}`}
                    />
                  ))}
                </div>
                <p className="mt-2 text-micro text-mute-night">{t('app.planflow.whyNote')}</p>
              </div>
            )}
          </More>
          {liq.bound_collapsed && <p className="mt-3 text-micro text-mute-night">{t('app.profile.boundCollapsed')}</p>}
          {liq.fallback.active && <p className="mt-3 text-micro text-caution-300">{t('app.planflow.fallbackNote')}</p>}
        </Panel>

        {/* Spending by category */}
        <Panel title={t('app.profile.spendingTitle')} sub={t('app.analysis.spendSub', { total: gel(ing.metrics.monthly_spend), essential: gel(ing.metrics.essential_spend) })}>
          {categories.slice(0, TOP).map((c) => (
            <CategoryRow key={c.key} c={c} max={maxCat} />
          ))}
          {categories.length > TOP && (
            <More inline label={t('app.more.allCategories', { n: categories.length })} lessLabel={t('app.more.less')}>
              {categories.slice(TOP).map((c) => (
                <CategoryRow key={c.key} c={c} max={maxCat} />
              ))}
            </More>
          )}
        </Panel>
      </div>

      <More label={t('app.more.analysis')} lessLabel={t('app.more.lessAnalysis')}>
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Peer model */}
          <Panel
            flush
            className="lg:col-span-2"
            title={t('app.home.finderTitle')}
            sub={p.peers.monthly_total > 0 ? t('app.home.finderBody', { group: L(p.peers.group.name), amount: gel(p.peers.monthly_total) }) : L(p.peers.group.name)}
            action={<ModelChip label={t('app.analysis.models.peers')} />}
          >
            <div className="overflow-x-auto pb-2" tabIndex={0} role="region" aria-label={t('app.home.finderTitle')}>
              <table className="w-full min-w-[30rem]">
                <thead>
                  <tr>
                    <th className={th}>{t('app.analysis.colCategory')}</th>
                    <th className={`${th} text-right`}>{t('app.analysis.colYou')}</th>
                    <th className={`${th} text-right`}>{t('app.analysis.colPeers')}</th>
                    <th className={`${th} text-right`}>{t('app.analysis.colSave')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-night/70 border-t border-line-night">
                  {peerRows.map((r) => (
                    <tr key={r.category}>
                      <td className={`${td} text-paper/85`}>{L(r, 'label')}</td>
                      <td className={`${td} num text-right`}>{gel(r.you)}</td>
                      <td className={`${td} num text-right text-mute-night`}>{gel(r.p50)}</td>
                      <td className={`${td} num text-right ${r.monthly_saving > 1 ? 'text-accent-300' : 'text-mute-night'}`}>
                        {r.monthly_saving > 1 ? `+${gel(r.monthly_saving)}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* Monthly limit — spending regression */}
          <Panel title={t('app.home.monthlyLimit')} action={<ModelChip label={t('app.analysis.models.spending')} />}>
            <p className="num text-figure-sm">{gel(spend.affordable_monthly_gel)}</p>
            <div className="mt-4">
              <KV
                rows={[
                  { label: t('app.analysis.nextSpend'), value: gel(spend.expected_gel) },
                  { label: t('app.analysis.nextSpendCautious', { pct: pct(spend.coverage_target) }), value: gel(spend.cautious_gel) },
                  { label: t('app.profile.monthlyAvg'), value: gel(ing.metrics.monthly_income) },
                  { label: t('app.profile.stability'), value: `${pct(cap.parts.stability)} · ${t(`app.profile.incomeTypes.${incomeType}`)}` },
                ]}
              />
            </div>
            <p className="mt-3 text-micro text-mute-night">{t('app.home.coverageNote', { pct: num(spend.coverage_target * 100, 0) })}</p>
          </Panel>

          <div className="space-y-4">
            {/* Inflation and currency */}
            <Panel title={t('app.home.inflationTitle')} sub={t('app.home.cpiNote')}>
              <KV
                rows={[
                  { label: t('app.home.inflationYours'), value: pct(p.inflation.personal, 1), tone: p.inflation.personal > p.inflation.national ? 'caution' : undefined },
                  { label: t('app.home.inflationNational'), value: pct(p.inflation.national, 1) },
                  { label: t('app.analysis.idleLoss'), value: `−${gel(p.idle_cash_loss_per_year)}` },
                  { label: t('app.analysis.usdShare'), value: pct(ing.totals.usd_share) },
                  { label: t('app.analysis.usdDebtShort'), value: pct(p.profile.usd_liability_share) },
                ]}
              />
            </Panel>

            {/* Warnings */}
            <Panel
              title={t('app.analysis.warnings')}
              action={
                alerts.length > 0 && (
                  <Link to="/app/news" className="text-micro text-accent-300 hover:text-accent-400">
                    {t('app.home.seeAll')}
                  </Link>
                )
              }
            >
              {alerts.length === 0 ? (
                <p className="text-label text-mute-night">{t('app.alerts.empty')}</p>
              ) : (
                <ul className="space-y-3">
                  {alerts.slice(0, 3).map((a, i) => {
                    const caution = a.tone === 'critical' || a.tone === 'warn';
                    return (
                      <li key={i} className="flex gap-3">
                        <span className="mt-0.5">
                          <ToneIcon tone={caution ? 'caution' : 'neutral'} size={16} />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-label text-paper/90">{L(a)}</span>
                          <span className="block text-micro text-mute-night">{t(`app.alerts.kinds.${a.kind}`)}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>
          </div>

          {/* Model versions */}
          <Panel
            className="lg:col-span-2"
            title={t('app.analysis.modelsTitle')}
            action={
              <Link to="/app/profile/privacy" className="inline-flex items-center gap-1 text-micro text-accent-300 hover:text-accent-400">
                {t('app.analysis.modelCard')} <ArrowRight size={14} />
              </Link>
            }
          >
            <div className="grid gap-x-8 sm:grid-cols-2">
              {Object.entries(p.models).map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-3 border-b border-line-night/70 py-2.5">
                  <span className="text-label text-mute-night">{t(`app.analysis.modelNames.${k}`)}</span>
                  <span className="num truncate text-micro text-paper/70">{v}</span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-micro text-mute-night">{t('app.privacy.synthetic')}</p>
          </Panel>
        </div>
      </More>
    </Page>
  );
}

function CategoryRow({ c, max }: { c: { key: string; label_ka: string; label_en: string; essential: boolean; monthly: number }; max: number }) {
  const { t, L, money } = useI18n();
  return (
    <BarRow
      label={
        <>
          {L(c, 'label')}
          {c.essential && <span className="ml-2 text-micro text-mute-night">{t('app.analysis.essential')}</span>}
        </>
      }
      share={c.monthly / max}
      tone={c.essential ? 'neutral' : 'safe'}
      value={money({ amount: c.monthly, currency: 'GEL' })}
    />
  );
}
