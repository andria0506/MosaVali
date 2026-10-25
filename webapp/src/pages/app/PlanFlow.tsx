import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { api } from '../../services/backend';
import { useApi } from '../../services/useApi';
import { useI18n } from '../../i18n';
import { useSession } from '../../state/SessionContext';
import { DecideStep as Decide } from './Decide';
import type { FundsView, Mission } from '../../types';
import { Button } from '../../components/ui/Button';
import { RiskScale } from '../../components/app/RiskScale';
import { AllocationBar } from '../../components/app/charts';
import { ActionBar, Badge, Card, Loading, PageTitle, Screen, SectionLabel, Stat } from '../../components/app/kit';

const STEPS = ['buffer', 'mission', 'stress', 'decide'] as const;
type StepId = (typeof STEPS)[number];

function missionStatus(m: Mission): { tone: 'safe' | 'caution' | 'neutral'; key: string } {
  if (m.compliance.blocked) return { tone: 'caution', key: 'blocked' };
  if (m.compliance.needs_acknowledgment.length) return { tone: 'caution', key: 'ack' };
  return { tone: 'safe', key: 'allowed' };
}

function Stepper({ step }: { step: StepId }) {
  const { t } = useI18n();
  const idx = STEPS.indexOf(step);
  return (
    <div className="mb-6">
      <div className="flex gap-1.5" role="progressbar" aria-label={t('app.planflow.step', { n: idx + 1, total: STEPS.length })} aria-valuenow={idx + 1} aria-valuemax={STEPS.length}>
        {STEPS.map((s, i) => (
          <span key={s} className={`h-1 flex-1 rounded-full ${i <= idx ? 'bg-accent-400' : 'bg-night-3'}`} />
        ))}
      </div>
      <p className="mt-2 text-label text-mute-night">
        {t('app.planflow.step', { n: idx + 1, total: STEPS.length })} · {t(`app.planflow.steps.${step}`)}
      </p>
    </div>
  );
}

function BufferStep() {
  const { t, L, money, num } = useI18n();
  const { profile: p } = useSession();
  if (!p) return <Loading />;
  const liq = p.liquidity;
  return (
    <>
      <PageTitle title={t('app.planflow.bufferTitle')} lead={t('app.planflow.bufferLead')} />
      <Card>
        <div className="grid grid-cols-2 gap-4">
          <Stat label={t('app.planflow.protected')} value={money({ amount: liq.buffer_gel, currency: 'GEL' })} tone="safe" />
          <Stat label={t('app.planflow.free')} value={money({ amount: liq.free_to_invest_gel, currency: 'GEL' })} />
        </div>
        <p className="mt-4 text-label text-paper/80">{t(`app.profile.basis.${liq.reserve_basis}`)}</p>
        <div className="mt-4 grid grid-cols-2 gap-4 border-t border-line-night pt-4">
          <Stat
            label={t('app.planflow.cashNeed')}
            value={money({ amount: liq.expected_need_gel, currency: 'GEL' })}
            size="md"
            sub={t('app.planflow.cautious', { amount: money({ amount: liq.cautious_need_gel, currency: 'GEL' }) })}
          />
          <Stat label={t('app.planflow.coverage')} value={`${num(liq.coverage_target * 100, 0)}%`} size="md" sub={t('app.planflow.coverageSub')} />
        </div>
        {liq.bound_collapsed && <p className="mt-3 text-micro text-mute-night">{t('app.profile.boundCollapsed')}</p>}
        {liq.contributions.length > 0 && (
          <div className="mt-4 border-t border-line-night pt-4">
            <p className="text-label font-medium">{t('app.planflow.whyTitle')}</p>
            <ul className="mt-2 space-y-1.5">
              {liq.contributions.slice(0, 3).map((c) => (
                <li key={c.key} className="flex items-baseline justify-between gap-3 text-label">
                  <span className="min-w-0 text-mute-night">{L(c, 'label')}</span>
                  <span className="num shrink-0">{money({ amount: c.effect_gel, currency: 'GEL' })}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-micro text-mute-night">{t('app.planflow.whyNote')}</p>
          </div>
        )}
      </Card>
      {liq.fallback.active && (
        <Card tone="caution" className="mt-3">
          <p className="text-label">{t('app.planflow.fallbackNote')}</p>
        </Card>
      )}
      {liq.buffer_shortfall_gel > 0 && (
        <Card tone="caution" className="mt-3">
          <p className="text-label">
            {t('app.planflow.shortfall', { amount: money({ amount: liq.buffer_shortfall_gel, currency: 'GEL' }) })}
          </p>
        </Card>
      )}
      <Link to="/app/stocks" className="mt-3 flex items-center justify-between gap-3 rounded-card border border-line-night bg-night-1 p-4 transition-colors hover:border-paper/30">
        <span className="text-label">{t('app.planflow.stocksLink')}</span>
        <ArrowRight size={16} className="text-mute-night" />
      </Link>
    </>
  );
}

function MissionStep() {
  const { t, L, money, num } = useI18n();
  const { profile: p, missions: view, missionKey, choose } = useSession();
  if (!p || !view) return <Screen><Loading /></Screen>;
  const focus = missionKey ?? view.recommended;
  const fm = view.missions.find((m) => m.key === focus);
  const preserve = p.profile.goal.kind === 'preserve';
  return (
    <>
      <PageTitle title={t('app.planflow.missionTitle')} lead={t('app.planflow.missionLead')} />
      <div className="grid gap-3" role="radiogroup" aria-label={t('app.planflow.missionTitle')}>
        {view.missions.map((m) => {
          const st = missionStatus(m);
          const selected = focus === m.key;
          return (
            <button
              key={m.key}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => choose(m.key)}
              className={`rounded-card border p-5 text-left transition-colors ${
                selected ? 'border-accent-400 bg-accent-400/[0.07]' : 'border-line-night bg-night-1 hover:border-paper/30'
              } ${m.compliance.blocked ? 'opacity-60' : ''}`}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-heading font-normal">{L(m)}</p>
                  <p className="mt-1 text-label text-mute-night">{L(m, 'objective')}</p>
                </div>
                <div className="flex flex-wrap gap-1.5 sm:shrink-0 sm:flex-col sm:items-end">
                  {view.recommended === m.key && <Badge tone="safe">{t('app.planflow.recommended')}</Badge>}
                  <Badge tone={st.tone}>{t(`app.planflow.status.${st.key}`)}</Badge>
                </div>
              </div>
              <div className="mt-4 flex items-end justify-between gap-3">
                <div>
                  <p className="num text-figure-sm">{num(m.probability * 100, 0)}%</p>
                  <p className="text-micro text-mute-night">
                    {preserve ? t('app.goal.beatInflation') : t('app.goal.chanceOnTime')}
                  </p>
                </div>
                <div className="text-right text-label">
                  <p className="text-mute-night">{t('app.planflow.worst5')}</p>
                  <p className="num">{m.worst5_loss_gel >= 1 ? `−${money({ amount: m.worst5_loss_gel, currency: 'GEL' })}` : t('app.planflow.noLoss')}</p>
                </div>
                <div className="text-right text-label">
                  <p className="text-mute-night">{t('app.planflow.replay')}</p>
                  <p className={`num ${m.replay_2015_gel < 0 ? 'text-caution-300' : 'text-accent-300'}`}>
                    {m.replay_2015_gel >= 0 ? '+' : '−'}{money({ amount: Math.abs(m.replay_2015_gel), currency: 'GEL' })}
                  </p>
                </div>
              </div>
              <div className="mt-4">
                <AllocationBar
                  showLegend={false}
                  slices={Object.entries(m.weights)
                    .filter(([, w]) => w > 0.005)
                    .sort((a, b) => b[1] - a[1])
                    .map(([k, w]) => ({ asset: k, share: w, label: L(view.assets.find((a) => a.key === k) ?? { name_en: k, name_ka: k }, 'name') }))}
                />
              </div>
              {(m.compliance.blocked || m.compliance.needs_acknowledgment.length > 0) && (
                <p className="mt-3 text-micro text-caution-300">
                  {m.compliance.checks
                    .filter((c) => c.status !== 'pass')
                    .map((c) => `${c.rule}: ${L(c, 'title')}`)
                    .join(' · ')}
                </p>
              )}
            </button>
          );
        })}
      </div>

      {fm && (
        <section className="mt-6" aria-labelledby="allocation-amounts">
          <h2 id="allocation-amounts" className="mb-2 text-heading">{t('app.planflow.amountsTitle')}</h2>
          <p className="mb-4 text-label text-mute-night">{t('app.planflow.amountsNote')}</p>
          <Card>
            <dl className="divide-y divide-line-night">
              {Object.entries(fm.weights).filter(([, w]) => w > 0)
                .sort((a, b) => b[1] - a[1]).map(([key, weight]) => {
                  const asset = view.assets.find((a) => a.key === key);
                  return (
                    <div key={key} className="flex items-start justify-between gap-4 py-3 first:pt-0">
                      <dt className="min-w-0 text-label">
                        {asset ? L(asset, 'name') : key}
                        <span className="mt-1 block text-micro text-mute-night">{num(weight * 100, 1)}%</span>
                      </dt>
                      <dd className="num shrink-0 text-body">{money({ amount: weight * p.ingestion.totals.assets_gel, currency: 'GEL' })}</dd>
                    </div>
                  );
                })}
            </dl>
            <p className="mt-2 border-t border-line-night pt-3 text-micro text-mute-night">
              {t('app.planflow.reserveIncluded', { amount: money({ amount: p.liquidity.buffer_gel, currency: 'GEL' }) })}
            </p>
          </Card>
        </section>
      )}

      {fm && (
        <Card className="mt-4">
          <p className="text-label font-medium">{t('app.planflow.capacityTitle')}</p>
          <div className="mt-2">
            <RiskScale selected={fm.level} capacity={view.capacity.level} />
          </div>
          <p className="mt-2 text-micro text-mute-night">
            {t('app.planflow.capacityNote', { level: fm.level, capacity: view.capacity.level, cap: num(view.capacity.equity_cap * 100, 0) })}
          </p>
          {view.behaviour_score != null && (
            <p className="mt-2 text-label text-paper/80">{t('app.planflow.behaviour', { score: num(view.behaviour_score, 0) })}</p>
          )}
          <p className="mt-3 text-micro text-mute-night">{L(view.recommendation_text)}</p>
        </Card>
      )}
    </>
  );
}

function StressStep() {
  const { t, L, money, num } = useI18n();
  const { session, missionKey: mission, monthly } = useSession();
  const funds = useApi<FundsView>(
    () => api.funds(session!, monthly ?? undefined, mission ?? undefined),
    [mission, monthly],
  );
  const market = useApi(() => api.market());
  if (!session || !mission) return <Loading />;
  if (!funds.data) return <Loading blocks={[160, 260]} />;
  const f = funds.data;
  const episodeName = (code: string) => {
    const ep = (market.data?.episodes as { code: string; ka: string; en: string }[] | undefined)?.find((e) => e.code === code);
    return ep ? L(ep) : code;
  };
  const episodeRow = (code: string) => {
    const v = f.plan.episodes[code as keyof typeof f.plan.episodes];
    return { code, name: episodeName(code), v };
  };

  return (
    <>
      <PageTitle title={t('app.planflow.stressTitle')} lead={t('app.planflow.stressLead')} />
      <Card>
        <p className="text-label text-mute-night">{t('app.planflow.episodesTitle')}</p>
        <ul className="mt-3 space-y-2.5">
          {(['S08', 'S15', 'S20', 'S22'] as const).map((code) => {
            const { name, v } = episodeRow(code);
            return (
              <li key={code} className="flex items-baseline justify-between gap-3 text-label">
                <span className="min-w-0 text-paper/85">{name}</span>
                <span className={`num shrink-0 ${v < 0 ? 'text-caution-300' : 'text-accent-300'}`}>
                  {v >= 0 ? '+' : '−'}{num(Math.abs(v) * 100, 0)}%
                </span>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-micro text-mute-night">{t('app.planflow.episodesNote')}</p>
      </Card>

      <SectionLabel>{t('app.planflow.fundsTitle')}</SectionLabel>
      <Card>
        <ul className="space-y-3">
          {f.funds.map((fund) => (
            <li key={fund.key} className="border-b border-line-night pb-3 last:border-0 last:pb-0">
              <div className="flex items-baseline justify-between gap-3">
                <p className="min-w-0 truncate text-body">{L(fund, 'name')}</p>
                <p className="num shrink-0 text-label">{num(fund.probability * 100, 0)}%</p>
              </div>
              <div className="mt-1 flex items-baseline justify-between gap-3 text-micro text-mute-night">
                <span className="min-w-0 truncate">{L(fund, 'desc')}</span>
                <span className="num shrink-0">
                  {t('app.planflow.badCase')} −{money({ amount: fund.worst5_shortfall_gel, currency: 'GEL' })}
                </span>
              </div>
              <div className="mt-1 flex gap-3 text-micro text-mute-night">
                {(['S08', 'S15', 'S20', 'S22'] as const).map((code) => (
                  <span key={code} className="num">
                    {code.replace('S', "'")} {fund.episodes[code] >= 0 ? '+' : '−'}{num(Math.abs(fund.episodes[code]) * 100, 0)}%
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-micro text-mute-night">{L(f, 'disclaimer')}</p>
        <p className="mt-1 text-micro text-mute-night">{f.source}</p>
      </Card>
      <Link to="/app/stocks" className="mt-3 flex items-center justify-between gap-3 rounded-card border border-line-night bg-night-1 p-4 transition-colors hover:border-paper/30">
        <span className="text-label">{t('app.planflow.stocksLink')}</span>
        <ArrowRight size={16} className="text-mute-night" />
      </Link>
    </>
  );
}

function DecideStep() {
  return <Decide />;
}

/** The plan flow: buffer → mission → stress → decide. */
export default function PlanFlow() {
  const { step } = useParams();
  const { t } = useI18n();
  const { profile, chosen, missionKey, choose } = useSession();
  const navigate = useNavigate();
  const current = (STEPS as readonly string[]).includes(step ?? '') ? (step as StepId) : null;
  if (!current) return <Navigate to="/app/plan/buffer" replace />;
  if (!profile) return <Screen><Loading /></Screen>;

  const idx = STEPS.indexOf(current);
  const next = STEPS[idx + 1];
  const canContinue = current === 'mission' ? !!missionKey : true;
  const goNext = () => {
    // Continuing from the mission step without tapping a card keeps the mission shown as selected.
    if (current === 'mission' && !chosen && missionKey) choose(missionKey);
    navigate(`/app/plan/${next}`);
  };

  return (
    <Screen>
      <Stepper step={current} />
      {current === 'buffer' && <BufferStep />}
      {current === 'mission' && <MissionStep />}
      {current === 'stress' && <StressStep />}
      {current === 'decide' && <DecideStep />}
      <ActionBar sticky={current !== 'decide'}>
        {next ? (
          <Button variant="accent" size="lg" onClick={goNext} disabled={!canContinue}>
            {t('app.next')}
          </Button>
        ) : (
          <Button variant="inverse" size="lg" onClick={() => navigate('/app/plan')}>
            {t('app.planflow.backToGoal')}
          </Button>
        )}
        {idx > 0 && (
          <Button variant="quiet" size="lg" onClick={() => navigate(`/app/plan/${STEPS[idx - 1]}`)}>
            {t('app.back')}
          </Button>
        )}
      </ActionBar>
    </Screen>
  );
}
