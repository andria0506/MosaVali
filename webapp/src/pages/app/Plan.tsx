import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronRight, FlaskConical, Gauge, PencilLine, ShieldCheck, Signature, Waves } from 'lucide-react';
import { api } from '../../services/backend';
import { useApi } from '../../services/useApi';
import { useI18n } from '../../i18n';
import { useSession } from '../../state/SessionContext';
import { Button, ButtonLink } from '../../components/ui/Button';
import { assetColor } from '../../components/app/charts';
import { RiskScale } from '../../components/app/RiskScale';
import { Badge, Loading, ModelChip, Screen } from '../../components/app/kit';
import { BarRow, KV, Kpis, More, Page, PageHead, Panel, Ring, th } from '../../components/app/dash';
import { STOCKS } from '../../lib/stocks';
import type { StockCheck, StockProfile } from '../../types';

const CAPACITY_PARTS = ['horizon', 'buffer', 'stability', 'age', 'obligations'] as const;
const STOCK_PROFILES: StockProfile[] = ['big_tech', 'ge_bank'];
/** Share of the invested part the stock rows assume (the backend allows 5–30%). */
const STOCK_SHARE = 0.1;
const STOCK_GRID = 'grid-cols-1 sm:grid-cols-[1.6fr_1fr_1fr_1fr] sm:items-center';

/**
 * Plan, in the order a decision is made:
 *   1. what you can invest — free money now and the monthly amount, within the spending model's limit;
 *   2. how risky it is — your capacity against the mission's level, bad-case loss, the lari replay,
 *      where the money would go, and what single stocks would add (stock-check model, exploration only);
 *   3. your goal — chance on time and the levers that would get there, then the approval flow.
 * The four plan steps and the crisis simulator sit behind "show more".
 */
export default function Plan() {
  const { t, L, goalName, money, num } = useI18n();
  const { session, profile: p, missions: view, missionsLoading, monthly, missionKey, setMonthly } = useSession();
  const [draft, setDraft] = useState<number | null>(monthly);
  const saved = useApi(() => (session ? api.trades(session) : Promise.resolve(null)), [session?.consent_id, missionKey, monthly]);
  useEffect(() => setDraft(monthly), [monthly]);
  useEffect(() => {
    if (draft === null || draft === monthly) return;
    const id = setTimeout(() => setMonthly(draft), 350);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  if (!p) return <Screen><Loading /></Screen>;

  const gel = (amount: number) => money({ amount, currency: 'GEL' });
  const pct = (x: number) => `${num(x * 100, 0)}%`;
  const liq = p.liquidity;
  const cap = p.profile.capacity;
  const goal = p.profile.goal;
  const preserve = goal.kind === 'preserve';
  const limit = p.spending.affordable_monthly_gel;
  const maxMonthly = Math.max(200, Math.ceil((Math.max(limit, p.default_monthly) * 1.6) / 50) * 50);
  const mission = view?.missions.find((m) => m.key === missionKey);
  const lev = view?.levers;
  // Round the model's suggested total up to the slider's step; keep it inside the server's limit.
  const suggestedMonthly = lev?.extra_monthly != null && view ? Math.ceil((view.monthly + lev.extra_monthly) / 10) * 10 : null;
  const canUseSuggestion =
    suggestedMonthly !== null && suggestedMonthly > (monthly ?? 0) && suggestedMonthly <= limit && suggestedMonthly <= 100_000;
  const noneReach = view?.recommendation_reason === 'none_reach';
  const quick = [0, 0.5, 1, 1.5]
    .map((f) => ({ f, v: Math.max(0, Math.floor((limit * f) / 10) * 10) }))
    .filter((qk, i, arr) => arr.findIndex((x) => x.v === qk.v) === i);
  const goalAmount = goal.amount_usd ? money({ amount: goal.amount_usd, currency: 'USD' }) : gel(goal.amount_gel ?? 0);
  const trades = saved.data?.mission === missionKey ? saved.data?.trades ?? [] : [];
  const approved = trades.filter((tr) => tr.status === 'approved').length;
  const warned = mission && (mission.compliance.blocked || mission.compliance.needs_acknowledgment.length > 0);
  const overCapacity = !!mission && !!view && mission.level > view.capacity.level;
  const total = p.ingestion.totals.assets_gel;
  const slices = mission
    ? Object.entries(mission.weights)
        .filter(([, w]) => w > 0.005)
        .sort((a, b) => b[1] - a[1])
        .map(([k, w]) => ({
          key: k,
          label: L(view!.assets.find((a) => a.key === k) ?? { name_en: k, name_ka: k }, 'name'),
          value: w * total,
          color: assetColor[k] ?? '#8C8F8E',
        }))
    : [];

  return (
    <Page>
      <PageHead title={t('app.planTab.title')} sub={t('app.planTab.lead')} />

      {/* 1 — What you can invest */}
      <StepHead n={1} title={t('app.planTab.s1Title')} sub={t('app.planTab.s1Sub')} />
      <Kpis
        items={[
          { label: t('app.home.free'), value: gel(liq.free_to_invest_gel), tone: liq.free_to_invest_gel > 0 ? 'safe' : undefined, sub: t('app.planTab.freeSub') },
          { label: t('app.home.monthlyLimit'), value: gel(limit), sub: t('app.analysis.perMonth') },
          { label: t('app.home.protected'), value: gel(liq.buffer_gel), sub: t('app.home.protectedSub') },
        ]}
      />
      {liq.buffer_shortfall_gel > 0 && (
        <Panel tone="caution" className="mt-3">
          <p className="text-label">{t('app.planTab.shortfall', { amount: gel(liq.buffer_shortfall_gel) })}</p>
        </Panel>
      )}
      <Panel className="mt-4" title={t('app.goal.monthlyTitle')} sub={t('app.goal.limitNote', { limit: gel(limit) })}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <p className="num text-figure">{gel(draft ?? 0)}</p>
          {!preserve && (
            <div className="flex flex-wrap gap-1.5">
              {quick.map((qk) => (
                <button
                  key={qk.v}
                  type="button"
                  onClick={() => setDraft(qk.v)}
                  className={`min-h-[2.25rem] rounded-full border px-3.5 text-micro transition-colors ${
                    draft === qk.v ? 'border-accent-400 bg-accent-400/10 text-paper' : 'border-line-night text-mute-night hover:text-paper'
                  }`}
                >
                  {qk.f === 0 ? '0' : qk.f === 1 ? t('app.goal.limitChip') : `${qk.f * 100}%`}
                </button>
              ))}
            </div>
          )}
        </div>
        <input
          type="range"
          min={0}
          max={maxMonthly}
          step={10}
          value={draft ?? 0}
          disabled={preserve}
          aria-label={t('app.goal.monthlyTitle')}
          onChange={(e) => setDraft(Number(e.target.value))}
          className="mt-4 w-full accent-accent-400"
        />
        {!preserve && (draft ?? 0) > limit + 1e-6 && <p className="mt-2 text-label text-caution-300">{t('app.goal.aboveLimit')}</p>}
        <Link to="/app/analysis#buffer" className="mt-3 inline-flex min-h-tap items-center gap-1 text-label text-accent-300 hover:text-accent-400">
          {t('app.planTab.howMeasured')} <ArrowRight size={14} />
        </Link>
      </Panel>

      {/* 2 — How risky it is */}
      <StepHead n={2} title={t('app.planTab.s2Title')} sub={t('app.planTab.s2Sub')} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2" title={t('app.planTab.riskTitle')} action={<ModelChip label={t('app.planTab.simulated')} />}>
          {view && mission ? (
            <>
              <div className="-mt-1">
                <RiskScale selected={mission.level} capacity={view.capacity.level} />
              </div>
              <p className={`mt-3 text-label ${overCapacity ? 'text-caution-300' : 'text-paper/85'}`}>
                {overCapacity
                  ? t('app.planTab.overCapacity', { level: mission.level, cap: view.capacity.level })
                  : t('app.planTab.withinCapacity', { level: mission.level, cap: view.capacity.level })}
              </p>
              <div className="mt-4 border-t border-line-night pt-3">
                <KV
                  rows={[
                    { label: t('app.planTab.worst'), value: mission.worst5_loss_gel >= 1 ? `−${gel(mission.worst5_loss_gel)}` : t('app.planflow.noLoss'), tone: mission.worst5_loss_gel >= 1 ? 'caution' : 'safe' },
                    { label: t('app.planTab.lari2015'), value: `${mission.replay_2015_gel >= 0 ? '+' : '−'}${gel(Math.abs(mission.replay_2015_gel))}`, tone: mission.replay_2015_gel < 0 ? 'caution' : 'safe' },
                    { label: t('app.planTab.shareCap'), value: pct(view.capacity.equity_cap) },
                  ]}
                />
              </div>
              <More inline label={t('app.planTab.capacityWhy')} lessLabel={t('app.more.less')}>
                <div className="mt-1">
                  {CAPACITY_PARTS.map((k) => (
                    <BarRow key={k} label={t(`app.profile.parts.${k}`)} share={cap.parts[k]} tone={cap.parts[k] < 0.4 ? 'caution' : 'safe'} value={pct(cap.parts[k])} />
                  ))}
                </div>
              </More>
              <div className="mt-4 flex flex-wrap gap-2">
                <ButtonLink to="/app/plan/mission" variant="inverse">
                  <Gauge size={16} /> {t('app.planTab.changeMix')}
                </ButtonLink>
                <ButtonLink to="/app/plan/stress" variant="inverse">
                  <Waves size={16} /> {t('app.planTab.stressCta')}
                </ButtonLink>
              </div>
            </>
          ) : (
            <Loading blocks={[160]} />
          )}
        </Panel>

        <Panel title={t('app.planTab.mixTitle')} sub={mission ? L(mission, 'objective') : undefined}>
          {slices.length ? (
            <Ring centerLabel={mission ? L(mission) : ''} centerValue={gel(total)} slices={slices} legendValue={(_, s) => pct(s)} />
          ) : (
            <Loading blocks={[140]} />
          )}
        </Panel>

        <StockRisk />
      </div>

      {/* 3 — Your goal */}
      <StepHead
        n={3}
        title={t('app.planTab.s3Title')}
        sub={t('app.planTab.s3Sub')}
        action={
          <ButtonLink to="/app/plan/edit" variant="inverse">
            <PencilLine size={16} /> {t('app.goal.editGoal')}
          </ButtonLink>
        }
      />
      <Panel
        title={
          <span className="flex flex-wrap items-center gap-2">
            {goalName(goal)}
            {p.goal_source === 'organiser_assumed' && <Badge tone="caution">{t('app.goal.assumed')}</Badge>}
          </span>
        }
        sub={`${goalAmount} · ≈ ${gel(goal.target_today_gel)} ${t('app.planTab.today')} · ${t('goals.inYears', { n: goal.years })}`}
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-micro text-mute-night">{preserve ? t('app.planTab.chanceInflation') : t('app.planTab.chance')}</p>
            <p className={`num mt-1 text-figure ${mission && mission.probability >= 0.8 ? 'text-accent-300' : mission && mission.probability < 0.4 ? 'text-caution-300' : ''}`}>
              {mission ? pct(mission.probability) : '…'}
            </p>
            <p className="mt-1 text-micro text-mute-night">
              {missionsLoading ? t('app.goal.recalc') : t('app.planTab.chanceWith', { amount: gel(monthly ?? 0) })}
            </p>
          </div>
          <ButtonLink to="/app/plan/buffer" variant="accent" aria-disabled={missionsLoading || draft !== monthly}>
            {t('app.goal.buildPlan')} <ArrowRight size={16} />
          </ButtonLink>
        </div>

        {lev && mission && (
          <div className="mt-5 border-t border-line-night pt-4">
            <p className="text-micro uppercase tracking-[0.06em] text-mute-night">{t('app.goal.leversTitle')}</p>
            {lev.on_track ? (
              <p className="mt-2 text-body text-accent-300">{t('app.goal.onTrack', { pct: num(lev.probability * 100, 0) })}</p>
            ) : (
              <div className="mt-3 grid grid-cols-3 gap-3">
                <Lever label={t('app.goal.leverMore')} value={lev.extra_monthly == null ? '–' : `+${gel(lev.extra_monthly)}`} />
                <Lever label={t('app.goal.leverTime')} value={lev.extra_months ? `+${num(lev.extra_months / 12, 1)} ${t('common.years')}` : '–'} />
                <Lever label={t('app.goal.leverCheaper')} value={lev.cheaper_target_by ? `−${gel(lev.cheaper_target_by)}` : '–'} />
              </div>
            )}
            {lev.savings_boost && !lev.on_track && (
              <p className="mt-3 text-label text-paper/80">
                {t('app.goal.finderBoost', { amount: gel(lev.savings_boost.extra_monthly), pct: num(lev.savings_boost.probability * 100, 0) })}
              </p>
            )}
            {!lev.on_track && canUseSuggestion && (
              <Button
                variant="inverse"
                className="mt-4"
                disabled={missionsLoading || draft !== monthly}
                onClick={() => {
                  setDraft(suggestedMonthly!);
                  setMonthly(suggestedMonthly!);
                }}
              >
                {t('app.goal.useAmount', { amount: gel(suggestedMonthly!) })}
              </Button>
            )}
            {!lev.on_track && suggestedMonthly !== null && suggestedMonthly > limit && (
              <p className="mt-3 text-label text-caution-300">{t('app.goal.suggestionOverLimit')}</p>
            )}
          </div>
        )}
        {view && (
          <p className={`mt-4 border-t border-line-night pt-3 text-micro ${noneReach ? 'text-caution-300' : 'text-mute-night'}`}>{L(view.recommendation_text)}</p>
        )}
      </Panel>

      <More label={t('app.planTab.moreSteps')} lessLabel={t('app.more.less')}>
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Panel flush className="lg:col-span-2" title={t('app.planTab.yourPlan')} sub={t('app.planTab.stepsSub')}>
            <div className="divide-y divide-line-night/70 border-t border-line-night">
              <StepRow n={1} to="/app/plan/buffer" icon={<ShieldCheck size={16} />} title={t('app.planflow.steps.buffer')} value={gel(liq.buffer_gel)} />
              <StepRow n={2} to="/app/plan/mission" icon={<Gauge size={16} />} title={t('app.planflow.steps.mission')} value={mission ? L(mission) : '…'} caution={!!warned} />
              <StepRow n={3} to="/app/plan/stress" icon={<Waves size={16} />} title={t('app.planflow.steps.stress')} value={t('app.planTab.crises')} />
              <StepRow
                n={4}
                to="/app/plan/decide"
                icon={<Signature size={16} />}
                title={t('app.planflow.steps.decide')}
                value={trades.length ? t('app.planTab.approved', { n: approved, total: trades.length }) : t('app.planTab.notStarted')}
              />
            </div>
          </Panel>

          <Link to="/app/sandbox" className="block rounded-[1.25rem] border border-line-night bg-gradient-to-br from-accent-400/[0.10] via-night-1 to-night-1 p-5 transition-colors hover:border-paper/25">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-400/15 text-accent-300">
              <FlaskConical size={18} />
            </span>
            <span className="mt-4 block text-body">{t('app.sim.title')}</span>
            <span className="mt-1 block text-label text-mute-night">
              {view?.behaviour_score != null ? t('app.planflow.behaviour', { score: num(view.behaviour_score, 0) }) : t('app.planTab.simBody')}
            </span>
            <span className="mt-4 inline-flex items-center gap-1 text-label text-accent-300">
              {t('app.planTab.simCta')} <ArrowRight size={16} />
            </span>
          </Link>
        </div>
      </More>
    </Page>
  );
}

/** Numbered section heading, so the page reads as 1 → 2 → 3. */
function StepHead({ n, title, sub, action }: { n: number; title: string; sub: string; action?: ReactNode }) {
  return (
    <div className={`mb-3 flex flex-wrap items-end justify-between gap-3 ${n > 1 ? 'mt-10' : ''}`}>
      <div className="flex min-w-0 items-start gap-3">
        <span className="num mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-400/15 text-micro text-accent-300">{n}</span>
        <div className="min-w-0">
          <h2 className="text-body-lg">{title}</h2>
          <p className="text-label text-mute-night">{sub}</p>
        </div>
      </div>
      {action}
    </div>
  );
}

/**
 * What single stocks would add to this plan: the backend's stock-check model per stock type, with
 * STOCK_SHARE of the invested part moved into it. Exploration only — a stock never enters the plan.
 */
function StockRisk() {
  const { t, num } = useI18n();
  return (
    <Panel flush className="lg:col-span-3" title={t('app.planTab.stocksTitle')} sub={t('app.planTab.stocksSub', { pct: num(STOCK_SHARE * 100, 0) })} action={<ModelChip label={t('app.planTab.simulated')} />}>
      {/* Columns on wider screens; on phones each stock type stacks its three figures under its name. */}
      <div className={`${STOCK_GRID} hidden border-b border-line-night sm:grid`}>
        <span className={th}>{t('app.stocks.colType')}</span>
        <span className={`${th} text-right`}>{t('app.stocks.rowHalving')}</span>
        <span className={`${th} text-right`}>{t('app.planTab.badYear')}</span>
        <span className={`${th} text-right`}>{t('app.stocks.rowChance')}</span>
      </div>
      <div className="divide-y divide-line-night/70 border-t border-line-night sm:border-t-0">
        {STOCK_PROFILES.map((k) => (
          <StockRiskRow key={k} profile={k} />
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-night px-5 py-3">
        <p className="text-micro text-mute-night">{t('app.stocks.prod01')}</p>
        <Link to="/app/stocks" className="inline-flex min-h-tap items-center gap-1 text-label text-accent-300 hover:text-accent-400">
          {t('app.planTab.toStocks')} <ArrowRight size={14} />
        </Link>
      </div>
    </Panel>
  );
}

function StockRiskRow({ profile }: { profile: StockProfile }) {
  const { t, num } = useI18n();
  const { session, missionKey: mission, monthly } = useSession();
  const check = useApi<StockCheck | null>(
    () => (session && mission ? api.stockCheck(session, profile, STOCK_SHARE, mission, monthly ?? undefined) : Promise.resolve(null)),
    [session?.consent_id, profile, mission, monthly],
  );
  const c = check.data;
  const pct = (x: number) => `${num(x * 100, 0)}%`;
  const tickers = STOCKS.filter((s) => s.profile === profile).map((s) => s.ticker.replace('.L', ''));
  const dash = <span className="text-mute-night">{check.loading ? '…' : '—'}</span>;
  const cell = (label: string, value: ReactNode, tone = '') => (
    <div className="flex items-baseline justify-between gap-3 px-5 py-1 sm:block sm:py-3 sm:text-right">
      <span className="text-micro text-mute-night sm:hidden">{label}</span>
      <span className={`num text-label ${tone}`}>{value}</span>
    </div>
  );
  return (
    <div className={`${STOCK_GRID} grid py-2 sm:py-0`}>
      <div className="px-5 py-2 sm:py-3">
        <span className="block text-label text-paper/90">{t(`app.stocks.profiles.${profile}`)}</span>
        <span className="block text-micro text-mute-night">{tickers.join(' · ')}</span>
      </div>
      {cell(t('app.stocks.rowHalving'), c ? pct(c.stock.halving_probability) : dash, 'text-caution-300')}
      {cell(t('app.planTab.badYear'), c ? `${c.stock.worst_year_p5 < 0 ? '−' : '+'}${num(Math.abs(c.stock.worst_year_p5) * 100, 0)}%` : dash, 'text-caution-300')}
      {cell(
        t('app.stocks.rowChance'),
        c ? (
          <>
            <span className="text-mute-night">{pct(c.plan.probability)} → </span>
            <span className={c.with_stock.probability < c.plan.probability ? 'text-caution-300' : 'text-accent-300'}>{pct(c.with_stock.probability)}</span>
          </>
        ) : (
          dash
        ),
      )}
    </div>
  );
}

function Lever({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-line-night bg-night-2/60 p-3">
      <p className="truncate text-micro text-mute-night">{label}</p>
      <p className="num mt-1 truncate text-body-lg">{value}</p>
    </div>
  );
}

/** One plan step as a table row; its value shows the current choice so the plan reads at a glance. */
function StepRow({ n, to, icon, title, value, caution = false }: { n: number; to: string; icon: ReactNode; title: string; value: string; caution?: boolean }) {
  return (
    <Link to={to} className="flex min-h-[3.5rem] items-center gap-3 px-5 py-3 transition-colors hover:bg-night-2/70">
      <span className="num w-4 shrink-0 text-micro text-mute-night">{n}</span>
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${caution ? 'bg-caution-400/15 text-caution-300' : 'bg-night-3 text-paper/80'}`}>
        {icon}
      </span>
      <span className="min-w-0 flex-1 text-label">{title}</span>
      <span className={`min-w-0 truncate text-right text-label ${caution ? 'text-caution-300' : 'text-mute-night'}`}>{value}</span>
      <ChevronRight size={16} className="shrink-0 text-mute-night" />
    </Link>
  );
}
