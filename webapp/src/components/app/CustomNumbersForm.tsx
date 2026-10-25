/**
 * "Enter your own numbers" form — shared by the Questionnaire route and the
 * statement-import review. Posts to /api/custom-customers (a synthetic persona
 * generated from the typed values), then continues to the normal explicit
 * bank-consent step.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../ui/Button';
import { Card, Field, MoneyInput, Select, TextInput } from './kit';
import { useI18n } from '../../i18n';
import { ApiError, api, errorMessage } from '../../services/backend';
import { useSession } from '../../state/SessionContext';
import type { CustomCustomerIn, GoalKind } from '../../types';

const BANKS = ['MT', 'RI', 'KB', 'TBC'] as const;
const REGIONS = ['tbilisi', 'adjara', 'imereti', 'other'] as const;
const INCOMES = ['salary', 'pension', 'business'] as const;
const GOALS: GoalKind[] = ['car', 'apartment', 'education', 'preserve', 'retirement', 'business'];

export const DEFAULT_CUSTOM: CustomCustomerIn = {
  label: '', age: 30, region: 'tbilisi', household: 1, bank: 'MT',
  income_kind: 'salary', monthly_income: 2500, pay_day: 25,
  rent: 700, utilities: 120, groceries: 500, transport: 60, delivery: 120, dining: 100, taxi: 60, other: 0,
  usd_loan_instalment: 0, usd_loan_balance: 0,
  gel_current: 3000, gel_savings: 6000, gel_term_deposit: 0, usd_savings: 0, cash_at_home: 0,
  goal: { kind: 'car', amount: 9000, currency: 'USD', years: 4 },
};

// The backend's limits (CustomCustomerIn in backend/danazogi/api.py); typing past them is capped here instead of failing on submit.
const MAX: Partial<Record<keyof CustomCustomerIn, number>> = {
  monthly_income: 100_000,
  rent: 50_000, utilities: 50_000, groceries: 50_000, transport: 50_000, delivery: 50_000, dining: 50_000, taxi: 50_000, other: 50_000,
  usd_loan_instalment: 20_000, usd_loan_balance: 1_000_000,
  gel_current: 10_000_000, gel_savings: 10_000_000, gel_term_deposit: 10_000_000, usd_savings: 10_000_000, cash_at_home: 1_000_000,
};
const GOAL_MAX_YEARS = 15;
const GOAL_MAX_AMOUNT = 10_000_000;

function Num({ id, value, onChange, max }: { id?: string; value: number; onChange: (v: number) => void; max?: number }) {
  return (
    <input
      id={id} type="number" min={0} max={max} value={value}
      onChange={(e) => onChange(Math.min(max ?? Infinity, Math.max(0, Number(e.target.value) || 0)))}
      className="num min-h-tap w-full rounded-2xl border border-line-night bg-night-1 px-4 py-3 text-body focus:border-accent-400 focus:outline-none"
    />
  );
}

export function CustomNumbersForm({ initial, note }: { initial: CustomCustomerIn; note?: string }) {
  const { t, L } = useI18n();
  const { addCustomPersona } = useSession();
  const navigate = useNavigate();
  const [v, setV] = useState<CustomCustomerIn>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof CustomCustomerIn>(k: K, x: CustomCustomerIn[K]) => setV((s) => ({ ...s, [k]: x }));
  const spend: (keyof CustomCustomerIn)[] = ['rent', 'utilities', 'groceries', 'transport', 'delivery', 'dining', 'taxi', 'other'];
  const save: (keyof CustomCustomerIn)[] = ['gel_current', 'gel_savings', 'gel_term_deposit', 'usd_savings', 'cash_at_home'];

  const submit = async () => {
    // Catch what the backend would reject with a plain-language message instead of a 422.
    const loan = v.usd_loan_instalment ?? 0;
    const balance = v.usd_loan_balance ?? 0;
    if (!(v.goal.amount > 0)) return setErr(t('app.own.errGoalAmount'));
    if ((loan > 0) !== (balance > 0)) return setErr(t('app.own.errLoanPair'));
    setBusy(true);
    setErr(null);
    try {
      const res = await api.customCustomer(v);
      addCustomPersona(res.persona);
      navigate(`/app/connect?persona=${res.persona_id}`);
    } catch (e) {
      setErr(e instanceof ApiError && e.status === 422 ? t('app.own.errInvalid') : errorMessage(e, (o) => L(o)));
      setBusy(false);
    }
  };

  return (
    <div>
      <Card>
        <Field label={t('app.own.nameLabel')} hint={t('app.own.nameHint')}>
          {(id) => (
            <TextInput id={id} maxLength={40} value={v.label ?? ''} onChange={(e) => set('label', e.target.value)} placeholder={t('app.own.namePh')} />
          )}
        </Field>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Field label={t('app.own.age')}>{(id) => <Num id={id} value={v.age ?? 30} onChange={(x) => set('age', Math.min(90, Math.max(18, Math.round(x))))} />}</Field>
          <Field label={t('app.own.household')}>{(id) => <Num id={id} value={v.household ?? 1} onChange={(x) => set('household', Math.min(8, Math.max(1, Math.round(x))))} />}</Field>
          <Field label={t('app.own.region')}>
            {(id) => (
              <Select id={id} value={v.region} onChange={(e) => set('region', e.target.value as CustomCustomerIn['region'])}>
                {REGIONS.map((r) => <option key={r} value={r}>{t(`app.own.regions.${r}`)}</option>)}
              </Select>
            )}
          </Field>
          <Field label={t('app.own.bank')} hint={t('app.own.bankHint')}>
            {(id) => (
              <Select id={id} value={v.bank} onChange={(e) => set('bank', e.target.value)}>
                {BANKS.map((b) => <option key={b} value={b}>{t(`app.own.banks.${b}`)}</option>)}
              </Select>
            )}
          </Field>
        </div>
      </Card>

      <Card className="mt-3">
        <p className="text-label font-medium text-mute-night">{t('app.own.incomeTitle')}</p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field label={t('app.own.incomeKind')}>
            {(id) => (
              <Select id={id} value={v.income_kind} onChange={(e) => set('income_kind', e.target.value as CustomCustomerIn['income_kind'])}>
                {INCOMES.map((k) => <option key={k} value={k}>{t(`app.own.incomes.${k}`)}</option>)}
              </Select>
            )}
          </Field>
          <Field label={t('app.own.payDay')}>{(id) => <Num id={id} value={v.pay_day ?? 25} onChange={(x) => set('pay_day', Math.min(28, Math.max(1, Math.round(x))))} />}</Field>
        </div>
        <Field label={t('app.own.monthlyIncome')}>
          {(id) => <MoneyInput id={id} currency="GEL" value={v.monthly_income ?? 0} onChange={(x) => set('monthly_income', x === '' ? 0 : Math.min(MAX.monthly_income!, x))} />}
        </Field>
      </Card>

      <Card className="mt-3">
        <p className="text-label font-medium text-mute-night">{t('app.own.spendTitle')}</p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          {spend.map((k) => (
            <Field key={k} label={t(`app.own.spending.${k}`)}>
              {(id) => <Num id={id} value={Number(v[k] ?? 0)} max={MAX[k]} onChange={(x) => set(k, x)} />}
            </Field>
          ))}
        </div>
        {note && <p className="mt-3 text-micro text-mute-night">{note}</p>}
      </Card>

      <Card className="mt-3">
        <p className="text-label font-medium text-mute-night">{t('app.own.savingsTitle')}</p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          {save.map((k) => (
            <Field key={k} label={t(`app.own.savings.${k}`)}>
              {(id) => <Num id={id} value={Number(v[k] ?? 0)} max={MAX[k]} onChange={(x) => set(k, x)} />}
            </Field>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field label={t('app.own.loanInstalment')}>{(id) => <Num id={id} value={v.usd_loan_instalment ?? 0} max={MAX.usd_loan_instalment} onChange={(x) => set('usd_loan_instalment', x)} />}</Field>
          <Field label={t('app.own.loanBalance')}>{(id) => <Num id={id} value={v.usd_loan_balance ?? 0} max={MAX.usd_loan_balance} onChange={(x) => set('usd_loan_balance', x)} />}</Field>
        </div>
        <p className="mt-3 text-micro text-mute-night">{t('app.own.loanHint')}</p>
      </Card>

      <Card className="mt-3">
        <p className="text-label font-medium text-mute-night">{t('app.own.goalTitle')}</p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field label={t('app.own.goalKind')}>
            {(id) => (
              <Select id={id} value={v.goal.kind} onChange={(e) => set('goal', { ...v.goal, kind: e.target.value as GoalKind })}>
                {GOALS.map((g) => <option key={g} value={g}>{t(`goals.kinds.${g}`)}</option>)}
              </Select>
            )}
          </Field>
          <Field label={t('app.own.goalYears')}>{(id) => <Num id={id} value={v.goal.years} max={GOAL_MAX_YEARS} onChange={(x) => set('goal', { ...v.goal, years: Math.min(GOAL_MAX_YEARS, Math.max(1, Math.round(x))) })} />}</Field>
        </div>
        <Field label={t('app.own.goalAmount')}>
          {(id) => <MoneyInput id={id} currency={v.goal.currency} value={v.goal.amount} onChange={(x) => set('goal', { ...v.goal, amount: x === '' ? 0 : Math.min(GOAL_MAX_AMOUNT, x) })} />}
        </Field>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {(['USD', 'GEL'] as const).map((c) => (
            <button
              key={c} type="button" onClick={() => set('goal', { ...v.goal, currency: c })}
              className={`min-h-tap rounded-2xl border text-label transition-colors ${v.goal.currency === c ? 'border-accent-400 bg-accent-400/10' : 'border-line-night bg-night-1'}`}
            >
              {c}
            </button>
          ))}
        </div>
      </Card>

      {err && <Card tone="caution" className="mt-3"><p className="text-label" role="alert">{err}</p></Card>}
      <Button variant="accent" size="lg" className="mt-5 w-full" disabled={busy} onClick={() => void submit()}>
        {t('app.own.submit')}
      </Button>
      <p className="mt-3 text-micro text-mute-night">{t('app.own.syntheticNote')}</p>
    </div>
  );
}
