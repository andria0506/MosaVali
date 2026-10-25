import { useI18n } from '../../i18n';
import type { Locale } from '../../types';

const options: { id: Locale; label: string }[] = [
  { id: 'ka', label: 'ქა' },
  { id: 'en', label: 'EN' },
];

export function LanguageToggle({ dark = false }: { dark?: boolean }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <div
      role="group"
      aria-label={t('nav.language')}
      className={`inline-flex rounded-full p-1 ${dark ? 'bg-night-2' : 'bg-canvas'}`}
    >
      {options.map((o) => {
        const active = o.id === locale;
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={active}
            onClick={() => setLocale(o.id)}
            className={`min-h-tap min-w-tap rounded-full px-3 text-label transition-colors ${
              active
                ? dark
                  ? 'bg-night-4 text-paper'
                  : 'bg-paper text-ink shadow-sm'
                : dark
                  ? 'text-mute-night hover:text-paper'
                  : 'text-mute hover:text-ink'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
