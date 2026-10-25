/**
 * Privacy & audit — /app/profile/privacy (Profile → Transparency).
 * The tamper-evident audit log (GET /audit), the model card summary
 * (GET /api/models) and consent revocation with its receipt.
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronLeft, ShieldCheck, X } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Badge, Card, Loading, PageTitle, Screen, SectionLabel, Sheet, Stat } from '../../components/app/kit';
import { useI18n } from '../../i18n';
import { api, errorMessage } from '../../services/backend';
import { useApi } from '../../services/useApi';
import { useSession } from '../../state/SessionContext';
import type { Receipt } from '../../types';

const KNOWN_EVENTS = [
  'consent.granted', 'bank.fetched', 'bank.timeout', 'fallback.partial_data', 'profile.built',
  'goal.updated', 'mission.checked', 'mission.blocked', 'mission.selected', 'warning.acknowledged',
  'trades.proposed', 'trade.approved', 'trade.rejected', 'trade.edited', 'trade.blocked',
  'recurring.blocked', 'instruction.generated', 'explanation.generated', 'funds.compared',
  'simulator.started', 'simulator.action', 'simulator.completed',
  'stock_check.viewed', 'tbc_sandbox.probed', 'consent.revoked',
];
const KNOWN_ACTORS = ['customer', 'compliance_agent', 'execution_agent', 'explainability_agent', 'funds_agent', 'ingestion_agent', 'orchestrator', 'sandbox_agent'];

const shortHash = (h?: string) => (h ? h.slice(0, 12) : '—');
const PURGED_KEYS = ['access_tokens', 'accounts', 'transactions', 'derived_results', 'trade_proposals', 'simulator_runs', 'audit_entries'];
const pad = (n: number) => String(n).padStart(2, '0');
/** Audit timestamps are UTC; show them in the viewer's local time. */
const local = (iso: string) => {
  const d = new Date(iso);
  return { day: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
};

export default function Privacy() {
  const { t, num, date, locale } = useI18n();
  const { session, clearSession } = useSession();
  const navigate = useNavigate();
  const audit = useApi(() => api.audit(session!), [session?.consent_id]);
  const models = useApi(() => api.models());
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const revoke = async () => {
    if (!session) return;
    setBusy(true);
    setErr(null);
    try {
      setReceipt(await api.revoke(session));
      setConfirmRevoke(false);
    } catch (e) {
      setErr(errorMessage(e, (o) => o[locale]));
      setConfirmRevoke(false);
    } finally {
      setBusy(false);
    }
  };
  const leave = () => {
    clearSession();
    navigate('/app/welcome', { replace: true });
  };

  const a = audit.data;
  const m = models.data;
  const diag = m?.liquidity.diagnostics?.reserve_effect?.test;

  return (
    <Screen>
      <Link to="/app/profile" className="-ml-1 mb-2 inline-flex min-h-tap items-center gap-1 text-label text-mute-night hover:text-paper">
        <ChevronLeft size={16} /> {t('app.profileTab.title')}
      </Link>
      <PageTitle title={t('app.privacy.title')} lead={t('app.privacy.lead')} />

      {receipt ? (
        <Card tone="safe">
          <p className="text-heading">{t('app.privacy.revokedTitle')}</p>
          <p className="mt-2 text-label text-mute-night">{t('app.privacy.revokedLead')}</p>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <Stat label={t('app.privacy.receipt.consent')} value={<span className="num text-figure-sm">{receipt.consent_id.slice(0, 8)}…</span>} size="md" />
            <Stat label={t('app.privacy.receipt.at')} value={<span className="num text-figure-sm">{local(receipt.revoked_at).time} · {date(local(receipt.revoked_at).day, 'day')}</span>} size="md" />
            <Stat
              label={t('app.privacy.receipt.purged')}
              value={<span className="num text-figure-sm">{num(Object.values(receipt.purged).reduce((s, v) => s + v, 0), 0)}</span>}
              sub={Object.entries(receipt.purged)
                .map(([k, v]) => `${PURGED_KEYS.includes(k) ? t(`app.privacy.receipt.items.${k}`) : k}: ${num(v, 0)}`)
                .join(' · ')}
              size="md"
            />
            <Stat label={t('app.privacy.receipt.head')} value={<span className="num text-figure-sm">{shortHash(receipt.audit_head)}</span>} size="md" />
          </div>
          <Button variant="accent" size="lg" className="mt-6 w-full" onClick={leave}>{t('app.privacy.revokedDone')}</Button>
        </Card>
      ) : (
        <>
          {/* Verification */}
          <Card>
            {!a ? (
              <Loading blocks={[40]} />
            ) : (
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  {a.verification.valid ? (
                    <ShieldCheck size={22} className="text-accent-400" />
                  ) : (
                    <X size={22} className="text-caution-300" />
                  )}
                  <div>
                    <p className="text-body">
                      {a.verification.valid ? t('app.privacy.verifyOk') : t('app.privacy.verifyBroken', { at: a.verification.broken_at ?? 0 })}
                    </p>
                    <p className="mt-0.5 text-micro text-mute-night">
                      {t('app.privacy.entries', { n: a.entries.length })} · {t('app.privacy.head')}: <span className="num">{shortHash(a.verification.head)}</span>
                    </p>
                  </div>
                </div>
                <Badge tone={a.verification.valid ? 'safe' : 'caution'}>
                  {a.verification.valid ? t('app.privacy.badgeValid') : t('app.privacy.badgeBroken')}
                </Badge>
              </div>
            )}
          </Card>

          {/* Timeline */}
          <SectionLabel>{t('app.privacy.timelineTitle')}</SectionLabel>
          {audit.loading && <Loading blocks={[120, 120]} />}
          {a && (
            <ul className="space-y-2">
              {[...a.entries].reverse().map((e) => (
                <li key={e.seq} className="rounded-2xl border border-line-night bg-night-1 p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-label font-medium">
                      <span className="num text-mute-night">#{e.seq}</span>{' '}
                      {KNOWN_EVENTS.includes(e.event) ? t(`app.privacy.events.${e.event}`) : e.event}
                    </p>
                    <span className="num shrink-0 text-micro text-mute-night">{local(e.ts).time} · {date(local(e.ts).day, 'day')}</span>
                  </div>
                  <p className="mt-1 text-micro text-mute-night">
                    {KNOWN_ACTORS.includes(e.actor) ? t(`app.privacy.actor.${e.actor}`) : e.actor} ·{' '}
                    {Object.entries(e.details)
                      .filter(([, v]) => v !== null && v !== undefined && v !== '' && (!Array.isArray(v) || v.length > 0))
                      .slice(0, 3)
                      .map(([k, v]) => `${k}: ${(Array.isArray(v) ? v.join(', ') : String(v)).slice(0, 60)}`)
                      .join(' · ')}
                  </p>
                  <p className="num mt-1 text-micro text-mute-night">{shortHash(e.hash)}</p>
                </li>
              ))}
            </ul>
          )}

          {/* Model card */}
          <SectionLabel>{t('app.privacy.modelsTitle')}</SectionLabel>
          {models.loading && <Loading blocks={[140, 80]} />}
          {m && (
            <Card>
              <ul className="space-y-2 text-label">
                {([['liquidity', m.liquidity], ['spending', m.spending]] as const).map(([key, card]) => (
                  <li key={key}>
                    <p className="font-medium">{t(`app.privacy.model.${key}`)}</p>
                    <p className="num text-micro text-mute-night">{card.version}</p>
                    <p className="mt-1 text-micro text-mute-night">
                      {t('app.privacy.modelMetrics', {
                        mae: num(card.metrics.test.selected.mae_gel, 0),
                        rmse: num(card.metrics.test.selected.rmse_gel, 0),
                        baseMae: num(card.metrics.test.baseline.mae_gel, 0),
                        coverage: num((card.metrics.test.selected.upper_coverage ?? 0) * 100, 0),
                      })}
                    </p>
                  </li>
                ))}
                <li>
                  <p className="font-medium">{t('app.privacy.model.peers')}</p>
                  <p className="num text-micro text-mute-night">{m.peers.version} · k={m.peers.k}</p>
                  <p className="mt-1 text-micro text-mute-night">{t('app.privacy.peerCaveat')}</p>
                </li>
              </ul>
              {diag && (
                <p className="mt-4 border-t border-line-night pt-3 text-label text-paper/85">
                  {t('app.privacy.diag', {
                    x: num(diag.model_sets_reserve_share * 100, 0),
                    a: num(diag.reserve_coverage_rule_only * 100, 0),
                    b: num(diag.reserve_coverage_with_model * 100, 0),
                  })}
                </p>
              )}
              <p className="mt-2 text-micro text-mute-night">{t('app.privacy.limitations')}</p>
              <p className="mt-1 text-micro text-mute-night">{t('app.privacy.protected')}</p>
              <p className="mt-1 text-micro text-mute-night">{t('app.privacy.synthetic')}</p>
            </Card>
          )}

          {/* Revoke */}
          <SectionLabel>{t('app.privacy.revokeTitle')}</SectionLabel>
          <Card>
            <p className="text-label text-mute-night">{t('app.privacy.revokeLead')}</p>
            {err && <p className="mt-2 text-label text-caution-300" role="alert">{err}</p>}
            <Button variant="inverse" size="lg" className="mt-4 w-full" onClick={() => setConfirmRevoke(true)}>
              {t('app.privacy.revokeAction')}
            </Button>
          </Card>
        </>
      )}

      <Sheet open={confirmRevoke} onClose={() => setConfirmRevoke(false)} title={t('app.privacy.revokeTitle')}>
        <p className="text-body text-mute-night">{t('app.privacy.revokeConfirm')}</p>
        <div className="mt-5 flex gap-3">
          <Button variant="inverse" className="flex-1" onClick={() => setConfirmRevoke(false)}>{t('app.cancel')}</Button>
          <Button variant="accent" className="flex-1" disabled={busy} onClick={() => void revoke()}>{t('app.privacy.revokeYes')}</Button>
        </div>
      </Sheet>
    </Screen>
  );
}
