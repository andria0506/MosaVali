import { useI18n } from '../../i18n';
import { Reveal } from '../ui/Reveal';
import { SectionHeading } from './SectionHeading';

const steps = ['connect', 'goal', 'plan', 'buy'] as const;

export function HowItWorks() {
  const { t, num } = useI18n();
  return (
    <section id="how" className="scroll-mt-20 bg-paper py-section">
      <div className="mx-auto max-w-page px-4 sm:px-6 lg:px-10">
        <SectionHeading eyebrow={t('landing.how.eyebrow')} title={t('landing.how.title')} />
        <ol className="mt-14 grid gap-x-8 gap-y-12 sm:grid-cols-2 md:mt-20 lg:grid-cols-4">
          {steps.map((id, i) => (
            <li key={id}>
              <Reveal delay={i * 90} className="border-t border-line pt-6">
                <span className="num block text-[3.5rem] font-light leading-none tracking-[-0.04em] text-ink/20">
                  {num(i + 1).padStart(2, '0')}
                </span>
                <h3 className="mt-6 text-heading font-normal">{t(`landing.how.steps.${id}.title`)}</h3>
                <p className="mt-3 text-body text-mute">{t(`landing.how.steps.${id}.body`)}</p>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
