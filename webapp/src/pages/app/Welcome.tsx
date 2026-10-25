import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, FileUp, Gauge, PenLine, Search, ShieldCheck, UserCheck, Users } from 'lucide-react';
import { useI18n } from '../../i18n';
import { useSession } from '../../state/SessionContext';
import { LogoMark } from '../../components/ui/Logo';
import { ButtonLink } from '../../components/ui/Button';
import { Badge, Card, Screen, Sheet, TextInput } from '../../components/app/kit';
import type { Persona } from '../../types';

const points = [
  { id: 'buffer', icon: ShieldCheck },
  { id: 'risk', icon: Gauge },
  { id: 'approve', icon: UserCheck },
] as const;

const initials = (name: string) =>
  name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

/** First screen: who is connecting. Each customer consents explicitly. */
export default function Welcome() {
  const { t, L, money } = useI18n();
  const { personas, organisers, session, notice, setNotice } = useSession();
  const navigate = useNavigate();
  const [pickOpen, setPickOpen] = useState(false);
  const [query, setQuery] = useState('');
  const goalText = (p: Persona) =>
    `${t(`goals.kinds.${p.goal.kind}`)} · ${p.goal.amount_usd ? money({ amount: p.goal.amount_usd, currency: 'USD' }) : money({ amount: p.goal.amount_gel ?? 0, currency: 'GEL' })} · ${t('goals.inYears', { n: p.goal.years })}`;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = organisers ?? [];
    if (!q) return list.slice(0, 30);
    return list.filter((p) => `${p.id} ${p.name_en} ${p.name_ka}`.toLowerCase().includes(q)).slice(0, 30);
  }, [organisers, query]);

  const pick = (id: string) => {
    setNotice(null);
    setPickOpen(false);
    navigate(`/app/connect?persona=${id}`);
  };

  return (
    <Screen>
      <div className="flex min-h-[calc(100dvh-7rem)] flex-col">
        <div className="pt-6 animate-fade-up">
          <LogoMark className="h-12 w-12 text-paper" />
          <h1 className="mt-6 whitespace-pre-line text-balance text-[2.75rem] font-light leading-[1.1] tracking-[-0.035em] md:text-display">
            {t('app.welcome.title')}
          </h1>
          <p className="mt-4 text-body text-mute-night">{t('app.welcome.lead')}</p>
        </div>

        {notice === 'gone' && (
          <Card tone="caution" className="mt-6">
            <p className="text-body">{t('app.welcome.sessionGone')}</p>
          </Card>
        )}

        <section className="mt-7" aria-label={t('app.welcome.start')}>
          {session && (
            <ButtonLink to="/app" variant="accent" size="lg" className="mb-3 w-full">
              {t('app.welcome.resume')} <ArrowRight size={18} aria-hidden />
            </ButtonLink>
          )}
          <ButtonLink to="/app/questionnaire" variant={session ? 'inverse' : 'accent'} size="lg" className="w-full">
            <PenLine size={18} aria-hidden /> {t('app.welcome.start')}
          </ButtonLink>
          <p className="mt-2 text-label text-mute-night">{t('app.welcome.startNote')}</p>
          <ButtonLink to="/app/import" variant="inverse" size="lg" className="mt-4 w-full">
            <FileUp size={18} aria-hidden /> {t('app.welcome.import')}
          </ButtonLink>
          <p className="mt-2 text-micro text-mute-night">{t('app.welcome.importSub')}</p>
        </section>

        <ul className="mt-7 space-y-3 border-y border-line-night py-5">
          {points.map(({ id, icon: Icon }) => (
            <li
              key={id}
              className="flex items-center gap-3"
            >
              <Icon size={18} className="shrink-0 text-accent-300" aria-hidden />
              <span className="text-label">{t(`app.welcome.points.${id}`)}</span>
            </li>
          ))}
        </ul>

        <details className="mt-5 rounded-card border border-line-night p-4">
          <summary className="min-h-tap cursor-pointer py-3 text-body focus-visible:outline-accent-400">
            {t('app.welcome.samples')}
          </summary>
          <section className="mt-3" aria-labelledby="pick-customer">
          <h2 id="pick-customer" className="text-label font-medium text-mute-night">
            {t('app.welcome.pickCustomer')}
          </h2>
          <p className="mt-1 text-micro text-mute-night">{t('app.welcome.syntheticNote')}</p>
          <div className="mt-4 grid gap-3">
            {(personas ?? []).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => pick(p.id)}
                className="flex items-center gap-4 rounded-card border border-line-night bg-night-1 p-4 text-left transition-colors hover:border-paper/30"
              >
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-night-3 text-body">
                  {initials(p.name_en)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-body">
                    {L(p, 'name')}, {p.age}
                  </span>
                  <span className="mt-0.5 block text-label text-mute-night">
                    {L(p, 'occupation')} · {L(p, 'city')}
                  </span>
                  <span className="mt-1 block text-label text-accent-300">{goalText(p)}</span>
                </span>
              </button>
            ))}
            {personas === null && <div className="animate-pulse rounded-card bg-night-1" style={{ height: 180 }} />}
          </div>

          <h2 className="mt-8 text-label font-medium text-mute-night">{t('app.welcome.otherWays')}</h2>
          <div className="mt-3 grid gap-3">
            <button
              type="button"
              onClick={() => setPickOpen(true)}
              className="flex items-center gap-4 rounded-card border border-line-night bg-night-1 p-4 text-left transition-colors hover:border-paper/30"
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-night-3 text-paper/80">
                <Users size={20} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-body">{t('app.welcome.organiser')}</span>
                <span className="mt-0.5 block text-label text-mute-night">
                  {t('app.welcome.organiserSub', { n: organisers?.length ?? 0 })}
                </span>
              </span>
            </button>
          </div>
          </section>
        </details>

        <div className="mt-auto pt-8">
          <Badge>{t('app.welcome.syntheticBadge')}</Badge>
          <p className="pt-3 text-micro text-mute-night">{t('hero.disclaimer')}</p>
        </div>
      </div>

      <Sheet open={pickOpen} onClose={() => setPickOpen(false)} title={t('app.welcome.organiser')}>
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-mute-night" />
          <TextInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('app.welcome.organiserSearch')}
            className="pl-10"
            autoFocus
          />
        </div>
        <ul className="mt-3 max-h-[50dvh] space-y-2 overflow-y-auto">
          {filtered.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => pick(p.id)}
                className="flex w-full items-center gap-3 rounded-2xl border border-line-night bg-night-2 px-4 py-3 text-left hover:border-paper/30"
              >
                <span className="num text-micro text-mute-night">{p.id}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-label">{L(p, 'name')}</span>
                  <span className="block truncate text-micro text-mute-night">{L(p, 'occupation')} · {L(p, 'city')}</span>
                </span>
              </button>
            </li>
          ))}
          {organisers && filtered.length === 0 && (
            <li className="py-4 text-center text-label text-mute-night">{t('app.welcome.organiserEmpty')}</li>
          )}
        </ul>
      </Sheet>
    </Screen>
  );
}
