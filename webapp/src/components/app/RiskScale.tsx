import { useI18n } from '../../i18n';

interface RiskScaleProps {
  selected: number;
  capacity: number;
}

/**
 * The 1–10 scale with the user's capacity marked on it. Levels up to capacity
 * fill green; selected levels above capacity fill amber.
 */
export function RiskScale({ selected, capacity }: RiskScaleProps) {
  const { t } = useI18n();
  const capacityLeft = `${(capacity / 10) * 100}%`;
  return (
    <div className="relative pt-8">
      <span
        className="absolute top-0 -translate-x-1/2 whitespace-nowrap rounded-full bg-accent-400/15 px-2 py-0.5 text-micro text-accent-300"
        style={{ left: capacityLeft }}
      >
        {t('risk.capacity')} · {capacity}
      </span>
      <div className="relative">
        <div className="grid h-3 grid-cols-10 gap-[3px]">
          {Array.from({ length: 10 }, (_, i) => {
            const level = i + 1;
            const color = level > selected ? 'bg-night-3' : level > capacity ? 'bg-caution-400' : 'bg-accent-400';
            return <span key={level} className={`rounded-full ${color}`} />;
          })}
        </div>
        <span
          className="absolute -top-1.5 h-6 w-[2px] -translate-x-1/2 rounded bg-paper"
          style={{ left: capacityLeft }}
        />
      </div>
      <div className="mt-2 grid grid-cols-10 text-center text-[11px] text-mute-night">
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} className="num">
            {i + 1}
          </span>
        ))}
      </div>
    </div>
  );
}
