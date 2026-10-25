/**
 * Decide — the last plan-flow step:
 * why this plan (explain), compliance guardrails with explicit acknowledgements,
 * POST /plan, per-trade approve / reject / edit, then a signed-ready instruction.
 * The AI never executes; every action here is a proposal the customer approves.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Info, Printer, ShieldCheck, X } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Badge, Card, Loading, PageTitle, SectionLabel, Stat } from '../../components/app/kit';
import { AllocationBar } from '../../components/app/charts';
import { useI18n } from '../../i18n';
import { ApiError, api, errorMessage } from '../../services/backend';
import { useSession } from '../../state/SessionContext';
import type { Check, Explanation, Instruction, Trade } from '../../types';

const TRADE_TONE: Record<Trade['status'], 'safe' | 'caution' | 'neutral'> = {
  proposed: 'neutral', approved: 'safe', rejected: 'neutral', edited: 'caution', blocked: 'caution',
};

function checkIcon(status: Check['status']) {
  if (status === 'pass') return <ShieldCheck size={18} className="shrink-0 text-accent-400" />;
  if (status === 'block') return <X size={18} className="shrink-0 text-caution-300" />;
  return <Info size={18} className={`shrink-0 ${status === 'warn' ? 'text-caution-300' : 'text-paper/70'}`} />;
}

function CheckRow({ c }: { c: Check }) {
  const { L } = useI18n();
  return (
    <div className="flex items-start gap-3">
      {checkIcon(c.status)}
      <div className="min-w-0">
        <p className="text-label">
          <span className="num text-mute-night">{c.rule}</span> · <b className="font-medium">{L(c, 'title')}</b>
        </p>
        <p className="mt-0.5 text-micro text-mute-night">{L(c)}</p>
      </div>
    </div>
  );
}

/** Parse the backend's 409/422 bodies into a readable, localised message. */
function parseErr(e: unknown, L: ReturnType<typeof useI18n>['L'], t: ReturnType<typeof useI18n>['t']): { text: string; reconfirm: boolean } {
  if (e instanceof ApiError) {
    const b = e.body as {
      error?: string; missing?: string[]; checks?: Check[]; compliance?: { blocking_rules?: string[] };
      trade?: { checks?: Check[] };
    };
    const checks = b.checks ?? b.trade?.checks;
    if (checks?.length) {
      const texts = checks.filter((c) => c.status !== 'pass').map((c) => L(c));
      return { text: texts.length ? texts.join(' ') : L(checks[0]), reconfirm: false };
    }
    if (b.missing?.length) return { text: t('app.decide.errMissing', { rules: b.missing.join(', ') }), reconfirm: true };
    if (b.compliance) return { text: t('app.decide.errReconfirm'), reconfirm: true };
    return { text: b.error ?? e.message, reconfirm: false };
  }
  return { text: String(e), reconfirm: false };
}

function TradeCard({ trade: tr, step, onChange }: { trade: Trade; step: number; onChange: (t: Trade) => void }) {
  const { t, L, num, locale } = useI18n();
  const { session, missions } = useSession();
  const [amount, setAmount] = useState(tr.amount_gel);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ text: string; reconfirm: boolean } | null>(null);
  useEffect(() => setAmount(tr.amount_gel), [tr.amount_gel]);
  const navigate = useNavigate();

  const act = async (decision: 'approve' | 'reject' | 'edit') => {
    if (!session) return;
    setBusy(true);
    setErr(null);
    try {
      onChange(await api.trade(session, tr.id, decision, decision === 'edit' ? amount : undefined));
    } catch (e) {
      setErr(parseErr(e, L, t));
      // A blocked trade still updated server-side: reflect its new status/checks.
      const updated = e instanceof ApiError ? (e.body.trade as Trade | undefined) : undefined;
      if (updated) onChange(updated);
    } finally {
      setBusy(false);
    }
  };

  const dirty = Math.abs(amount - tr.amount_gel) >= 0.005;
  const invalidAmount = !Number.isFinite(amount) || amount < 0.01 || amount > 10_000_000;
  const usd = missions?.market.fx_spot ?? 2.7;
  return (
    <Card className={tr.status === 'approved' ? 'border-accent-400/40' : ''}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-label text-mute-night">
          {t('app.decide.stepN', { n: step })} · {tr.kind === 'recurring' ? t('app.decide.monthlyStep') : t('app.decide.oneOffStep')}
        </span>
        <Badge tone={TRADE_TONE[tr.status]}>{t(`app.decide.status.${tr.status}`)}</Badge>
      </div>
      <div className="mt-3 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-micro text-mute-night">{t('app.decide.from')}</p>
          <p className="text-label">
            {(locale === 'ka' ? tr.from.bank_ka : tr.from.bank) || '—'} · {L(tr.from, 'product')}
          </p>
          <p className="num mt-0.5 text-micro text-mute-night">{tr.from.iban !== '—' ? tr.from.iban : tr.from.currency}</p>
        </div>
        <ArrowRight size={18} className="mt-3 shrink-0 text-mute-night" />
        <div className="min-w-0 flex-1">
          <p className="text-micro text-mute-night">{t('app.decide.to')}</p>
          <p className="text-label">{L(tr, 'asset')}</p>
          <p className="mt-0.5 text-micro text-mute-night">{L(tr, 'when')}</p>
        </div>
      </div>
      <p className="mt-3 text-label text-paper/85">{L(tr, 'action')}</p>
      {tr.kind === 'recurring' && tr.split && (
        <div className="mt-3">
          <AllocationBar
            showLegend={false}
            slices={Object.entries(tr.split).map(([k, w]) => ({ asset: k, share: w, label: k }))}
          />
          <p className="mt-1.5 text-micro text-mute-night">
            {Object.entries(tr.split)
              .map(([k, w]) => `${missions?.assets.find((a) => a.key === k)?.code ?? k} ${num(w * 100, 0)}%`)
              .join(' · ')}
          </p>
        </div>
      )}
      {tr.checks.length > 0 && (
        <div className="mt-3 space-y-2 border-t border-line-night pt-3">
          {tr.checks.map((c) => <CheckRow key={c.rule} c={c} />)}
        </div>
      )}
      {err && (
        <Card tone="caution" className="mt-3">
          <p className="text-label" role="alert">{err.text}</p>
          {err.reconfirm ? (
            <Button variant="inverse" size="md" className="mt-3" onClick={() => navigate('/app/plan/mission')}>
              {t('app.decide.backToChecks')}
            </Button>
          ) : (
            <p className="mt-1 text-micro text-mute-night">{t('app.decide.errChange')}</p>
          )}
        </Card>
      )}
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="w-36">
          <span className="block text-micro text-mute-night">
            {tr.kind === 'recurring' ? t('app.decide.gelPerMonth') : t('app.decide.amount')}
          </span>
          <input
            type="number" min={0.01} max={10_000_000} step={0.01} value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            disabled={tr.status === 'approved'}
            className="num mt-1 w-full rounded-xl border border-line-night bg-night-2 px-3 py-2 text-body focus:border-accent-400 focus:outline-none"
          />
          <span className="mt-1 block text-micro text-mute-night">≈ ${num(amount / usd, 0)}</span>
        </label>
        <div className="flex flex-1 flex-wrap gap-2">
          {dirty && (
            <Button variant="inverse" size="md" onClick={() => void act('edit')} disabled={busy || invalidAmount}>{t('app.decide.save')}</Button>
          )}
          <Button variant="accent" size="md" onClick={() => void act('approve')} disabled={busy || dirty || tr.status === 'approved' || tr.status === 'blocked'}>
            {t('app.decide.approve')}
          </Button>
          <Button variant="inverse" size="md" onClick={() => void act('reject')} disabled={busy || tr.status === 'rejected'}>
            {t('app.decide.reject')}
          </Button>
        </div>
      </div>
    </Card>
  );
}

export function DecideStep() {
  const { t, L, money, num, locale } = useI18n();
  const { session, profile, missions, monthly, missionKey: chosen, choose, plan, setPlan } = useSession();
  const navigate = useNavigate();
  const [exp, setExp] = useState<Explanation | null>(null);
  const [expError, setExpError] = useState<unknown>(null);
  const [expAttempt, setExpAttempt] = useState(0);
  const [acks, setAcks] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmErr, setConfirmErr] = useState<string | null>(null);
  const [doc, setDoc] = useState<Instruction | null>(null);
  const [docErr, setDocErr] = useState<string | null>(null);
  const mission = missions?.missions.find((m) => m.key === chosen);

  useEffect(() => {
    if (!session || !chosen) return;
    let active = true;
    setExp(null);
    setExpError(null);
    api.explain(session, chosen, monthly ?? undefined)
      .then((result) => { if (active) setExp(result); })
      .catch((error) => { if (active) setExpError(error); });
    return () => { active = false; };
  }, [session, chosen, monthly, expAttempt]);
  useEffect(() => { setAcks([]); setDoc(null); }, [chosen, monthly]);
  // After a reload the drafted trades still live on the backend: bring them back for the confirmed mission.
  useEffect(() => {
    if (!session || plan || !mission || missions?.selected !== mission.key) return;
    let active = true;
    api.trades(session).then((r) => {
      if (active && r.mission === mission.key && r.monthly === monthly && r.trades.length)
        setPlan((current) => current ?? { mission, trades: r.trades, levers: missions.levers, acknowledged: [], monthly: r.monthly ?? 0 });
    }).catch(() => undefined);
    return () => { active = false; };
  }, [session, plan, mission, missions, monthly, setPlan]);

  if (!chosen || !mission) {
    return (
      <>
        <PageTitle title={t('app.planflow.decideTitle')} />
        <Card tone="caution"><p className="text-body">{t('app.decide.noMission')}</p></Card>
      </>
    );
  }

  const comp = mission.compliance;
  const needs = comp.needs_acknowledgment;
  const monthlyNow = monthly ?? profile?.default_monthly ?? 0;
  const overBudget = !!profile && monthlyNow > profile.spending.affordable_monthly_gel + 1e-6;
  const ready = !comp.blocked && !overBudget && needs.every((r) => acks.includes(r));
  const approved = plan?.trades.filter((x) => x.status === 'approved').length ?? 0;
  const assets = missions?.assets ?? [];
  const phiAssets = exp ? Object.keys(exp.final_weights).filter((k) => Object.values(exp.phi).some((row) => Math.abs(row[k] ?? 0) >= 0.02)) : [];

  const confirm = async () => {
    if (!session) return;
    setBusy(true);
    setConfirmErr(null);
    try {
      setPlan(await api.plan(session, chosen, acks, monthly ?? undefined));
      setDoc(null);
    } catch (e) {
      setConfirmErr(parseErr(e, L, t).text);
    } finally {
      setBusy(false);
    }
  };
  const updateTrade = (x: Trade) => {
    setPlan((current) => current ? { ...current, trades: current.trades.map((p) => p.id === x.id ? x : p) } : current);
    setDoc(null);
  };
  const prepare = async () => {
    if (!session) return;
    setDocErr(null);
    try {
      setDoc(await api.instruction(session));
    } catch (e) {
      setDocErr(parseErr(e, L, t).text);
    }
  };

  return (
    <>
      <PageTitle title={t('app.planflow.decideTitle')} lead={t('app.decide.lead', { mission: L(mission) })} />

      <Card>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div className="col-span-2 sm:col-span-1">
            <Stat label={t('app.decide.summary.mission')} value={<span className="text-figure-sm">{L(mission)}</span>} />
          </div>
          <Stat label={t('app.decide.summary.monthly')} value={money({ amount: monthlyNow, currency: 'GEL' })} size="md" />
          <Stat label={t('app.decide.summary.chance')} value={`${num(mission.probability * 100, 0)}%`} size="md" />
        </div>
        <div className="mt-4">
          <AllocationBar
            showLegend
            slices={Object.entries(mission.weights)
              .filter(([, w]) => w > 0.004)
              .sort((a, b) => b[1] - a[1])
              .map(([k, w]) => ({ asset: k, share: w, label: L(assets.find((a) => a.key === k) ?? { name_en: k, name_ka: k }, 'name') }))}
          />
        </div>
      </Card>

      <SectionLabel>{t('app.decide.whyTitle')}</SectionLabel>
      <Card>
        <p className="text-micro text-mute-night">{t('app.decide.whySub')}</p>
        {expError ? (
          <div role="alert" className="mt-3">
            <p className="text-label text-caution-300">{errorMessage(expError, (o) => o[locale])}</p>
            <Button variant="inverse" className="mt-3" onClick={() => setExpAttempt((n) => n + 1)}>
              {t('app.decide.retryExplanation')}
            </Button>
          </div>
        ) : !exp ? (
          <Loading blocks={[60, 90, 40]} />
        ) : (
          <div className="mt-4 space-y-4">
            {exp.narrative.filter((s) => s.id === 'goal' || s.id === 'buffer').map((s) => (
              <div key={s.id} className="border-l-2 border-accent-400/40 pl-3">
                <p className="text-label text-paper/90">{L(s)}</p>
              </div>
            ))}
            <details className="border-t border-line-night pt-2">
              <summary className="min-h-tap cursor-pointer py-3 text-label text-accent-300">
                {t('app.decide.fullExplanation')}
              </summary>
              <div className="mt-3 space-y-4">
            {exp.narrative.map((s) => (
              <div key={s.id} className="border-l-2 border-line-night pl-3">
                <p className="text-label text-paper/90">{L(s)}</p>
                {s.evidence.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {s.evidence.map((e, i) => (
                      <span key={i} className="rounded-full bg-night-3 px-2 py-0.5 text-micro">
                        <b className="text-accent-300">{e.code}</b> <span className="num text-paper/80">{e.value}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
              </div>
            </details>
          </div>
        )}
      </Card>

      {exp && phiAssets.length > 0 && (
        <Card className="mt-3">
          <details>
          <summary className="min-h-tap cursor-pointer py-3 text-label font-medium">{t('app.decide.shapleyTitle')}</summary>
          <p className="mt-1 text-micro text-mute-night">
            {t('app.decide.shapleySub', { n: exp.coalitions ?? 16 })}
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-label">
              <thead>
                <tr className="text-micro text-mute-night">
                  <th className="pb-2 pr-3 font-normal">{t('app.decide.shapleyFeature')}</th>
                  {phiAssets.map((k) => (
                    <th key={k} className="pb-2 pr-3 text-right font-normal" title={L(assets.find((a) => a.key === k) ?? { name_en: k, name_ka: k }, 'name')}>
                      {assets.find((a) => a.key === k)?.code ?? k}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {exp.features.map((f) => (
                  <tr key={f.key} className="border-t border-line-night">
                    <td className="py-2 pr-3">
                      <b className="font-medium">{L(f, 'label')}</b>
                      <p className="text-micro text-mute-night">{L(f, 'user')} · {t('app.decide.shapleyRef')} {L(f, 'reference')}</p>
                    </td>
                    {phiAssets.map((k) => {
                      const v = Math.round((exp.phi[f.key][k] ?? 0) * 100);
                      return (
                        <td key={k} className={`num py-2 pr-3 text-right ${v > 0 ? 'text-accent-300' : v < 0 ? 'text-caution-300' : 'text-mute-night'}`}>
                          {v > 0 ? '+' : v < 0 ? '−' : ''}{Math.abs(v)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </details>
        </Card>
      )}

      <SectionLabel>{t('app.decide.guardTitle')}</SectionLabel>
      <Card>
        <p className="text-micro text-mute-night">{t('app.decide.guardSub')}</p>
        <div className="mt-4 space-y-3">
          {comp.checks.map((c) => <CheckRow key={c.rule} c={c} />)}
        </div>
        {comp.blocked && (
          <Card tone="caution" className="mt-4">
            <p className="text-label">{t('app.decide.blockedNote')}</p>
            <Button variant="inverse" size="md" className="mt-3" onClick={() => { choose('protect'); navigate('/app/plan/mission'); }}>
              {t('app.decide.switchProtect')}
            </Button>
          </Card>
        )}
        {!comp.blocked &&
          needs.map((r) => (
            <label key={r} className="mt-3 flex min-h-tap cursor-pointer items-start gap-3 rounded-2xl border border-line-night bg-night-2 px-4 py-3">
              <input
                type="checkbox" checked={acks.includes(r)}
                onChange={(e) => setAcks((v) => (e.target.checked ? [...v, r] : v.filter((x) => x !== r)))}
                className="mt-0.5 h-5 w-5 shrink-0 accent-accent-400"
              />
              <span className="text-label">{t('app.decide.ackLabel', { rule: r })}</span>
            </label>
          ))}
        {overBudget && profile && (
          <Card tone="caution" className="mt-4">
            <p className="text-label">
              {t('app.decide.overLimit', {
                amount: money({ amount: monthlyNow, currency: 'GEL' }),
                limit: money({ amount: profile.spending.affordable_monthly_gel, currency: 'GEL' }),
              })}
            </p>
            <Button variant="inverse" size="md" className="mt-3" onClick={() => navigate('/app/plan')}>
              {t('app.decide.lowerInGoal')}
            </Button>
          </Card>
        )}
        {confirmErr && (
          <Card tone="caution" className="mt-4"><p className="text-label" role="alert">{confirmErr}</p></Card>
        )}
        <Button variant="accent" size="lg" className="mt-5 w-full" onClick={() => void confirm()} disabled={!ready || busy}>
          {t('app.decide.confirm')}
        </Button>
      </Card>

      {plan && (
        <>
          <SectionLabel>{t('app.decide.tradesTitle')}</SectionLabel>
          <p className="-mt-2 mb-3 text-micro text-mute-night">
            {t('app.decide.tradesSub', { chance: num(plan.mission.probability * 100, 0) })}
          </p>
          <div className="space-y-3">
            {plan.trades.length === 0 && <Card><p className="text-body">{t('app.decide.tradesEmpty')}</p></Card>}
            {plan.trades.map((x, i) => <TradeCard key={x.id} trade={x} step={i + 1} onChange={updateTrade} />)}
          </div>
          <div className="mt-4 flex items-center justify-between gap-3">
            <span className="text-label text-mute-night">{t('app.decide.approvedCount', { n: approved, total: plan.trades.length })}</span>
            <Button variant="accent" onClick={() => void prepare()} disabled={approved === 0}>
              <Printer size={16} /> {t('app.decide.prepare')}
            </Button>
          </div>
          {docErr && <Card tone="caution" className="mt-3"><p className="text-label" role="alert">{docErr}</p></Card>}
        </>
      )}

      {doc && (
        <section className="print-area mt-8 rounded-card border border-line-night bg-paper p-6 text-ink">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-title">{t('app.decide.docTitle')} · {doc.id}</h2>
            <Button variant="secondary" size="md" className="no-print" onClick={() => window.print()}>
              <Printer size={16} /> {t('app.decide.print')}
            </Button>
          </div>
          <p className="mt-2 text-label text-ink/70">
            {L(doc, 'client')} · {doc.created} · {t('app.decide.summary.mission')}: {L(doc.mission)} ·{' '}
            {t('app.decide.summary.chance')} {num(doc.mission.probability * 100, 0)}% · 1 USD = {doc.fx_rate} GEL
          </p>
          <table className="mt-4 w-full text-left text-label">
            <thead>
              <tr className="border-b border-ink/20 text-micro text-ink/60">
                <th className="pb-2 pr-3 font-normal">#</th>
                <th className="pb-2 pr-3 font-normal">{t('app.decide.docStep')}</th>
                <th className="pb-2 pr-3 font-normal">{t('app.decide.from')}</th>
                <th className="pb-2 pr-3 font-normal">{t('app.decide.docWhen')}</th>
                <th className="pb-2 text-right font-normal">{t('app.decide.amount')}</th>
              </tr>
            </thead>
            <tbody>
              {doc.steps.map((s, i) => (
                <tr key={s.id} className="border-b border-ink/10 align-top">
                  <td className="num py-2 pr-3 font-medium">
                    {i + 1}
                    <p className="text-micro font-normal text-ink/50">{s.id}</p>
                  </td>
                  <td className="py-2 pr-3">{L(s, 'action')}</td>
                  <td className="py-2 pr-3">
                    {(locale === 'ka' ? s.from.bank_ka : s.from.bank) || '—'} · {L(s.from, 'product')}
                    <p className="num text-micro text-ink/60">{s.from.iban}</p>
                  </td>
                  <td className="py-2 pr-3">{L(s, 'when')}</td>
                  <td className="num py-2 text-right">{money({ amount: s.amount_gel, currency: 'GEL' })}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 flex flex-wrap justify-between gap-3 text-label">
            <p><span className="text-ink/60">{t('app.decide.docTotal')}:</span> <b className="num">{money({ amount: doc.total_gel, currency: 'GEL' })}</b></p>
            <p><span className="text-ink/60">{t('app.decide.docMonthly')}:</span> <b className="num">{money({ amount: doc.monthly_total_gel ?? 0, currency: 'GEL' })}</b></p>
          </div>
          {doc.acknowledged_warnings.length > 0 && (
            <p className="mt-3 text-label text-ink/70">
              {t('app.decide.docWarnings')}: {doc.acknowledged_warnings.join(', ')}
            </p>
          )}
          <p className="mt-4 text-label">{L(doc, 'disclaimer')}</p>
          <p className="mt-1 text-micro text-ink/60">{locale === 'ka' ? doc.disclaimer_en : doc.disclaimer_ka}</p>
          <div className="mt-8 grid grid-cols-2 gap-8">
            <div className="border-t border-ink/40 pt-2 text-label">{t('app.decide.signCustomer')}</div>
            <div className="border-t border-ink/40 pt-2 text-label">{t('app.decide.signPartner')}</div>
          </div>
        </section>
      )}
    </>
  );
}
