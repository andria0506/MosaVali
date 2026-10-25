import { getDemoBanks } from '../../services/demo';
import { useApi } from '../../services/useApi';
import { useI18n } from '../../i18n';
import { Reveal } from '../ui/Reveal';
import { SectionHeading } from './SectionHeading';

const monogram = (code: string) => code.slice(0, 2).toUpperCase();

/** The synthetic bank universe the demo connects to (GET /api/personas, or the captured snapshot). */
export function Banks() {
  const { t, locale } = useI18n();
  const demoBanks = useApi(getDemoBanks);
  const banks = Object.entries(demoBanks.data ?? {});

  return (
    <section id="banks" className="scroll-mt-20 bg-night py-section text-paper">
      <div className="mx-auto max-w-page px-4 sm:px-6 lg:px-10">
        <SectionHeading dark title={t('landing.banks.title')} body={t('landing.banks.body')} />
        <ul className="mt-14 grid grid-cols-2 gap-3 md:mt-20 md:gap-4 lg:grid-cols-4">
          {banks.map(([code, bank], i) => (
            <li key={code}>
              <Reveal delay={(i % 4) * 60} className="h-full">
                <div className="relative flex h-full min-h-44 flex-col items-center justify-start gap-4 rounded-card-lg border border-accent-400/40 bg-night-1 p-5 pt-14 text-center md:justify-center md:pt-12">
                  <span className="absolute right-3 top-3 rounded-full bg-accent-400/15 px-2.5 py-1 text-micro text-accent-300">
                    {t('landing.banks.available')}
                  </span>
                  <span
                    className="flex h-14 w-14 items-center justify-center rounded-2xl bg-paper text-label font-medium tracking-wide text-ink"
                    aria-hidden="true"
                  >
                    {monogram(code)}
                  </span>
                  <span className="text-balance text-body md:text-body-lg">{locale === 'ka' ? bank.name_ka : bank.name}</span>
                </div>
              </Reveal>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
