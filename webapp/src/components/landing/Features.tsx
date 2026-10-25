import type { ReactNode } from 'react';
import { CalendarCheck, ChartPie, Info, LineChart, Lock, Newspaper, Target, User, type LucideIcon } from 'lucide-react';
import { api } from '../../services/backend';
import { getDemo } from '../../services/demo';
import { useApi } from '../../services/useApi';
import { useI18n } from '../../i18n';
import type { Tone } from '../../types';
import { RiskScale } from '../app/RiskScale';
import { Reveal } from '../ui/Reveal';
import { SectionHeading } from './SectionHeading';

/** The five app tabs as a dark bento grid; every visual renders backend output for the demo persona. */
export function Features() {
  const { t } = useI18n();
  return (
    <section id="features" className="scroll-mt-20 bg-night py-section text-paper">
      <div className="mx-auto max-w-page px-4 sm:px-6 lg:px-10">
        <SectionHeading dark eyebrow={t('landing.features.eyebrow')} title={t('landing.features.title')} />
        <div className="mt-14 grid gap-4 md:mt-20 md:grid-cols-2 lg:grid-cols-6">
          <Reveal className="lg:col-span-3">
            <BentoCard tab="analysis" icon={ChartPie} title={t('landing.features.buffer.title')} body={t('landing.features.buffer.body')}>
              <BufferVisual />
            </BentoCard>
          </Reveal>
          <Reveal className="lg:col-span-3" delay={80}>
            <BentoCard tab="profile" icon={User} title={t('landing.features.risk.title')} body={t('landing.features.risk.body')}>
              <RiskVisual />
            </BentoCard>
          </Reveal>
          <Reveal className="md:col-span-2 lg:col-span-4" delay={80}>
            <BentoCard tab="plan" icon={Target} title={t('landing.features.stress.title')} body={t('landing.features.stress.body')}>
              <StressVisual />
            </BentoCard>
          </Reveal>
          <Reveal className="md:col-span-2 lg:col-span-2" delay={160}>
            <BentoCard tab="news" icon={Newspaper} title={t('landing.features.monitor.title')} body={t('landing.features.monitor.body')}>
              <MonitorVisual />
            </BentoCard>
          </Reveal>
          <Reveal className="md:col-span-2 lg:col-span-6" delay={80}>
            <BentoCard tab="stocks" icon={LineChart} title={t('landing.features.stocks.title')} body={t('landing.features.stocks.body')}>
              <StocksVisual />
            </BentoCard>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function BentoCard({ tab, icon: Icon, title, body, children }: { tab: string; icon: LucideIcon; title: string; body: string; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <article className="flex h-full flex-col rounded-card-lg border border-line-night bg-night-1 p-6 md:p-8">
      <p className="mb-4 inline-flex w-fit items-center gap-2 rounded-full bg-night-2 px-3 py-1 text-micro text-mute-night">
        <Icon size={14} className="text-accent-400" />
        {t(`tabs.${tab}`)}
      </p>
      <h3 className="text-balance text-heading font-normal">{title}</h3>
      <p className="mt-3 max-w-md text-label text-mute-night md:text-body">{body}</p>
      <div className="mt-8 flex flex-1 flex-col justify-end">{children}</div>
    </article>
  );
}

function Skeleton({ h = 120 }: { h?: number }) {
  return <div className="animate-pulse rounded-card bg-night-2" style={{ height: h }} />;
}

// ---------- Buffer ----------

function BufferVisual() {
  const { t, money } = useI18n();
  const demo = useApi(getDemo);
  const d = demo.data;
  if (!d) return <Skeleton />;
  const liq = d.profile.liquidity;
  const share = (liq.buffer_gel / Math.max(1, d.profile.ingestion.totals.assets_gel)) * 100;

  return (
    <div className="rounded-card bg-night-2 p-5">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <p className="flex items-center gap-2 text-micro text-mute-night">
            <span className="h-2 w-2 rounded-full bg-accent-400" />
            {t('buffer.protected')}
          </p>
          <p className="num mt-1 text-figure">{money({ amount: liq.buffer_gel, currency: 'GEL' })}</p>
        </div>
        <div className="text-right">
          <p className="flex items-center justify-end gap-2 text-micro text-mute-night">
            <span className="h-2 w-2 rounded-full bg-paper/50" />
            {t('buffer.free')}
          </p>
          <p className="num mt-1 text-figure-sm text-paper/80">{money({ amount: liq.free_to_invest_gel, currency: 'GEL' })}</p>
        </div>
      </div>
      <div className="mt-4 flex h-3 gap-[3px]">
        <span className="rounded-l-full bg-accent-400" style={{ width: `${share}%` }} />
        <span className="flex-1 rounded-r-full bg-paper/35" />
      </div>
      <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-night-3 px-3 py-1.5 text-micro text-mute-night">
        <Lock size={13} className="text-accent-400" />
        {t('landing.features.buffer.locked')}
      </p>
    </div>
  );
}

// ---------- Risk: capacity vs the recommended mission ----------

function RiskVisual() {
  const { t, L, num } = useI18n();
  const demo = useApi(getDemo);
  const d = demo.data;
  if (!d) return <Skeleton />;
  const rec = d.missions.missions.find((m) => m.key === d.missions.recommended)!;

  return (
    <div className="rounded-card bg-night-2 p-5">
      <RiskScale selected={rec.level} capacity={d.missions.capacity.level} />
      <div className="mt-5 rounded-2xl border border-accent-400/25 bg-accent-400/[0.07] p-4">
        <p className="flex items-center gap-2 text-label font-medium text-accent-300">
          <Info size={16} className="shrink-0" />
          {t('landing.preview.recommended', { name: L(rec) })}
        </p>
        <p className="mt-2 text-label text-paper/85">{L(rec, 'objective')}</p>
        <p className="mt-3 flex flex-wrap justify-between gap-x-3 text-micro text-mute-night">
          {t('app.goal.chanceOnTime')}
          <span className="num text-accent-300">{num(rec.probability * 100, 0)}%</span>
        </p>
      </div>
    </div>
  );
}

// ---------- Stress: the plan's four crisis episodes ----------

const SCALE_PCT = 40; // a ±40% change fills half the bar

function StressVisual() {
  const { t, num } = useI18n();
  const demo = useApi(getDemo);
  const d = demo.data;
  if (!d) return <Skeleton h={220} />;
  const episodes = d.funds.plan.episodes;

  return (
    <div className="rounded-card bg-night-2 p-5">
      <ul className="space-y-5">
        {(['S08', 'S15', 'S20', 'S22'] as const).map((code) => {
          const pct = episodes[code] * 100;
          const width = `${(Math.min(Math.abs(pct), SCALE_PCT) / SCALE_PCT) * 50}%`;
          return (
            <li key={code}>
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-label">{t(`landing.episodes.${code}`)}</span>
                <span className="num shrink-0 text-label">
                  {pct > 0 ? '+' : '−'}
                  {num(Math.abs(pct))}%
                </span>
              </div>
              <div className="relative mt-2 h-2 rounded-full bg-night-3">
                <span className="absolute inset-y-[-3px] left-1/2 w-px bg-paper/30" />
                <span
                  className={`absolute inset-y-0 rounded-full transition-all duration-500 ${
                    pct >= 0 ? 'left-1/2 bg-accent-400' : 'right-1/2 bg-paper/55'
                  }`}
                  style={{ width }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-6 text-micro text-mute-night">{t('landing.features.stress.note')}</p>
    </div>
  );
}

// ---------- Stocks: the stock-check model on the demo plan ----------

function StocksVisual() {
  const { t, num, money } = useI18n();
  const demo = useApi(getDemo);
  const d = demo.data;
  const check = useApi(
    () => {
      if (!d) return Promise.resolve(undefined);
      // The captured snapshot carries its own stock check; a live session asks the API.
      if (!d.session) return Promise.resolve(d.stockCheck);
      return api.stockCheck(d.session, 'big_tech', 0.2, d.missions.recommended, d.profile.default_monthly);
    },
    [d?.session?.consent_id, d?.stockCheck],
  );
  const c = check.data;
  if (!c) return <Skeleton h={140} />;
  const rows = [
    { label: t('landing.features.stocks.plan'), value: c.plan.probability, bad: c.plan.worst5_shortfall_gel, accent: true },
    { label: t('landing.features.stocks.withStock'), value: c.with_stock.probability, bad: c.with_stock.worst5_shortfall_gel, accent: false },
  ];
  return (
    <div className="grid gap-5 rounded-card bg-night-2 p-5 md:grid-cols-[1fr_auto] md:items-end md:gap-10">
      <ul className="space-y-4">
        {rows.map((r) => (
          <li key={r.label}>
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-label">{r.label}</span>
              <span className="num shrink-0 text-label">{num(r.value * 100, 0)}%</span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-night-3">
              <span className={`block h-full rounded-full ${r.accent ? 'bg-accent-400' : 'bg-paper/55'}`} style={{ width: `${r.value * 100}%` }} />
            </div>
            <p className="num mt-1.5 text-micro text-mute-night">
              {t('landing.features.stocks.badCase', { amount: money({ amount: r.bad, currency: 'GEL' }) })}
            </p>
          </li>
        ))}
      </ul>
      <p className="inline-flex w-fit items-center gap-2 rounded-full bg-night-3 px-3 py-1.5 text-micro text-mute-night">
        <LineChart size={13} className="shrink-0 text-accent-400" />
        {t('landing.features.stocks.chip', { pct: num(c.stock.halving_probability * 100, 0) })}
      </p>
    </div>
  );
}

// ---------- Monitoring ----------

function MonitorVisual() {
  const { t, L } = useI18n();
  const demo = useApi(getDemo);
  const alerts = demo.data?.profile.profile.alerts;
  if (!alerts) return <Skeleton h={200} />;
  const toneOf = (tone: string): Tone => (tone === 'critical' || tone === 'warn' ? 'caution' : 'neutral');

  return (
    <ul className="space-y-2">
      {alerts.slice(0, 2).map((a, i) => {
        const caution = toneOf(a.tone) === 'caution';
        const Icon = caution ? Info : CalendarCheck;
        return (
          <li key={i} className="flex items-center gap-3 rounded-2xl bg-night-2 p-3">
            <span
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                caution ? 'bg-caution-400/15 text-caution-300' : 'bg-night-3 text-paper/80'
              }`}
            >
              <Icon size={16} />
            </span>
            <span className="text-label leading-snug">{L(a)}</span>
          </li>
        );
      })}
      <li className="flex items-center gap-3 rounded-2xl border border-dashed border-line-night p-3 opacity-60">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-night-2">
          <CalendarCheck size={16} className="text-mute-night" />
        </span>
        <span className="min-w-0">
          <span className="num block text-label text-mute-night line-through">{t('landing.features.monitor.noise')}</span>
          <span className="block text-micro text-mute-night">{t('landing.features.monitor.noiseLabel')}</span>
        </span>
      </li>
    </ul>
  );
}
