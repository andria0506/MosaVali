import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Loader2, WifiOff } from 'lucide-react';
import { useI18n } from '../../i18n';
import { useSession } from '../../state/SessionContext';
import { Button } from '../../components/ui/Button';
import { ActionBar, Card, Screen } from '../../components/app/kit';

const STEP_MS = 900;

type Step = 'reading' | 'measuring' | 'profiling';

const STEPS: Step[] = ['reading', 'measuring', 'profiling'];

/** Animated connect → analysis progress, then the bank-by-bank result. */
export default function ConnectProgress() {
  const { t, L, locale } = useI18n();
  const { persona, profile, finishConnect } = useSession();
  const navigate = useNavigate();
  const [stepIdx, setStepIdx] = useState(0);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const timers = STEPS.map((_, i) => setTimeout(() => setStepIdx(i + 1), STEP_MS * (i + 1)));
    finishConnect()
      .then(() => setTimeout(() => setDone(true), STEP_MS * STEPS.length))
      .catch(() => setError(true));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bankStatus = profile?.consent.bank_status ?? {};
  const partial = profile?.partial_data ?? false;
  const banks = persona?.banks ?? [];

  return (
    <Screen>
      <div className="flex min-h-[calc(100dvh-7rem)] flex-col pt-10">
        <h1 className="text-[2rem] font-light leading-[1.15] tracking-[-0.03em]">
          {done ? t('app.progress.doneTitle') : t('app.progress.title')}
        </h1>
        {persona && (
          <p className="mt-2 text-body text-mute-night">
            {L(persona, 'name')} · {banks.map((b) => (locale === 'ka' ? b.name_ka : b.name)).join(' · ')}
          </p>
        )}

        <ul className="mt-10 space-y-3" aria-live="polite">
          {STEPS.map((s, i) => {
            const state = i < stepIdx || done ? 'done' : i === stepIdx ? 'active' : 'idle';
            return (
              <li key={s} className="flex items-center gap-4 rounded-2xl border border-line-night bg-night-1 p-4">
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                    state === 'done' ? 'bg-accent-400/15 text-accent-300' : state === 'active' ? 'bg-night-3 text-paper' : 'bg-night-2 text-mute-night'
                  }`}
                >
                  {state === 'done' ? <Check size={18} /> : state === 'active' ? <Loader2 size={18} className="animate-spin" /> : <span className="num text-label">{i + 1}</span>}
                </span>
                <span className={`text-body ${state === 'idle' ? 'text-mute-night' : ''}`}>{t(`app.progress.steps.${s}`)}</span>
              </li>
            );
          })}
        </ul>

        {done && profile && (
          <div className="mt-6 space-y-3 animate-fade-up">
            {Object.entries(bankStatus).map(([code, status]) => {
              const bank = banks.find((b) => b.code === code);
              const ok = status === 'ok';
              return (
                <div key={code} className="flex items-center gap-3 text-label">
                  {ok ? <Check size={16} className="text-accent-400" /> : <WifiOff size={16} className="text-caution-300" />}
                  <span>{bank ? (locale === 'ka' ? bank.name_ka : bank.name) : code}</span>
                  <span className="text-mute-night">· {t(`app.progress.bankStatus.${ok ? 'ok' : 'timeout'}`)}</span>
                </div>
              );
            })}
            {partial && (
              <Card tone="caution">
                <p className="text-label">{t('app.progress.partial')}</p>
              </Card>
            )}
          </div>
        )}

        {error && (
          <Card tone="caution" className="mt-6">
            <p className="text-body">{t('app.error')}</p>
          </Card>
        )}

        <div className="mt-auto">
          <ActionBar>
            <Button variant="accent" size="lg" onClick={() => navigate('/app')} disabled={!done}>
              {t('app.progress.done')}
            </Button>
          </ActionBar>
        </div>
      </div>
    </Screen>
  );
}
