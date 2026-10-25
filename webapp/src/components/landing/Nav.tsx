import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { useI18n } from '../../i18n';
import { Logo } from '../ui/Logo';
import { LanguageToggle } from '../ui/LanguageToggle';

const links = ['problem', 'features', 'banks', 'security'] as const;

/**
 * One floating glass bar for the whole page. Dark translucent glass reads the same over the light
 * and the dark sections, so the header never turns gray on scroll.
 */
export function Nav() {
  const { t } = useI18n();
  return (
    <header className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-4">
      <div className="mx-auto flex h-14 max-w-page items-center justify-between gap-4 rounded-full border border-white/10 bg-night/90 pl-4 pr-2 text-paper shadow-[0_8px_30px_rgba(0,0,0,0.18)] backdrop-blur-xl backdrop-saturate-150 sm:pl-6 md:h-16">
        <Link to="/" className="flex min-h-tap items-center text-paper" aria-label="MosaVali">
          <Logo />
        </Link>

        <nav className="hidden lg:block" aria-label="Main">
          <ul className="flex items-center gap-10">
            {links.map((id) => (
              <li key={id}>
                <a href={`#${id}`} className="text-body text-paper/75 transition-colors hover:text-paper">
                  {t(`nav.${id}`)}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex items-center gap-2 sm:gap-3">
          <LanguageToggle dark />
          <Link
            to="/app"
            className="hidden min-h-tap items-center gap-2.5 rounded-full bg-paper py-1.5 pl-1.5 pr-5 text-label text-ink transition-colors hover:bg-canvas sm:inline-flex"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full border border-ink/20">
              <ArrowUpRight size={16} />
            </span>
            {t('nav.launch')}
          </Link>
        </div>
      </div>
    </header>
  );
}
