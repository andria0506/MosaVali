import { Area, AreaChart, Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useI18n } from '../../i18n';
import type { Currency, MonthlyPoint } from '../../types';

/**
 * Asset colors for the backend's asset keys: an ordered encoding from safest to
 * most market-exposed. Greens = deposits and bonds; neutrals = market assets.
 */
export const assetColor: Record<string, string> = {
  CASH: '#D9F5E5',
  LIQ: '#B8EBD0',
  USD_CASH: '#7BD8A8',
  GEL_DEP: '#4FC48A',
  USD_DEP: '#35A86F',
  TBILL: '#1F8A5B',
  ETF: '#E6E6E3',
  STOCK: '#8C8F8E',
};

const AXIS = { fontSize: 11, fill: '#9AA19E' };

function ChartTooltip({
  active,
  payload,
  label,
  currency,
}: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
  currency: Currency;
}) {
  const { money, date } = useI18n();
  if (!active || !payload?.length || !label) return null;
  return (
    <div className="rounded-xl border border-line-night bg-night-2 px-3 py-2 text-label shadow-lg">
      <p className="text-micro text-mute-night">{date(`${label}-01`)}</p>
      <p className="num text-paper">{money({ amount: payload[0].value, currency })}</p>
    </div>
  );
}

/** Single-series trend (savings, goal progress). Title names the series, so no legend. */
export function TrendChart({ data, currency, height = 150 }: { data: MonthlyPoint[]; currency: Currency; height?: number }) {
  const { t } = useI18n();
  const monthTick = (m: string) => t(`months.short.${Number(m.slice(5, 7)) - 1}`);
  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4FC48A" stopOpacity={0.28} />
              <stop offset="100%" stopColor="#4FC48A" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="month" tickFormatter={monthTick} tick={AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
          <YAxis hide domain={['dataMin - 300', 'dataMax + 300']} />
          <Tooltip content={<ChartTooltip currency={currency} />} cursor={{ stroke: '#9AA19E', strokeWidth: 1, strokeDasharray: '3 3' }} />
          <Area
            type="monotone"
            dataKey="value"
            stroke="#4FC48A"
            strokeWidth={2}
            fill="url(#trendFill)"
            activeDot={{ r: 5, stroke: '#151817', strokeWidth: 2, fill: '#4FC48A' }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Stock price over time (USD). Neutral line color on purpose: a price going up or down is
 * neither "safe" nor "caution". Single series, so no legend — the card title names it.
 */
export function PriceChart({ points, height = 140 }: { points: { date: string; value: number }[]; height?: number }) {
  const { t, num, date } = useI18n();
  const monthTick = (d: string) => t(`months.short.${Number(d.slice(5, 7)) - 1}`);
  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        <AreaChart data={points} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#E6E6E3" stopOpacity={0.18} />
              <stop offset="100%" stopColor="#E6E6E3" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="date" tickFormatter={monthTick} tick={AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={36} />
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <Tooltip
            cursor={{ stroke: '#9AA19E', strokeWidth: 1, strokeDasharray: '3 3' }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <div className="rounded-xl border border-line-night bg-night-2 px-3 py-2 text-label shadow-lg">
                  <p className="text-micro text-mute-night">{date(String(label), 'day')}</p>
                  <p className="num text-paper">${num(Number(payload[0].value), 2)}</p>
                </div>
              ) : null
            }
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke="#E6E6E3"
            strokeWidth={2}
            fill="url(#priceFill)"
            activeDot={{ r: 5, stroke: '#151817', strokeWidth: 2, fill: '#E6E6E3' }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Monthly bars with an average line (income). Weak months are not colored red — only shown lower. */
export function MonthlyBars({ data, average, currency }: { data: MonthlyPoint[]; average: number; currency: Currency }) {
  const { t } = useI18n();
  const monthTick = (m: string) => t(`months.short.${Number(m.slice(5, 7)) - 1}`);
  return (
    <div style={{ height: 160 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 4 }} barCategoryGap={3}>
          <XAxis dataKey="month" tickFormatter={monthTick} tick={AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
          <YAxis hide domain={[0, 'dataMax']} />
          <Tooltip content={<ChartTooltip currency={currency} />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
          <ReferenceLine y={average} stroke="#9AA19E" strokeDasharray="4 4" />
          <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.month} fill={d.value < average * 0.6 ? '#8C8F8E' : '#4FC48A'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Stacked allocation bar with a 2px gap between segments, plus a labeled legend. */
export function AllocationBar({
  slices,
  showLegend = true,
}: {
  slices: { asset: string; share: number; label: string }[];
  showLegend?: boolean;
}) {
  const { num } = useI18n();
  return (
    <div>
      <div className="flex h-3 gap-[2px] overflow-hidden rounded-full">
        {slices.map((s) => (
          <span
            key={s.asset}
            style={{ width: `${s.share * 100}%`, background: assetColor[s.asset] ?? '#8C8F8E' }}
            title={s.label}
          />
        ))}
      </div>
      {showLegend && (
        <ul className="mt-4 space-y-2">
          {slices.map((s) => (
            <li key={s.asset} className="flex items-center justify-between gap-3 text-label">
              <span className="flex min-w-0 items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: assetColor[s.asset] ?? '#8C8F8E' }} />
                <span className="truncate text-paper/85">{s.label}</span>
              </span>
              <span className="num shrink-0">{num(s.share * 100, 0)}%</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Horizontal bar centered on zero: gains go right in green, losses left in neutral (never red). */
export function DivergingBar({ pct, scale = 30 }: { pct: number; scale?: number }) {
  const width = `${(Math.min(Math.abs(pct), scale) / scale) * 50}%`;
  return (
    <div className="relative h-2 rounded-full bg-night-3">
      <span className="absolute inset-y-[-3px] left-1/2 w-px bg-paper/30" />
      <span
        className={`absolute inset-y-0 rounded-full transition-all duration-300 ${pct >= 0 ? 'left-1/2 bg-accent-400' : 'right-1/2 bg-paper/55'}`}
        style={{ width }}
      />
    </div>
  );
}
