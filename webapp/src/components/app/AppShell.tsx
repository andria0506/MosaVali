import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate, useSearchParams } from 'react-router-dom';
import { ChartPie, ChevronLeft, ChevronsUpDown, FlaskConical, LineChart, Newspaper, Target, User, UserRound } from 'lucide-react';
import { useI18n } from '../../i18n';
import { useSession } from '../../state/SessionContext';
import { useUnreadAlerts } from '../../lib/readAlerts';
import { Logo, LogoMark } from '../ui/Logo';
import { LanguageToggle } from '../ui/LanguageToggle';
import { Sheet } from './kit';

const tabs = [
  { to: '/app/analysis', id: 'analysis', icon: ChartPie, end: false },
  { to: '/app/plan', id: 'plan', icon: Target, end: false },
  { to: '/app/stocks', id: 'stocks', icon: LineChart, end: false },
  { to: '/app/news', id: 'news', icon: Newspaper, end: false },
  { to: '/app/profile', id: 'profile', icon: User, end: false },
] as const;

/** Every app screen says plainly that the customers, banks and transactions are synthetic. */
export function SyntheticBadge({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  return (
    <span
      title={t('app.shell.synthetic')}
      className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-caution-400/30 bg-caution-400/10 px-2.5 py-1 text-micro text-caution-300"
    >
      <FlaskConical size={12} aria-hidden />
      <span className={compact ? 'sr-only sm:not-sr-only' : ''}>{t('app.shell.synthetic')}</span>
    </span>
  );
}

/** Main app layout: bottom tab bar on phones, side rail on desktop. */
export function TabsLayout() {
  const { t, money } = useI18n();
  const { profile, session } = useSession();
  const unread = useUnreadAlerts(session?.consent_id, profile?.profile.alerts);
  const totals = profile?.ingestion.totals;

  return (
    <div className="min-h-dvh bg-night text-paper [--tabbar-h:76px] lg:pl-64 lg:[--tabbar-h:0px]">
      {/* Desktop side rail */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-line-night bg-night-1 px-4 py-5 lg:flex">
        <Link to="/" className="flex items-center gap-3 rounded-2xl px-2 py-1.5 text-paper hover:bg-night-2" aria-label="MosaVali">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line-night bg-night-3">
            <LogoMark className="h-6 w-6" />
          </span>
          <span className="min-w-0">
            <span className="block text-body font-medium leading-tight tracking-[-0.02em]">
              Mosa<span className="opacity-60">Vali</span>
            </span>
            <span className="block truncate text-[10px] uppercase tracking-[0.12em] text-mute-night">{t('app.shell.tagline')}</span>
          </span>
        </Link>
        <div className="mt-4 px-2">
          <SyntheticBadge />
        </div>
        <p className="mb-2 mt-8 px-3 text-[10px] uppercase tracking-[0.12em] text-mute-night">{t('app.shell.menu')}</p>
        <nav className="flex flex-col gap-0.5" aria-label="App">
          {tabs.map(({ to, id, icon: Icon, end }) => (
            <NavLink
              key={id}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex min-h-[2.625rem] items-center gap-3 rounded-xl px-3 text-label transition-colors ${
                  isActive ? 'bg-night-3 text-paper shadow-card' : 'text-mute-night hover:bg-night-2 hover:text-paper'
                }`
              }
            >
              <Icon size={18} strokeWidth={1.7} />
              <span className="flex-1">{t(`tabs.${id}`)}</span>
              {id === 'news' && unread > 0 && <UnreadDot count={unread} />}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto space-y-3">
          {totals && profile && (
            <Link to="/app/analysis" className="block rounded-2xl border border-line-night bg-night-2/70 p-4 transition-colors hover:border-paper/20">
              <p className="text-[10px] uppercase tracking-[0.12em] text-mute-night">{t('app.home.totalSavings')}</p>
              <p className="num mt-1.5 text-[1.375rem] leading-tight tracking-[-0.02em]">{money({ amount: totals.assets_gel, currency: 'GEL' })}</p>
              <p className="num mt-1 text-micro text-accent-300">
                {t('app.shell.freeToInvest', { amount: money({ amount: profile.liquidity.free_to_invest_gel, currency: 'GEL' }) })}
              </p>
            </Link>
          )}
          <div className="flex justify-start px-1">
            <LanguageToggle dark />
          </div>
          <div className="border-t border-line-night pt-3">
            <PersonaSwitcher variant="row" />
          </div>
        </div>
      </aside>

      <div className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-line-night/60 bg-night/90 px-4 backdrop-blur lg:hidden">
        <div className="flex items-center gap-2.5">
          <Link to="/" className="flex min-h-tap items-center" aria-label="MosaVali">
            <Logo markOnly />
          </Link>
          <SyntheticBadge compact />
        </div>
        <PersonaSwitcher />
      </div>

      <main className="pb-[var(--tabbar-h)]">
        <Outlet />
      </main>

      {/* Phone tab bar */}
      <nav
        aria-label="App"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line-night bg-night-1/95 px-2 pb-[max(env(safe-area-inset-bottom),8px)] pt-1.5 backdrop-blur lg:hidden"
      >
        <ul className="grid grid-cols-5">
          {tabs.map(({ to, id, icon: Icon, end }) => (
            <li key={id}>
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  `relative flex min-h-[3.25rem] flex-col items-center justify-center gap-1 ${isActive ? 'text-paper' : 'text-mute-night'}`
                }
              >
                {({ isActive }) => (
                  <>
                    <span className="relative">
                      <Icon size={22} strokeWidth={isActive ? 2 : 1.6} className={isActive ? 'text-accent-300' : ''} />
                      {id === 'news' && unread > 0 && (
                        <span className="absolute -right-1.5 -top-1 h-2.5 w-2.5 rounded-full border-2 border-night-1 bg-caution-400" />
                      )}
                    </span>
                    <span className="max-w-full truncate px-1 text-[11px]">{t(`tabs.${id}`)}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

function UnreadDot({ count }: { count: number }) {
  return (
    <span className="num flex h-5 min-w-5 items-center justify-center rounded-full bg-caution-400 px-1.5 text-micro text-ink">
      {count}
    </span>
  );
}

/** Full-screen flows (onboarding, goal editing): back button, no tab bar. */
export function FlowLayout() {
  const navigate = useNavigate();
  const { t } = useI18n();
  return (
    <div className="min-h-dvh bg-night text-paper">
      <div className="sticky top-0 z-30 bg-night/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-2xl items-center justify-between gap-3 px-2">
          <button
            type="button"
            onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/app'))}
            aria-label={t('app.back')}
            className="flex h-tap w-tap items-center justify-center rounded-full hover:bg-night-2"
          >
            <ChevronLeft size={24} strokeWidth={1.8} />
          </button>
          <span className="mr-auto">
            <SyntheticBadge compact />
          </span>
          <PersonaSwitcher />
        </div>
      </div>
      <main>
        <Outlet />
      </main>
    </div>
  );
}

const initials = (name: string) =>
  name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

/**
 * Demo customer switcher: lists the synthetic personas from GET /api/personas.
 * Switching always ends the session — the new customer consents explicitly.
 */
export function PersonaSwitcher({ full = false, variant = 'pill' }: { full?: boolean; variant?: 'pill' | 'row' }) {
  const { t, L } = useI18n();
  const { session, persona, personas, findPersona, switchTo } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [open, setOpen] = useState(false);
  // On Connect the customer is picked via ?persona=… before any session exists.
  const pending = params.get('persona');
  const current = persona ?? findPersona(session?.persona_id ?? '') ?? (pending ? findPersona(pending) : undefined);

  if (!current) return <LanguageToggle dark />;

  return (
    <>
      {variant === 'row' ? (
        <button type="button" onClick={() => setOpen(true)} className="flex w-full min-w-0 items-center gap-3 rounded-xl px-2 py-1.5 text-left hover:bg-night-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-400 text-label font-medium text-ink">
            {initials(current.name_en)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-label">{L(current, 'name')}</span>
            <span className="block truncate text-micro text-mute-night">{L(current, 'occupation') || t('app.shell.demo')}</span>
          </span>
          <ChevronsUpDown size={16} className="shrink-0 text-mute-night" aria-hidden />
        </button>
      ) : (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`flex min-h-tap min-w-0 items-center gap-2 rounded-full border border-line-night bg-night-2 py-1 pl-1 pr-3 text-label hover:bg-night-3 ${
          full ? 'w-full' : 'max-w-[13rem]'
        }`}
      >
        {current ? (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-400 text-label font-medium text-ink">
            {initials(current.name_en)}
          </span>
        ) : (
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-night-4 text-mute-night">
            <UserRound size={16} aria-hidden />
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-left">
          {current ? L(current, 'name') : t('app.shell.noCustomer')}
        </span>
        {full && <span className="rounded-full bg-night-4 px-2 py-0.5 text-micro text-mute-night">{t('app.shell.demo')}</span>}
      </button>
      )}

      <Sheet open={open} onClose={() => setOpen(false)} title={L(current, 'name')}>
        {session && (
          <button type="button" onClick={() => { setOpen(false); navigate('/app/profile'); }}
            className="mb-4 flex min-h-tap w-full items-center gap-3 rounded-2xl bg-night-2 p-4 text-left">
            <User size={20} aria-hidden /> {t('app.shell.myProfile')}
          </button>
        )}
        <details>
          <summary className="min-h-tap cursor-pointer py-3 text-label">{t('app.welcome.samples')}</summary>
        <p className="mb-4 text-label text-mute-night">{t('app.shell.switchNotice')}</p>
        <div className="space-y-2">
          {personas?.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={p.id === session?.persona_id}
              onClick={() => {
                setOpen(false);
                if (p.id === session?.persona_id) navigate('/app');
                else switchTo(p.id);
              }}
              className={`flex w-full min-h-[4rem] items-center gap-3 rounded-2xl border p-3 text-left transition-colors ${
                p.id === session?.persona_id ? 'border-accent-400 bg-accent-400/10' : 'border-line-night hover:bg-night-2'
              }`}
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-night-3 text-body">
                {initials(p.name_en)}
              </span>
              <span className="min-w-0">
                <span className="block text-body">{L(p, 'name')}</span>
                <span className="block text-label text-mute-night">{L(p, 'occupation')}</span>
              </span>
            </button>
          ))}
        </div>
        </details>
      </Sheet>
    </>
  );
}
