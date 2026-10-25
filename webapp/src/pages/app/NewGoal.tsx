import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { errorMessage } from '../../services/backend';
import { useI18n } from '../../i18n';
import { useSession } from '../../state/SessionContext';
import type { Goal, GoalKind } from '../../types';
import { Button } from '../../components/ui/Button';
import { ActionBar, Card, Choice, ChoiceGrid, Field, Loading, MoneyInput, PageTitle, Screen, Segmented, TextInput } from '../../components/app/kit';

const KINDS: GoalKind[] = ['car', 'apartment', 'education', 'preserve', 'retirement', 'business'];

/** New goal: replaces the current one — MosaVali plans one goal at a time. */
export default function NewGoal() {
  const { profile } = useSession();
  // Wait for the profile so the form starts from the current goal (also after a page reload).
  if (!profile) return <Screen><Loading /></Screen>;
  return <GoalForm current={profile.profile.goal} />;
}

function GoalForm({ current }: { current: Goal }) {
  const { t, locale } = useI18n();
  const { updateGoal } = useSession();
  const navigate = useNavigate();
  const [kind, setKind] = useState<GoalKind>((KINDS as string[]).includes(current.kind) ? (current.kind as GoalKind) : 'car');
  const [amount, setAmount] = useState<number | ''>(current.amount_usd ?? current.amount_gel ?? '');
  const [currency, setCurrency] = useState<'GEL' | 'USD'>(current.amount_usd ? 'USD' : 'GEL');
  const [years, setYears] = useState<number | ''>(current.years ?? 4);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (amount === '' || years === '') return;
    // The backend accepts 1–15 years and an amount above zero; say so instead of showing its raw 422.
    if (years < 1 || years > 15) return setError(t('app.newGoal.errYears'));
    if (!(Number(amount) > 0)) return setError(t('app.own.errGoalAmount'));
    setBusy(true);
    setError(null);
    try {
      await updateGoal({ kind, amount: Number(amount), currency, years: Number(years) });
      navigate('/app/plan');
    } catch (e) {
      setError(errorMessage(e, (o) => (locale === 'ka' ? o.ka : o.en)));
      setBusy(false);
    }
  };

  return (
    <Screen>
      <PageTitle title={t('app.newGoal.title')} lead={t('app.newGoal.lead')} />

      <Field label={t('app.newGoal.type')}>
        {() => (
          <ChoiceGrid>
            {KINDS.map((k) => (
              <Choice key={k} selected={kind === k} onSelect={() => setKind(k)}>
                {t(`goals.kinds.${k}`)}
              </Choice>
            ))}
          </ChoiceGrid>
        )}
      </Field>

      <Field label={t('app.newGoal.target')}>
        {(id) => <MoneyInput id={id} value={amount} onChange={setAmount} currency={currency} large />}
      </Field>

      <Field label={t('app.newGoal.currency')}>
        {() => (
          <Segmented
            label={t('app.newGoal.currency')}
            value={currency}
            onChange={setCurrency}
            options={[
              { id: 'USD', label: t('currency.USD') },
              { id: 'GEL', label: t('currency.GEL') },
            ]}
          />
        )}
      </Field>

      <Field label={t('app.newGoal.years')} hint={t('app.newGoal.yearsHint')}>
        {(id) => <TextInput id={id} inputMode="numeric" value={years} onChange={(e) => setYears(e.target.value === '' ? '' : Number(e.target.value.replace(/[^\d]/g, '')))} />}
      </Field>

      {error && (
        <Card tone="caution" className="mt-4">
          <p className="text-body">{error}</p>
        </Card>
      )}

      <ActionBar>
        <Button variant="accent" size="lg" onClick={submit} disabled={busy || amount === '' || years === ''}>
          {t('app.newGoal.save')}
        </Button>
      </ActionBar>
    </Screen>
  );
}
