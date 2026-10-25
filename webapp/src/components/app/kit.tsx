/**
 * Building blocks for app screens. Dark surfaces, one idea per screen,
 * big numbers, 44px tap targets.
 */
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { CalendarCheck, ChevronDown, Cpu, Info, ShieldCheck, X } from 'lucide-react';
import { useI18n } from '../../i18n';
import type { Assumption, Tone } from '../../types';

// ---------- Layout ----------

export function Screen({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className={`mx-auto w-full px-5 pb-10 pt-2 lg:pt-10 ${wide ? 'max-w-4xl' : 'max-w-2xl'}`}>{children}</div>
  );
}

export function PageTitle({ title, lead, eyebrow }: { title: string; lead?: string; eyebrow?: string }) {
  return (
    <header className="mb-6">
      {eyebrow && <p className="mb-2 text-label text-mute-night">{eyebrow}</p>}
      <h1 className="whitespace-pre-line text-balance text-[2rem] font-light leading-[1.15] tracking-[-0.03em] md:text-[2.5rem]">
        {title}
      </h1>
      {lead && <p className="mt-3 text-body text-mute-night">{lead}</p>}
    </header>
  );
}

export function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 mt-8 flex items-center justify-between gap-4">
      <h2 className="text-label font-medium text-mute-night">{children}</h2>
      {action}
    </div>
  );
}

export function Card({
  children,
  className = '',
  tone,
}: {
  children: ReactNode;
  className?: string;
  tone?: Tone;
}) {
  const toneClass =
    tone === 'caution'
      ? 'border-caution-400/30 bg-caution-400/10'
      : tone === 'safe'
        ? 'border-accent-400/25 bg-accent-400/[0.07]'
        : 'border-line-night bg-gradient-to-b from-night-1 to-night-1/60';
  return <div className={`app-card rounded-[1.25rem] border p-5 ${toneClass} ${className}`}>{children}</div>;
}

/** Sticky action area at the bottom of a screen; sits above the tab bar when there is one.
 *  The trailing spacer lets the last card scroll fully clear of the pinned bar.
 *  Long screens whose main actions live in the content (Decide) use sticky={false}. */
export function ActionBar({ children, sticky = true }: { children: ReactNode; sticky?: boolean }) {
  if (!sticky) return <div className="mt-8 flex flex-col gap-2">{children}</div>;
  return (
    <>
      <div
        className="sticky z-20 -mx-5 mt-8 bg-gradient-to-t from-night via-night/95 to-night/0 px-5 pb-4 pt-6"
        style={{ bottom: 'var(--tabbar-h, 0px)' }}
      >
        <div className="flex flex-col gap-2">{children}</div>
      </div>
      <div aria-hidden style={{ height: 'calc(var(--tabbar-h, 0px) + 9rem)' }} />
    </>
  );
}

// ---------- Numbers ----------

export function Stat({
  label,
  value,
  sub,
  size = 'lg',
  tone,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  size?: 'lg' | 'md';
  tone?: Tone;
}) {
  const subColor = tone === 'safe' ? 'text-accent-300' : tone === 'caution' ? 'text-caution-300' : 'text-mute-night';
  return (
    <div className="min-w-0">
      <p className="text-label text-mute-night">{label}</p>
      <p className={`num mt-1 ${size === 'lg' ? 'text-figure' : 'text-figure-sm'}`}>{value}</p>
      {sub && <p className={`mt-1 text-label ${subColor}`}>{sub}</p>}
    </div>
  );
}

export function ProgressBar({ value, tone = 'safe', label }: { value: number; tone?: Tone; label?: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const color = tone === 'caution' ? 'bg-caution-400' : tone === 'neutral' ? 'bg-paper/70' : 'bg-accent-400';
  return (
    <div
      className="h-2.5 overflow-hidden rounded-full bg-night-3"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label={label}
    >
      <span className={`block h-full rounded-full transition-[width] duration-700 ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  const cls =
    tone === 'safe'
      ? 'bg-accent-400/15 text-accent-300'
      : tone === 'caution'
        ? 'bg-caution-400/15 text-caution-300'
        : 'bg-night-3 text-paper/80';
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-micro ${cls}`}>{children}</span>;
}

export function ToneIcon({ tone, size = 18 }: { tone: Tone; size?: number }) {
  if (tone === 'caution') return <Info size={size} className="shrink-0 text-caution-300" />;
  if (tone === 'safe') return <ShieldCheck size={size} className="shrink-0 text-accent-400" />;
  return <CalendarCheck size={size} className="shrink-0 text-paper/70" />;
}

// ---------- Inputs ----------

export function ChoiceGrid({ children, cols = 2 }: { children: ReactNode; cols?: 1 | 2 }) {
  return (
    <div role="radiogroup" className={`grid gap-3 ${cols === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
      {children}
    </div>
  );
}

export function Choice({
  selected,
  onSelect,
  children,
  hint,
}: {
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`min-h-[3.5rem] rounded-2xl border px-4 py-3 text-left text-body transition-colors ${
        selected ? 'border-accent-400 bg-accent-400/10 text-paper' : 'border-line-night bg-night-1 text-paper/85 hover:border-paper/30'
      }`}
    >
      <span className="block text-balance">{children}</span>
      {hint && <span className="mt-1 block text-label text-mute-night">{hint}</span>}
    </button>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="mt-5">
      <label htmlFor={id} className="block text-label text-mute-night">
        {label}
      </label>
      <div className="mt-2">{children(id)}</div>
      {hint && <p className="mt-2 text-micro text-mute-night">{hint}</p>}
    </div>
  );
}

const inputClass =
  'w-full min-h-tap rounded-2xl border border-line-night bg-night-1 px-4 py-3 text-body text-paper placeholder:text-mute-night ' +
  'focus:border-accent-400 focus:outline-none focus:ring-2 focus:ring-accent-400/30';

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${props.className ?? ''}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputClass} appearance-none ${props.className ?? ''}`} />;
}

/** Large numeric input with a currency suffix. */
export function MoneyInput({
  id,
  value,
  onChange,
  currency,
  large = false,
}: {
  id?: string;
  value: number | '';
  onChange: (v: number | '') => void;
  currency: 'GEL' | 'USD';
  large?: boolean;
}) {
  return (
    <div className="relative">
      <input
        id={id}
        inputMode="decimal"
        value={value}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^\d]/g, '');
          onChange(raw === '' ? '' : Number(raw));
        }}
        className={`${inputClass} num pr-12 ${large ? 'min-h-[4.5rem] text-figure-sm' : ''}`}
      />
      <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-body text-mute-night">
        {currency === 'GEL' ? '₾' : '$'}
      </span>
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-1 rounded-full bg-night-2 p-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={`min-h-tap rounded-full px-3 text-label transition-colors ${
            value === o.id ? 'bg-paper text-ink' : 'text-mute-night hover:text-paper'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------- Assumptions ----------

export function Assumptions({ items }: { items: Assumption[] }) {
  const { t, num } = useI18n();
  if (!items.length) return null;
  const unit = (a: Assumption) =>
    a.unit === 'GEL' ? ' ₾' : a.unit === 'USD' ? ' $' : a.unit === 'months' ? ` ${t('common.months')}` : a.unit === 'years' ? ` ${t('common.years')}` : a.unit ?? '';
  return (
    <details className="group mt-6 rounded-2xl border border-line-night bg-night-1">
      <summary className="flex min-h-tap cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-label text-mute-night">
        {t('common.assumptions')}
        <ChevronDown size={18} className="transition-transform group-open:rotate-180" />
      </summary>
      <dl className="space-y-2 px-4 pb-4">
        {items.map((a) => (
          <div key={a.code} className="flex items-baseline justify-between gap-4 text-label">
            <dt className="text-mute-night">{t(`assumptions.${a.code}`)}</dt>
            {a.code !== 'fees_excluded' && a.value !== '' && (
              <dd className="num shrink-0 text-paper">
                {typeof a.value === 'number' ? num(a.value, a.code === 'usd_gel_rate' ? 4 : 2) : a.value}
                {unit(a)}
              </dd>
            )}
          </div>
        ))}
      </dl>
    </details>
  );
}

// ---------- States ----------

export function Loading({ blocks = [140, 220, 120] }: { blocks?: number[] }) {
  return (
    <div className="space-y-4 pt-4" aria-busy="true">
      {blocks.map((h, i) => (
        <div key={i} className="animate-pulse rounded-card bg-night-1" style={{ height: h }} />
      ))}
    </div>
  );
}

export function ErrorNote() {
  const { t } = useI18n();
  return (
    <Card tone="caution" className="mt-6">
      <p className="text-body">{t('app.error')}</p>
    </Card>
  );
}

// ---------- Sheet (modal) ----------

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center" role="presentation">
      <button aria-label={t('app.close')} className="absolute inset-0 bg-black/70 animate-fade-up" onClick={onClose} />
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-md rounded-t-card-lg border border-line-night bg-night-1 p-5 pb-8 text-paper outline-none animate-fade-up sm:rounded-card-lg"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-heading font-normal">{title}</h2>
          <button onClick={onClose} aria-label={t('app.close')} className="flex h-tap w-tap items-center justify-center rounded-full hover:bg-night-2">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
// ---------- Disclosure ----------

/** Collapsible block for detail that would otherwise make a screen long. */
export function Details({
  summary,
  children,
  id,
  defaultOpen = false,
}: {
  summary: ReactNode;
  children: ReactNode;
  id?: string;
  defaultOpen?: boolean;
}) {
  return (
    <details id={id} open={defaultOpen} className="group mt-6 scroll-mt-20 rounded-card border border-line-night bg-night-1">
      <summary className="flex min-h-tap cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-body">
        {summary}
        <ChevronDown size={20} className="shrink-0 text-mute-night transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-line-night px-5 pb-5">{children}</div>
    </details>
  );
}

/** Shown instead of blocking when a feature needs something the user hasn't given yet. */
export function UpgradePrompt({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex gap-4 rounded-card border border-dashed border-paper/20 bg-night-1/60 p-5">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-400/15 text-accent-300">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-body">{title}</p>
        {body && <p className="mt-1 text-label text-mute-night">{body}</p>}
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  );
}

/** Marks a number as a machine-learning output, so it's clear which figures the models produced. */
export function ModelChip({ label }: { label: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-accent-400/25 bg-accent-400/[0.07] px-2.5 py-1 text-micro text-accent-300">
      <Cpu size={12} aria-hidden />
      {label}
    </span>
  );
}
