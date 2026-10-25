import { Landmark } from 'lucide-react';
import { api } from '../../services/backend';
import { useApi } from '../../services/useApi';
import { useI18n } from '../../i18n';

/** "1 $ = 2.70 ₾ · backend snapshot" — shown wherever USD prices are converted. */
export function RateNote() {
  const { t, num } = useI18n();
  const market = useApi(api.market);
  const rate = market.data?.snapshot.fx_spot;
  if (!rate) return <p className="h-5" aria-hidden="true" />;
  return (
    <p className="flex items-center gap-2 text-label text-mute-night">
      <Landmark size={15} className="shrink-0" />
      <span className="num">{t('app.rate.backend', { rate: num(rate, 4) })}</span>
    </p>
  );
}
