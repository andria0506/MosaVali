/**
 * Import a statement (CSV). The file is parsed and analysed entirely on the
 * device — only the derived summary numbers are ever sent to the backend
 * (POST /api/custom-customers), never the transactions.
 */
import { useRef, useState } from 'react';
import { FileUp } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Badge, Card, Field, PageTitle, Screen, Select } from '../../components/app/kit';
import { CustomNumbersForm, DEFAULT_CUSTOM } from '../../components/app/CustomNumbersForm';
import { useI18n } from '../../i18n';
import { StatementError, analyseStatement, decodeStatement, parseStatementCsv, type StatementAnalysis } from '../../services/statement';
import { fetchUsdGelRate } from '../../services/rates';
import type { CustomCustomerIn } from '../../types';

/** Derive the custom-customer fields from the statement analysis. */
function derive(a: StatementAnalysis): { draft: CustomCustomerIn; loanGel: number; months: number; transactions: number } {
  const cat = (code: string) => a.measured.byCategory.find((c) => c.code === code)?.monthly.amount ?? 0;
  const loan = Math.round(cat('loan'));
  const other = Math.round(cat('other')) + loan;
  return {
    draft: {
      ...DEFAULT_CUSTOM,
      monthly_income: a.answers.monthlyIncome.amount,
      income_kind: a.answers.incomeType === 'salaried' ? 'salary' : 'business',
      rent: Math.round(cat('rent')),
      utilities: Math.round(cat('utilities')),
      groceries: Math.round(cat('groceries')),
      transport: Math.round(cat('transport')),
      dining: Math.round(cat('leisure')),
      delivery: 0,
      taxi: 0,
      other,
      gel_current: Math.round(a.answers.savings.amount),
      gel_savings: 0, // the statement's balances are already in gel_current; the form default would add money the file doesn't show
    },
    loanGel: loan,
    months: a.measured.incomeHistory.length,
    transactions: a.measured.detail.transactions,
  };
}

type Parsed = ReturnType<typeof derive> & {
  text: string;
  customers?: string[];
  customer?: string;
  /** Rows left out: unreadable ones and other currencies. */
  skipped: number;
  otherCurrency: number;
};

export default function ImportStatement() {
  const { t, num } = useI18n();
  const [stage, setStage] = useState<'pick' | 'review'>('pick');
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  /** A specific reason instead of one generic "could not read" for every failure. */
  const explain = (e: unknown): string => {
    if (!(e instanceof StatementError)) return t('app.import.parseError');
    const cols = (e.detail.columns ?? []).slice(0, 8).join(', ');
    switch (e.code) {
      case 'empty': return t('app.import.errEmpty');
      case 'excel': return t('app.import.errExcel');
      case 'currency': return t('app.import.errCurrency', { n: num(e.detail.otherCurrency ?? 0, 0) });
      case 'rows': return t('app.import.errRows', { n: num(e.detail.skipped ?? 0, 0) });
      case 'columns': return cols ? t('app.import.errColumns', { cols }) : t('app.import.parseError');
    }
  };

  const process = async (text: string, customer?: string) => {
    setBusy(true);
    setErr(null);
    try {
      const rate = await fetchUsdGelRate(2.7);
      const p = parseStatementCsv(text, { customer });
      const savings = (p.lastBalance?.GEL ?? 0) + (p.lastBalance?.USD ?? 0) * rate.rate;
      const analysis = analyseStatement(p.transactions, savings || DEFAULT_CUSTOM.gel_current || 0, rate.rate);
      setParsed({ ...derive(analysis), text, customers: p.customers, customer: p.customer, skipped: p.skipped, otherCurrency: p.otherCurrency });
      setStage('review');
    } catch (e) {
      setErr(explain(e));
      setStage('pick');
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File) => {
    try {
      await process(decodeStatement(await file.arrayBuffer()));
    } catch (e) {
      setErr(explain(e));
    }
  };
  const loadSample = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/sample-statement.csv');
      if (!res.ok) throw new Error('fetch');
      await process(await res.text());
    } catch {
      setErr(t('app.import.parseError'));
      setBusy(false);
    }
  };

  if (stage === 'review' && parsed) {
    return (
      <Screen>
        <PageTitle title={t('app.import.reviewTitle')} lead={t('app.import.reviewLead', { n: num(parsed.transactions, 0), months: num(parsed.months, 0) })} />
        <Card tone="safe" className="mb-3">
          <p className="text-label">{t('app.import.privacyNote')}</p>
        </Card>
        {parsed.customers && (
          <Card className="mb-3">
            <Field label={t('app.import.customer', { n: num(parsed.customers.length, 0) })}>
              {(id) => (
                <Select id={id} value={parsed.customer} disabled={busy} onChange={(e) => void process(parsed.text, e.target.value)}>
                  {parsed.customers!.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              )}
            </Field>
          </Card>
        )}
        {(parsed.skipped > 0 || parsed.otherCurrency > 0) && (
          <Card tone="caution" className="mb-3">
            <p className="text-label">
              {[
                parsed.skipped > 0 && t('app.import.skipped', { n: num(parsed.skipped, 0) }),
                parsed.otherCurrency > 0 && t('app.import.otherCurrency', { n: num(parsed.otherCurrency, 0) }),
              ].filter(Boolean).join(' ')}
            </p>
          </Card>
        )}
        <CustomNumbersForm
          key={parsed.customer ?? 'statement'}
          initial={parsed.draft}
          note={parsed.loanGel > 0 ? t('app.import.loanNote') : undefined}
        />
        <Button variant="quiet" className="mt-3" onClick={() => { setStage('pick'); setParsed(null); }}>
          {t('app.import.another')}
        </Button>
      </Screen>
    );
  }

  return (
    <Screen>
      <PageTitle title={t('app.import.title')} lead={t('app.import.lead')} />
      <Card>
        <div className="flex flex-col items-center gap-4 py-6 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-400/15 text-accent-300">
            <FileUp size={24} />
          </span>
          <p className="text-label text-mute-night">{t('app.import.hint')}</p>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt,.tsv,text/csv,text/plain"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
              e.target.value = '';
            }}
          />
          <Button variant="accent" size="lg" disabled={busy} onClick={() => fileRef.current?.click()}>
            {t('app.import.pick')}
          </Button>
          <button type="button" className="text-label text-paper/70 underline underline-offset-4 hover:text-paper" disabled={busy} onClick={() => void loadSample()}>
            {t('app.import.sample')}
          </button>
        </div>
      </Card>
      {err && (
        <Card tone="caution" className="mt-3"><p className="text-label" role="alert">{err}</p></Card>
      )}
      <Card className="mt-3">
        <p className="text-label">{t('app.import.privacyNote')}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge>{t('app.import.onDevice')}</Badge>
          <Badge>{t('app.welcome.syntheticBadge')}</Badge>
        </div>
      </Card>
    </Screen>
  );
}
