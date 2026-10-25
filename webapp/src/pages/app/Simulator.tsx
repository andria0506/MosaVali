/**
 * Crisis simulator — /app/sandbox:
 * pick a mission and a crisis, replay it month by month with 10,000 virtual
 * lari, decide at the hard moments, get a behaviour score the compliance
 * agent uses (BEH-01). All numbers come from the backend sandbox endpoints.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, X } from 'lucide-react';
import { Line, LineChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '../../components/ui/Button';
import { Badge, Card, PageTitle, Screen, SectionLabel, Segmented, Stat } from '../../components/app/kit';
import { useI18n } from '../../i18n';
import { api } from '../../services/backend';
import { useSession } from '../../state/SessionContext';
import type { ChapterCode, Flight, MissionKey } from '../../types';

const MISSIONS: MissionKey[] = ['protect', 'goal', 'balance', 'growth'];
const CRISES: { key: ChapterCode | 'ALL'; months: number }[] = [
  { key: 'S08', months: 12 }, { key: 'S15', months: 16 }, { key: 'S20', months: 12 }, { key: 'S22', months: 12 }, { key: 'ALL', months: 52 },
];
const ACTIONS = ['hold', 'sell', 'rebalance', 'buy'] as const;
const SPEED: Record<string, number> = { '1': 150, '2': 60 };
const GHOST_COLORS: Record<string, string> = { protect: '#7BD8A8', goal: '#4FC48A', balance: '#E6E6E3', growth: '#8C8F8E' };

function flightPoints(f: Flight, shown: number) {
  return f.history.slice(0, Math.max(1, shown)).map((p) => ({
    month: p.month, bp: Math.round(p.buying_power), passive: Math.round(p.passive_buying_power),
    ...(p.ghosts
      ? Object.fromEntries(Object.entries(p.ghosts).map(([k, v]) => [`g_${k}`, Math.round(v)]))
      : {}),
  }));
}

export default function Simulator() {
  const { t, L, money, num } = useI18n();
  const { session, profile, missions, chosen, missionKey, choose, flight: f, setFlight, refreshMissions } = useSession();
  const navigate = useNavigate();
  const usdGoal = (profile?.profile.goal.usd_indexed ?? 0) >= 0.5;
  const suggested: ChapterCode | 'ALL' = usdGoal ? 'S15' : 'S22';
  // Defaults follow the data once it has loaded (e.g. after a page reload) until the customer picks.
  const [missionPick, setMission] = useState<MissionKey | null>(null);
  const [crisisPick, setCrisis] = useState<ChapterCode | 'ALL' | null>(null);
  const mission: MissionKey = missionPick ?? missionKey ?? 'goal';
  const crisis: ChapterCode | 'ALL' = crisisPick ?? suggested;
  const [setup, setSetup] = useState(!f);
  const [busy, setBusy] = useState(false);
  const [speed, setSpeed] = useState<'1' | '2'>('1');
  const [ghosts, setGhosts] = useState(true);
  const [paused, setPaused] = useState(false);
  const [shown, setShown] = useState(f?.history.length ?? 0);
  const refreshed = useRef(false);

  const advance = async (flight: Flight, action: string) => {
    if (!session) return;
    setBusy(true);
    try {
      const snap = await api.flightStep(session, flight.id, action, true);
      setFlight(snap);
      setPaused(false);
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  };
  const start = async (m = mission, c = crisis) => {
    if (!session) return;
    setBusy(true);
    try {
      const snap = await api.flightStart(session, m, c === 'ALL' ? undefined : [c as ChapterCode]);
      setFlight(snap);
      setShown(1);
      setSetup(false);
      setPaused(false);
      await advance(snap, 'hold');
    } catch (e) {
      console.error(e);
      setBusy(false);
    }
  };

  // Reveal the months the server already played, one by one — the line draws like a replay.
  useEffect(() => {
    if (!f || paused || shown >= f.history.length) return;
    const t = setTimeout(() => setShown((s) => Math.min(f.history.length, s + 1)), SPEED[speed]);
    return () => clearTimeout(t);
  }, [f, shown, paused, speed]);
  useEffect(() => {
    if (f && shown > f.history.length) setShown(f.history.length);
  }, [f, shown]);
  // Behaviour score changed → refresh missions so BEH-01 reflects it.
  useEffect(() => {
    if (f?.done && !refreshed.current) {
      refreshed.current = true;
      void refreshMissions();
    }
    if (!f?.done) refreshed.current = false;
  }, [f?.done]); // eslint-disable-line react-hooks/exhaustive-deps

  const goDecide = () => {
    choose(chosen ?? f?.mission ?? mission);
    navigate('/app/plan/decide');
  };
  const mLabel = (k: MissionKey) => {
    const m = missions?.missions.find((x) => x.key === k);
    return m ? L(m) : t(`app.sim.missions.${k}`);
  };

  if (setup || !f) {
    return (
      <Screen>
        <PageTitle title={t('app.sim.title')} lead={t('app.sim.lead')} />
        <Card>
          <p className="text-label font-medium text-mute-night">{t('app.sim.stepMission')}</p>
          <div className="mt-2">
            <Segmented
              label={t('app.sim.stepMission')}
              value={mission}
              onChange={setMission}
              options={MISSIONS.map((k) => ({ id: k, label: missions?.missions.find((x) => x.key === k) ? L(missions.missions.find((x) => x.key === k)!) : t(`app.sim.missions.${k}`) }))}
            />
          </div>
          <p className="mt-5 text-label font-medium text-mute-night">{t('app.sim.stepCrisis')}</p>
          <div className="mt-2 grid gap-3">
            {CRISES.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setCrisis(c.key)}
                className={`rounded-2xl border px-4 py-3 text-left transition-colors ${
                  crisis === c.key ? 'border-accent-400 bg-accent-400/10' : 'border-line-night bg-night-1 hover:border-paper/30'
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <b className="text-label font-medium">{t(`app.sim.crises.${c.key}.title`)}</b>
                  {c.key === suggested && <Badge tone="safe">{t('app.sim.bestTest')}</Badge>}
                </span>
                <span className="mt-1 block text-micro text-mute-night">{t(`app.sim.crises.${c.key}.desc`)}</span>
              </button>
            ))}
          </div>
          <Button variant="accent" size="lg" className="mt-5 w-full" onClick={() => void start()} disabled={busy}>
            {t('app.sim.start')}
          </Button>
        </Card>
        <Card className="mt-3">
          <p className="text-label font-medium">{t('app.sim.howTitle')}</p>
          <ol className="mt-3 space-y-3">
            {[1, 2, 3].map((i) => (
              <li key={i} className="flex gap-3 text-label text-mute-night">
                <span className="num flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-night-3 text-micro">{i}</span>
                <span>{t(`app.sim.how${i}`)}</span>
              </li>
            ))}
          </ol>
          {missions?.behaviour_score != null && (
            <p className="mt-4 rounded-2xl border border-accent-400/25 bg-accent-400/[0.07] p-3 text-label text-accent-300">
              {t('app.sim.currentScore', { score: num(missions.behaviour_score, 0) })}
            </p>
          )}
          <p className="mt-4 text-micro text-mute-night">{t('app.sim.howNote')}</p>
        </Card>
      </Screen>
    );
  }

  const revealing = shown < f.history.length;
  const points = flightPoints(f, shown);
  const last = f.history[Math.min(Math.max(1, shown), f.history.length) - 1];
  const change = last ? last.buying_power / 10000 - 1 : 0;
  const decision = f && !revealing && !f.done ? f.decision : null;
  const r = f && !revealing ? f.result : null;
  const coach = f.coach.filter((c) => points.some((p) => p.month === c.month) || !revealing).slice(-1)[0];
  const actionMonths = new Set(f.history.slice(0, Math.max(1, shown)).map((p) => p.month));
  const actionMarks = f.actions.filter((a) => actionMonths.has(a.month));

  return (
    <Screen>
      <PageTitle title={t('app.sim.title')} />
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral">{mLabel(f.mission)}</Badge>
        <Badge tone="neutral">{t('app.sim.month', { n: Math.max(0, shown - 1), total: f.months })}</Badge>
      </div>

      <Card className="mt-4">
        <div className="flex items-end justify-between gap-3">
          <Stat
            label={t('app.sim.buyingPower')}
            value={money({ amount: Math.round(last?.buying_power ?? 10000), currency: 'GEL' })}
            sub={<span className={change >= 0 ? 'text-accent-300' : 'text-caution-300'}>{change >= 0 ? '+' : '−'}{num(Math.abs(change) * 100, 1)}%</span>}
          />
          <div className="flex flex-col items-end gap-2">
            <Segmented label={t('app.sim.speed')} value={speed} onChange={(v) => setSpeed(v)} options={[{ id: '1', label: '1×' }, { id: '2', label: '2×' }]} />
            <label className="flex cursor-pointer items-center gap-2 text-micro text-mute-night">
              <input type="checkbox" checked={ghosts} onChange={(e) => setGhosts(e.target.checked)} className="h-4 w-4 accent-accent-400" />
              {t('app.sim.otherMissions')}
            </label>
          </div>
        </div>
        <p className="mt-1 text-micro text-mute-night">
          {last?.month === 'start' ? t('app.sim.startLabel') : last?.month} · 1 USD = {last?.fx.toFixed(2)} GEL
        </p>
        <div className="mt-3 h-52">
          <ResponsiveContainer>
            <LineChart data={points} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#9AA19E' }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={30} />
              <YAxis hide domain={['dataMin - 400', 'dataMax + 400']} />
              <Tooltip
                cursor={{ stroke: '#9AA19E', strokeWidth: 1, strokeDasharray: '3 3' }}
                content={({ active, payload, label }) =>
                  active && payload?.length ? (
                    <div className="rounded-xl border border-line-night bg-night-2 px-3 py-2 text-label shadow-lg">
                      <p className="text-micro text-mute-night">{label}</p>
                      {payload.slice(0, 2).map((p) => (
                        <p key={String(p.dataKey)} className="num text-paper">{money({ amount: Number(p.value), currency: 'GEL' })}</p>
                      ))}
                    </div>
                  ) : null
                }
              />
              {ghosts &&
                MISSIONS.filter((m) => m !== f.mission).map((m) => (
                  <Line key={m} type="monotone" dataKey={`g_${m}`} stroke={GHOST_COLORS[m]} strokeOpacity={0.25} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                ))}
              <Line type="monotone" dataKey="passive" stroke="#8C8F8E" strokeDasharray="4 4" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="bp" stroke="#4FC48A" strokeWidth={2.5} dot={false} isAnimationActive={false} />
              {actionMarks.map((a, i) => (
                <ReferenceDot key={i} x={a.month} y={points.find((p) => p.month === a.month)?.bp ?? 0} r={4} fill="#E6E6E3" stroke="#151817" />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-1 text-micro text-mute-night">{t('app.sim.chartNote')}</p>
        {revealing && (
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-micro text-mute-night">{t('app.sim.month', { n: Math.max(0, shown - 1), total: f.months })}</span>
            <div className="flex gap-2">
              <Button variant="inverse" size="md" onClick={() => setPaused((v) => !v)}>{paused ? t('app.sim.play') : t('app.sim.pause')}</Button>
              <Button variant="inverse" size="md" onClick={() => setShown(f.history.length)}>{t('app.sim.skip')}</Button>
            </div>
          </div>
        )}
        {coach && !decision && !r && (
          <p className="mt-3 rounded-2xl bg-night-2 p-3 text-label text-paper/85"><Badge tone="neutral">AI</Badge> <span className="ml-2">{L(coach)}</span></p>
        )}

        {decision && (
          <div className="mt-4 rounded-card border border-caution-400/30 bg-caution-400/[0.06] p-5" role="dialog" aria-label={t('app.sim.decision')}>
            <p className="text-label text-mute-night">{decision.month} · {L(decision, 'chapter')}</p>
            <h3 className="mt-1 text-title">{L(decision, 'context')}</h3>
            <div className="mt-3 grid grid-cols-2 gap-2 text-label sm:grid-cols-4">
              <p>{t('app.sim.facts.shares')} <b className="num">{num(decision.equity_since_start * 100, 0)}%</b></p>
              <p>{t('app.sim.facts.lari')} <b className="num">{num(decision.lari_since_start * 100, 0)}%</b> · {num(decision.fx_level, 2)}</p>
              <p>{t('app.sim.facts.prices')} <b className="num">+{num(decision.prices_since_start * 100, 0)}%</b></p>
              <p>
                {t('app.sim.facts.portfolio')}{' '}
                <b className={`num ${decision.drawdown > 0.03 ? 'text-caution-300' : ''}`}>−{num(decision.drawdown * 100, 1)}%</b>
              </p>
            </div>
            <p className="mt-4 text-body font-medium">{t('app.sim.whatDo')}</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {ACTIONS.map((key) => {
                const av = f.available[key];
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={busy || !av.ok}
                    title={av.ok ? undefined : L(av, 'reason')}
                    onClick={() => void advance(f, key)}
                    className={`min-h-tap rounded-2xl border px-3 py-2.5 text-left transition-colors disabled:opacity-50 ${
                      av.ok ? 'border-line-night bg-night-1 hover:border-accent-400' : 'border-line-night/60 bg-night-1'
                    }`}
                  >
                    <b className="block text-label">{t(`app.sim.actions.${key}.title`)}</b>
                    <span className="mt-0.5 block text-micro text-mute-night">{av.ok ? t(`app.sim.actions.${key}.desc`) : L(av, 'reason')}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </Card>

      {r ? (
        <>
          <SectionLabel>{t('app.sim.debriefTitle')}</SectionLabel>
          <Card>
            <div className="flex items-center gap-5">
              <div className="relative flex h-24 w-24 shrink-0 items-center justify-center rounded-full border-4 border-accent-400/60">
                <span className="num text-figure-sm">{r.score === null ? '—' : num(r.score, 0)}</span>
              </div>
              <div>
                <p className="text-body">
                  {r.score === null
                    ? t('app.sim.noVerdict')
                    : r.panic_sells
                      ? t('app.sim.sold')
                      : t('app.sim.held')}
                </p>
                <p className="mt-1 text-micro text-mute-night">
                  {r.score === null ? t('app.sim.noVerdictSub') : t('app.sim.beh01')}
                </p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4 border-t border-line-night pt-4">
              <Stat label={t('app.sim.maxDrop')} value={`−${num(r.max_drawdown * 100, 1)}%`} size="md" tone={r.max_drawdown > 0.05 ? 'caution' : undefined} />
              <Stat
                label={t('app.sim.vsHolding')}
                value={<span className={r.actions_cost_gel > 1 ? 'text-caution-300' : r.actions_cost_gel < -1 ? 'text-accent-300' : ''}>{r.actions_cost_gel >= 0 ? '−' : '+'}{money({ amount: Math.abs(r.actions_cost_gel), currency: 'GEL' })}</span>}
                size="md"
              />
            </div>
            <div className="mt-4">
              <p className="text-label text-mute-night">{t('app.sim.fitsTitle')}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {MISSIONS.map((k) => (
                  <span key={k} className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-label ${r.fits.includes(k) ? 'border-accent-400/40 text-accent-300' : 'border-line-night text-mute-night'}`}>
                    {r.fits.includes(k) ? <Check size={14} /> : <X size={14} />} {mLabel(k)}
                  </span>
                ))}
              </div>
            </div>
            <div className="mt-4">
              <p className="text-label text-mute-night">{t('app.sim.ghostTitle')}</p>
              <ul className="mt-2 space-y-1.5">
                {MISSIONS.map((k) => {
                  const v = r.ghost_buying_power[k] ?? 10000;
                  return (
                    <li key={k} className="flex items-baseline justify-between text-label">
                      <span className={k === f.mission ? 'text-accent-300' : 'text-mute-night'}>{mLabel(k)}{k === f.mission ? ` · ${t('app.sim.yourMission')}` : ''}</span>
                      <span className="num">{money({ amount: Math.round(v), currency: 'GEL' })}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="mt-4">
              <p className="text-label text-mute-night">{t('app.sim.coachTitle')}</p>
              <div className="mt-2 space-y-2">
                {[...f.coach].reverse().slice(0, 4).map((c, i) => (
                  <p key={i} className="rounded-2xl bg-night-2 p-3 text-label text-paper/85"><span className="text-micro text-mute-night">{c.month}</span> · {L(c)}</p>
                ))}
              </div>
            </div>
          </Card>
          <div className="mt-4 flex flex-col gap-2">
            <Button variant="inverse" size="lg" onClick={() => setSetup(true)}>{t('app.sim.another')}</Button>
            <Button variant="accent" size="lg" onClick={goDecide}>{t('app.sim.toDecide')}</Button>
          </div>
        </>
      ) : (
        <div className="mt-4 flex flex-col gap-2">
          <Button variant="inverse" size="lg" onClick={() => setSetup(true)}>{t('app.sim.newRun')}</Button>
          <Button variant="accent" size="lg" onClick={goDecide}>{t('app.sim.toDecide')}</Button>
        </div>
      )}
      <p className="mt-4 text-micro text-mute-night">{f.source}</p>
    </Screen>
  );
}
