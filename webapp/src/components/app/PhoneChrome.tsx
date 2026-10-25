import type { ReactNode } from 'react';
import { ChartPie, ChevronLeft, Newspaper, Target, User } from 'lucide-react';
import { useI18n } from '../../i18n';

// Mirrors the app's tab bar (labels from `tabs.*`); Stocks is left out to fit four tabs in a mockup.
export type TabId = 'analysis' | 'plan' | 'news' | 'profile';

const tabs: { id: TabId; icon: typeof ChartPie }[] = [
  { id: 'analysis', icon: ChartPie },
  { id: 'plan', icon: Target },
  { id: 'news', icon: Newspaper },
  { id: 'profile', icon: User },
];

/** iOS-style status bar, only used inside device mockups. */
export function StatusBar() {
  return (
    <div className="flex h-[54px] items-end justify-between px-8 pb-2 text-paper">
      <span className="num text-[15px] font-medium tracking-tight">9:41</span>
      <span className="flex items-center gap-1.5">
        <svg width="18" height="11" viewBox="0 0 18 11" fill="currentColor" aria-hidden="true">
          <rect x="0" y="7" width="3" height="4" rx="0.8" />
          <rect x="5" y="5" width="3" height="6" rx="0.8" />
          <rect x="10" y="2.5" width="3" height="8.5" rx="0.8" />
          <rect x="15" y="0" width="3" height="11" rx="0.8" />
        </svg>
        <svg width="16" height="11" viewBox="0 0 16 11" fill="currentColor" aria-hidden="true">
          <path d="M8 2.2c2.3 0 4.4.9 6 2.4l1.2-1.2A10.3 10.3 0 0 0 8 .5 10.3 10.3 0 0 0 .8 3.4L2 4.6a8.6 8.6 0 0 1 6-2.4Zm0 3.4c1.4 0 2.6.5 3.6 1.4l1.2-1.2A6.9 6.9 0 0 0 8 3.9a6.9 6.9 0 0 0-4.8 1.9L4.4 7c1-.9 2.2-1.4 3.6-1.4Zm0 3.3c-.5 0-1 .2-1.3.6L8 10.8l1.3-1.3c-.3-.4-.8-.6-1.3-.6Z" />
        </svg>
        <span className="ml-0.5 flex h-[12px] w-[25px] items-center rounded-[4px] border border-paper/40 p-[1.5px]">
          <span className="h-full w-[75%] rounded-[2px] bg-paper" />
        </span>
      </span>
    </div>
  );
}

export function TabBar({ active }: { active: TabId }) {
  const { t } = useI18n();
  return (
    <nav className="absolute inset-x-0 bottom-0 border-t border-line-night bg-night-1/95 px-2 pb-7 pt-2 backdrop-blur">
      <ul className="grid grid-cols-4">
        {tabs.map(({ id, icon: Icon }) => {
          const on = id === active;
          return (
            <li key={id} className="flex min-h-tap flex-col items-center justify-center gap-1">
              <Icon size={22} strokeWidth={on ? 2 : 1.6} className={on ? 'text-accent-300' : 'text-mute-night'} />
              <span className={`max-w-full truncate px-1 text-[11px] ${on ? 'text-paper' : 'text-mute-night'}`}>
                {t(`tabs.${id}`)}
              </span>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Screen header: back button plus small context line. */
export function ScreenHeader({ context }: { context?: string }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-1 px-3">
      <span
        className="flex h-tap w-tap items-center justify-center rounded-full text-paper"
        aria-label={t('common.back')}
      >
        <ChevronLeft size={24} strokeWidth={1.8} />
      </span>
      {context && <span className="truncate text-label text-mute-night">{context}</span>}
    </div>
  );
}

export function PhoneScreen({ children, tab }: { children: ReactNode; tab: TabId }) {
  return (
    <div className="relative h-full w-full overflow-hidden bg-night text-paper">
      <StatusBar />
      {children}
      <TabBar active={tab} />
    </div>
  );
}
