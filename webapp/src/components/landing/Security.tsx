import { Eye, Landmark, Scale } from 'lucide-react';
import { useI18n } from '../../i18n';
import { Reveal } from '../ui/Reveal';
import { SectionHeading } from './SectionHeading';

const items = [
  { id: 'read', icon: Eye },
  { id: 'hold', icon: Landmark },
  { id: 'honest', icon: Scale },
] as const;

export function Security() {
  const { t } = useI18n();
  return (
    <section id="security" className="scroll-mt-20 bg-paper py-section">
      <div className="mx-auto max-w-page px-4 sm:px-6 lg:px-10">
        <SectionHeading eyebrow={t('landing.security.eyebrow')} title={t('landing.security.title')} />
        <ul className="mt-14 grid gap-4 md:mt-20 md:grid-cols-3">
          {items.map(({ id, icon: Icon }, i) => (
            <li key={id}>
              <Reveal delay={i * 90} className="h-full">
                <div className="h-full rounded-card-lg bg-canvas p-6 md:p-8">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-paper">
                    <Icon size={20} strokeWidth={1.6} />
                  </span>
                  <h3 className="mt-8 text-heading font-normal">{t(`landing.security.${id}.title`)}</h3>
                  <p className="mt-3 text-body text-mute">{t(`landing.security.${id}.body`)}</p>
                </div>
              </Reveal>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
