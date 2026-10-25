import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Check, ShieldCheck } from 'lucide-react';
import { api, errorMessage } from '../../services/backend';
import { useI18n } from '../../i18n';
import { useSession } from '../../state/SessionContext';
import type { Goal, Persona } from '../../types';
import { Button } from '../../components/ui/Button';
import { ActionBar, Card, Field, MoneyInput, PageTitle, Screen, Segmented } from '../../components/app/kit';

const REQUIRED_SCOPES = ['balances', 'transactions'] as const;
const OPTIONAL_SCOPES = ['deposits', 'loans'] as const;
const DURATIONS = [30, 90, 180] as const;

function ScopeRow({ title, why, locked, checked, onChange }: {
  title: string; why: string; locked?: boolean; checked: boolean; onChange?: (v: boolean) => void;
}) {
  const { t } = useI18n();
  return (
    <label className={`flex min-h-tap items-center gap-3 rounded-2xl border border-line-night bg-night-1 px-4 py-3 ${locked ? 'opacity-80' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        disabled={locked}
        onChange={(e) => onChange?.(e.target.checked)}
      />
      <span
        aria-hidden
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
          checked ? 'border-accent-400 bg-accent-400 text-ink' : 'border-line-night text-transparent'
        }`}
      >
        <Check size={14} strokeWidth={3} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-body">{title}</span>
        <span className="block text-label text-mute-night">{why}</span>
      </span>
      {locked && <span className="shrink-0 text-micro text-mute-night">{t('app.connect.required')}</span>}
    </label>
  );
}

/** Consent screen: pick banks and scopes, then grant read-only access. */
export default function ConnectBank() {
  const { t, L, locale } = useI18n();
  const { personas, findPersona, connect } = useSession();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const personaId = params.get('persona') ?? '';

  const persona: Persona | undefined = useMemo(
    () => findPersona(personaId) ?? personas?.[0],
    [findPersona, personas, personaId],
  );
  const [banks, setBanks] = useState<string[]>([]);
  const [optional, setOptional] = useState<string[]>([...OPTIONAL_SCOPES]);
  const [days, setDays] = useState<number>(90);
  const [cash, setCash] = useState<number | ''>('');
  const [timeoutBank, setTimeoutBank] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ReactNode>(null);

  useEffect(() => {
    if (!persona) return;
    setBanks(persona.banks.map((b) => b.code));
    setCash(persona.cash_at_home);
    setTimeoutBank('');
  }, [persona]);

  const goal: Goal | undefined = persona?.goal;
  const goalText = goal
    ? `${t(`goals.kinds.${goal.kind}`)} · ${goal.amount_usd ? `$${goal.amount_usd.toLocaleString('en-US')}` : `₾${(goal.amount_gel ?? 0).toLocaleString('en-US')}`} · ${t('goals.inYears', { n: goal.years })}`
    : '';

  const toggleBank = (code: string) =>
    setBanks((v) => (v.includes(code) ? v.filter((b) => b !== code) : [...v, code]));

  const submit = async () => {
    if (!persona || !banks.length) return;
    setBusy(true);
    setError(null);
    try {
      const s = await api.consent({
        persona_id: persona.id,
        banks,
        scopes: [...REQUIRED_SCOPES, ...optional],
        duration_days: days,
        cash_at_home: cash === '' ? null : Number(cash),
        simulate_timeout: timeoutBank || null,
      });
      connect(persona, { consent_id: s.consent_id, token: s.token, persona_id: persona.id });
      navigate('/app/connect/progress');
    } catch (e) {
      setError(errorMessage(e, (o) => (locale === 'ka' ? o.ka : o.en)));
      setBusy(false);
    }
  };

  return (
    <Screen>
      <PageTitle title={t('app.connect.title')} lead={t('app.connect.lead')} />

      {persona && (
        <Card className="flex items-center gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-night-3 text-body">
            {persona.name_en.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
          </span>
          <span className="min-w-0">
            <span className="block text-body">{L(persona, 'name')}, {persona.age}</span>
            <span className="block text-label text-mute-night">{L(persona, 'occupation')} · {L(persona, 'city')}</span>
            <span className="mt-0.5 block text-label text-accent-300">{goalText}</span>
          </span>
        </Card>
      )}
      <p className="mt-3 text-micro text-mute-night">{t('app.connect.syntheticNote')}</p>

      <Field label={t('app.connect.banks')}>
        {() => (
          <div className="grid gap-2">
            {persona?.banks.map((b) => (
              <ScopeRow
                key={b.code}
                title={locale === 'ka' ? b.name_ka : b.name}
                why={t('app.connect.bankWhy')}
                checked={banks.includes(b.code)}
                onChange={() => toggleBank(b.code)}
              />
            ))}
          </div>
        )}
      </Field>

      <Field label={t('app.connect.read')} hint={t('app.connect.scopeHint')}>
        {() => (
          <div className="grid gap-2">
            {REQUIRED_SCOPES.map((s) => (
              <ScopeRow key={s} title={t(`app.connect.scopes.${s}.title`)} why={t(`app.connect.scopes.${s}.why`)} locked checked />
            ))}
            {OPTIONAL_SCOPES.map((s) => (
              <ScopeRow
                key={s}
                title={t(`app.connect.scopes.${s}.title`)}
                why={t(`app.connect.scopes.${s}.why`)}
                checked={optional.includes(s)}
                onChange={(v) => setOptional((o) => (v ? [...o, s] : o.filter((x) => x !== s)))}
              />
            ))}
          </div>
        )}
      </Field>

      <Field label={t('app.connect.duration')}>
        {() => (
          <Segmented
            label={t('app.connect.duration')}
            value={String(days)}
            onChange={(v) => setDays(Number(v))}
            options={DURATIONS.map((d) => ({ id: String(d), label: t('app.connect.days', { n: d }) }))}
          />
        )}
      </Field>

      <Field label={t('app.connect.cashAtHome')} hint={t('app.connect.cashHint')}>
        {(id) => <MoneyInput id={id} value={cash} onChange={setCash} currency="GEL" />}
      </Field>

      <Card className="mt-6">
        <p className="text-label font-medium">{t('app.connect.never')}</p>
        <ul className="mt-2 space-y-1.5">
          {(['move', 'sell', 'trade'] as const).map((k) => (
            <li key={k} className="flex items-center gap-2.5 text-label text-paper/80">
              <ShieldCheck size={15} className="shrink-0 text-accent-400" />
              {t(`app.connect.neverItems.${k}`)}
            </li>
          ))}
        </ul>
      </Card>

      <details className="group mt-4 rounded-2xl border border-line-night bg-night-1">
        <summary className="flex min-h-tap cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-label text-mute-night">
          {t('app.connect.demoControls')}
        </summary>
        <div className="px-4 pb-4">
          <label className="block text-micro text-mute-night" htmlFor="timeout-sim">
            {t('app.connect.timeoutLabel')}
          </label>
          <select
            id="timeout-sim"
            value={timeoutBank}
            onChange={(e) => setTimeoutBank(e.target.value)}
            className="mt-2 w-full min-h-tap rounded-2xl border border-line-night bg-night-2 px-4 py-3 text-body text-paper"
          >
            <option value="">{t('app.connect.timeoutNone')}</option>
            {persona?.banks.map((b) => (
              <option key={b.code} value={b.code} disabled={!banks.includes(b.code)}>
                {locale === 'ka' ? b.name_ka : b.name}
              </option>
            ))}
          </select>
        </div>
      </details>

      {error && (
        <Card tone="caution" className="mt-4">
          <p className="text-body">{error}</p>
        </Card>
      )}

      <ActionBar>
        <Button variant="accent" size="lg" onClick={submit} disabled={busy || !persona || !banks.length}>
          {busy ? t('app.connect.allowing') : t('app.connect.allow')}
        </Button>
        <p className="pt-1 text-center text-micro text-mute-night">
          {t('app.connect.expires', { n: days })}
        </p>
      </ActionBar>
    </Screen>
  );
}
