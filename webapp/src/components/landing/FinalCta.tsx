import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { ButtonLink } from '../ui/Button';
import { LanguageToggle } from '../ui/LanguageToggle';
import { Logo } from '../ui/Logo';
import { Reveal } from '../ui/Reveal';

const navLinks = ['problem', 'features', 'how', 'banks', 'security'] as const;

export function FinalCta() {
  const { t } = useI18n();
  return (
    <footer className="bg-night text-paper">
      <div className="mx-auto max-w-page px-4 py-section text-center sm:px-6 lg:px-10">
        <Reveal>
          <h2 className="text-balance text-display-xl">{t('landing.cta.title')}</h2>
          <div className="mt-10 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
            <ButtonLink to="/app/welcome" variant="accent" size="lg">
              {t('landing.cta.button')}
            </ButtonLink>
          </div>
        </Reveal>
      </div>

      <div className="border-t border-line-night">
        <div className="mx-auto grid max-w-page gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1fr_auto] lg:px-10">
          <div className="max-w-xl">
            <Link to="/" className="inline-flex min-h-tap items-center text-paper" aria-label="MosaVali">
              <Logo />
            </Link>
            <p className="mt-4 text-micro leading-relaxed text-mute-night">{t('landing.footer.disclaimer')}</p>
            <p className="mt-4 text-micro text-mute-night">{t('landing.footer.rights')}</p>
          </div>
          <div className="flex flex-col items-start gap-6 md:items-end">
            <ul className="flex flex-wrap gap-x-6 gap-y-1">
              {navLinks.map((id) => (
                <li key={id}>
                  <a href={`#${id}`} className="inline-flex min-h-tap items-center text-label text-mute-night hover:text-paper">
                    {t(`nav.${id}`)}
                  </a>
                </li>
              ))}
            </ul>
            <LanguageToggle dark />
          </div>
        </div>
      </div>
    </footer>
  );
}
