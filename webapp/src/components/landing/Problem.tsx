import { ArrowDown, ArrowRight } from 'lucide-react';
import { useI18n } from '../../i18n';
import { Reveal } from '../ui/Reveal';
import { SectionHeading } from './SectionHeading';

const chain = ['shock', 'noBuffer', 'forcedSale', 'gambling'] as const;
const facts = ['deposits', 'foreign'] as const;

/** Why people think investing is gambling: the chain that starts with no safe buffer. */
export function Problem() {
  const { t } = useI18n();
  return (
    <section id="problem" className="scroll-mt-20 bg-canvas py-section">
      <div className="mx-auto max-w-page px-4 sm:px-6 lg:px-10">
        <SectionHeading eyebrow={t('landing.problem.eyebrow')} title={t('landing.problem.title')} body={t('landing.problem.body')} />

        <ol className="mt-14 grid gap-3 md:mt-20 lg:grid-cols-4 lg:gap-4">
          {chain.map((id, i) => {
            const last = i === chain.length - 1;
            return (
              <li key={id} className="relative">
                <Reveal delay={i * 90} className="h-full">
                  <div
                    className={`flex h-full flex-col rounded-card-lg border p-6 ${
                      last ? 'border-caution-400/40 bg-caution-50' : 'border-line bg-paper'
                    }`}
                  >
                    <span
                      className={`num flex h-8 w-8 items-center justify-center rounded-full text-label ${
                        last ? 'bg-caution-400 text-ink' : 'bg-canvas text-ink'
                      }`}
                    >
                      {i + 1}
                    </span>
                    <p className={`mt-5 text-balance text-heading font-normal ${last ? 'text-caution-700' : 'text-ink'}`}>
                      {t(`landing.problem.chain.${id}.title`)}
                    </p>
                    <p className="mt-2 text-label text-mute">{t(`landing.problem.chain.${id}.body`)}</p>
                  </div>
                </Reveal>
                {!last && (
                  <span
                    aria-hidden="true"
                    className="absolute left-1/2 top-full z-10 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-paper text-mute lg:left-full lg:top-1/2 lg:-translate-y-1/2"
                  >
                    <ArrowDown size={14} className="lg:hidden" />
                    <ArrowRight size={14} className="hidden lg:block" />
                  </span>
                )}
              </li>
            );
          })}
        </ol>

        <div className="mt-4 grid gap-3 md:grid-cols-2 lg:gap-4">
          {facts.map((id, i) => (
            <Reveal key={id} delay={i * 90}>
              <figure className="flex h-full flex-col rounded-card-lg border border-line bg-paper p-6 md:p-8">
                <p className="num text-display text-ink">{t(`landing.problem.facts.${id}.value`)}</p>
                <figcaption className="mt-3 text-body text-ink/80">{t(`landing.problem.facts.${id}.label`)}</figcaption>
                <p className="mt-auto pt-4 text-micro text-mute">{t(`landing.problem.facts.${id}.source`)}</p>
              </figure>
            </Reveal>
          ))}
        </div>

        <Reveal>
          <p className="mx-auto mt-12 max-w-2xl text-balance text-center text-body-lg text-ink">
            <span className="mr-2 inline-block h-2 w-2 -translate-y-0.5 rounded-full bg-accent-500" />
            {t('landing.problem.answer')}
          </p>
        </Reveal>
      </div>
    </section>
  );
}
