/**
 * Demo deep link: /app/demo/:persona?timeout=<bank>&next=<path>
 *
 * Creates a real consent session for a demo persona or organiser customer with
 * all their banks and scopes, stores it, prefetches the profile, then lands on
 * `next` (default /app). Used for rehearsals, tests and the video.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { Badge, Card, Loading, PageTitle, Screen } from '../../components/app/kit';
import { useI18n } from '../../i18n';
import { ApiError, api } from '../../services/backend';
import { useSession } from '../../state/SessionContext';

export function DemoLink() {
  const { t, L } = useI18n();
  const { findPersona, personas, organisers, connect, finishConnect } = useSession();
  const { persona: personaId = '' } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const [err, setErr] = useState<string | null>(null);
  const ran = useRef(false);
  const listsLoaded = personas !== null && organisers !== null;

  useEffect(() => {
    if (!listsLoaded || ran.current) return;
    ran.current = true;
    const p = findPersona(personaId);
    if (!p) {
      setErr(t('app.demo.unknown', { id: personaId }));
      return;
    }
    const timeout = search.get('timeout');
    const next = search.get('next');
    const target = next && next.startsWith('/app') ? next : '/app';
    api
      .consent({
        persona_id: p.id,
        banks: p.banks.map((b) => b.code),
        scopes: ['balances', 'transactions', 'deposits', 'loans'],
        duration_days: 90,
        cash_at_home: null,
        simulate_timeout: timeout || null,
      })
      .then(async (session) => {
        connect(p, session);
        await api.profile(session).catch(() => null);
        finishConnect();
        navigate(target, { replace: true });
      })
      .catch((e) => setErr(e instanceof ApiError ? e.message : String(e)));
  }, [listsLoaded, personaId]); // eslint-disable-line react-hooks/exhaustive-deps

  const label = findPersona(personaId);
  return (
    <Screen>
      <PageTitle title={t('app.demo.title')} lead={t('app.demo.desc')} />
      <div className="flex flex-col items-center gap-3 pt-8">
        <Badge tone="neutral">{t('app.demo.synthetic')}</Badge>
        {label && <Badge tone="neutral">{L(label, 'name')}</Badge>}
      </div>
      {!err && <Loading blocks={[80, 40]} />}
      {err && (
        <Card tone="caution" className="mt-6">
          <p className="text-body" role="alert">{err}</p>
          <Button variant="inverse" className="mt-4" onClick={() => navigate('/app/welcome', { replace: true })}>
            {t('app.welcome.pickCustomer')}
          </Button>
        </Card>
      )}
    </Screen>
  );
}
