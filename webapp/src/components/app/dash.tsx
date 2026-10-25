/**
 * Dashboard building blocks for the app tabs: a wide page frame, a page header with actions and
 * underline tabs, thin-bordered panels with small titles, a key-figure strip, key-value rows,
 * thin bars, a ring chart and a sparkline. Dense on desktop, one column on phones.
 */
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronLeft } from 'lucide-react';
import { Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, YAxis } from 'recharts';
import { useState, type ReactNode } from 'react';

// ---------- Frame ----------

/** Wide page frame for the five tabs (the narrow `Screen` stays for flows). */
export function Page({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-[76rem] px-4 pb-12 pt-3 sm:px-5 lg:px-8 lg:pt-8">{children}</div>;
}

/** Title row: optional back link, title + one-line subtitle, actions on the right, tabs underneath. */
export function PageHead({
  title,
  sub,
  back,
  badge,
  actions,
  tabs,
}: {
  title: ReactNode;
  sub?: ReactNode;
  back?: { to: string; label: string };
  badge?: ReactNode;
  actions?: ReactNode;
  tabs?: ReactNode;
}) {
  return (
    <header className="mb-5 lg:mb-6">
      {back && (
        <Link to={back.to} className="-ml-1 mb-1 inline-flex min-h-tap items-center gap-1 text-label text-mute-night hover:text-paper">
          <ChevronLeft size={16} /> {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-balance text-[1.75rem] font-normal leading-tight tracking-[-0.03em] lg:text-[2rem]">{title}</h1>
            {badge}
          </div>
          {sub && <p className="mt-1 text-label text-mute-night">{sub}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {tabs && <div className="mt-5">{tabs}</div>}
    </header>
  );
}

/** Underline tabs (in-page sections or filters). */
export function UnderlineTabs<T extends string>({
  value,
  onChange,
  items,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { id: T; label: ReactNode }[];
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="-mx-4 flex gap-1 overflow-x-auto border-b border-line-night px-4 sm:mx-0 sm:px-0">
      {items.map((it) => {
        const on = it.id === value;
        return (
          <button
            key={it.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(it.id)}
            className={`relative min-h-tap shrink-0 px-3 text-label transition-colors ${on ? 'text-paper' : 'text-mute-night hover:text-paper'}`}
          >
            {it.label}
            <span className={`absolute inset-x-2 -bottom-px h-[2px] rounded-full ${on ? 'bg-accent-400' : 'bg-transparent'}`} />
          </button>
        );
      })}
    </div>
  );
}

// ---------- Panels ----------

/** A thin-bordered panel with a small title row. `flush` drops the body padding (tables, lists). */
export function Panel({
  title,
  sub,
  action,
  children,
  className = '',
  flush = false,
  tone,
  id,
}: {
  title?: ReactNode;
  sub?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  flush?: boolean;
  tone?: 'caution' | 'safe';
  id?: string;
}) {
  const toneClass =
    tone === 'caution'
      ? 'border-caution-400/30 bg-caution-400/[0.06]'
      : tone === 'safe'
        ? 'border-accent-400/25 bg-accent-400/[0.05]'
        : 'border-line-night bg-gradient-to-b from-night-1 to-night-1/60';
  return (
    <section id={id} className={`scroll-mt-20 rounded-[1.25rem] border ${toneClass} ${className}`}>
      {(title || action) && (
        <div className="flex items-start justify-between gap-3 px-5 pt-4">
          <div className="min-w-0">
            {title && <h2 className="text-label font-medium text-paper">{title}</h2>}
            {sub && <p className="mt-0.5 text-micro text-mute-night">{sub}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className={flush ? 'mt-3' : 'px-5 pb-5 pt-3'}>{children}</div>
    </section>
  );
}

/** A row of key figures separated by hairlines: label, value, optional coloured sub-line. */
export function Kpis({ items }: { items: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: 'safe' | 'caution' }[] }) {
  return (
    <div className="grid grid-cols-2 overflow-hidden rounded-[1.25rem] border border-line-night bg-night-1 md:grid-flow-col md:auto-cols-fr md:grid-cols-none">
      {items.map((k, i) => (
        <div
          key={i}
          className={`min-w-0 px-4 py-4 sm:px-5 ${i % 2 === 1 ? 'border-l border-line-night' : ''} ${i >= 2 ? 'border-t border-line-night md:border-t-0' : ''} ${i > 0 ? 'md:border-l' : ''}`}
        >
          <p className="text-micro leading-snug text-mute-night">{k.label}</p>
          <p className={`num mt-1.5 truncate text-[1.375rem] leading-tight tracking-[-0.02em] ${k.tone === 'safe' ? 'text-accent-300' : k.tone === 'caution' ? 'text-caution-300' : 'text-paper'}`}>
            {k.value}
          </p>
          {k.sub && <p className="mt-1 truncate text-micro text-mute-night">{k.sub}</p>}
        </div>
      ))}
    </div>
  );
}

/** Dense label → value rows. */
export function KV({ rows }: { rows: { label: ReactNode; value: ReactNode; tone?: 'safe' | 'caution' | 'mute' }[] }) {
  return (
    <dl className="divide-y divide-line-night/70">
      {rows.map((r, i) => (
        <div key={i} className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
          <dt className="min-w-0 text-label text-mute-night">{r.label}</dt>
          <dd
            className={`num max-w-[65%] text-right text-label ${
              r.tone === 'safe' ? 'text-accent-300' : r.tone === 'caution' ? 'text-caution-300' : r.tone === 'mute' ? 'text-mute-night' : 'text-paper'
            }`}
          >
            {r.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Label, thin bar and value on one line (allocations, factors, comparisons). */
export function BarRow({ label, share, value, tone = 'safe' }: { label: ReactNode; share: number; value: ReactNode; tone?: 'safe' | 'caution' | 'neutral' }) {
  const color = tone === 'caution' ? 'bg-caution-400' : tone === 'neutral' ? 'bg-paper/60' : 'bg-accent-400';
  return (
    <div className="grid grid-cols-[minmax(6.5rem,1fr)_minmax(2.5rem,9rem)_auto] items-center gap-3 py-2">
      <span className="truncate text-label text-paper/85">{label}</span>
      <span className="h-1.5 overflow-hidden rounded-full bg-night-3">
        <span className={`block h-full rounded-full ${color}`} style={{ width: `${Math.max(0, Math.min(1, share)) * 100}%` }} />
      </span>
      <span className="num w-16 text-right text-label">{value}</span>
    </div>
  );
}

/**
 * "Show more": secondary detail stays folded until asked for, so a screen leads with its answer.
 * `inline` is the small text toggle inside a panel; the default is a full-width page-level button.
 */
export function More({ label, lessLabel, children, inline = false }: { label: ReactNode; lessLabel: ReactNode; children: ReactNode; inline?: boolean }) {
  const [open, setOpen] = useState(false);
  const button = inline
    ? 'mt-3 inline-flex min-h-tap items-center gap-1 text-label text-accent-300 hover:text-accent-400'
    : 'mt-4 flex min-h-tap w-full items-center justify-center gap-2 rounded-[1.25rem] border border-line-night bg-night-1 text-label text-paper/85 transition-colors hover:border-paper/25 hover:text-paper';
  return (
    <>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={button}>
        {open ? lessLabel : label}
        <ChevronDown size={16} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && children}
    </>
  );
}

// ---------- Tables ----------

export const th = 'px-5 pb-2 text-left text-[11px] font-medium uppercase tracking-[0.06em] text-mute-night';
export const td = 'px-5 py-3 text-label';

// ---------- Charts ----------

/** Ring chart with the total in the middle and a legend beside it. */
export function Ring({
  slices,
  centerLabel,
  centerValue,
  legendValue,
}: {
  slices: { key: string; label: string; value: number; color: string }[];
  centerLabel: string;
  centerValue: string;
  legendValue: (v: number, share: number) => string;
}) {
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-5">
      <div className="relative h-36 w-36 shrink-0" aria-hidden>
        <ResponsiveContainer>
          <PieChart>
            <Pie rootTabIndex={-1} data={slices} dataKey="value" innerRadius="72%" outerRadius="100%" paddingAngle={slices.length > 1 ? 2 : 0} stroke="none" isAnimationActive={false}>
              {slices.map((s) => (
                <Cell key={s.key} fill={s.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-micro text-mute-night">{centerLabel}</span>
          <span className="num text-label font-medium">{centerValue}</span>
        </div>
      </div>
      <ul className="w-full min-w-0 space-y-2">
        {slices.map((s) => (
          <li key={s.key} className="flex items-start gap-2 text-label">
            <span className="mt-[7px] h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} />
            <span className="min-w-0 flex-1">
              <span className="block text-paper/85">{s.label}</span>
              <span className="num block text-micro text-mute-night">{legendValue(s.value, s.value / total)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Tiny line, coloured by direction. */
export function Sparkline({ points, width = 96, height = 32 }: { points: number[]; width?: number; height?: number }) {
  if (points.length < 2) return <span style={{ width, height }} className="inline-block" />;
  const up = points[points.length - 1] >= points[0];
  return (
    <span style={{ width, height }} className="inline-block" aria-hidden>
      <ResponsiveContainer>
        <LineChart data={points.map((v, i) => ({ i, v }))} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <Line type="monotone" dataKey="v" stroke={up ? '#4FC48A' : '#E9AC45'} strokeWidth={1.5} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </span>
  );
}

/** Small pill showing a signed change, green up / amber down. */
export function Change({ value, children }: { value: number; children: ReactNode }) {
  return (
    <span className={`num inline-flex items-center rounded-full px-2 py-0.5 text-micro ${value >= 0 ? 'bg-accent-400/15 text-accent-300' : 'bg-caution-400/15 text-caution-300'}`}>
      {children}
    </span>
  );
}
