import { useEffect, useRef } from 'react';
import { ArrowDown } from 'lucide-react';
import { useI18n } from '../../i18n';
import { ButtonLink } from '../ui/Button';
import { DeviceMockup } from './DeviceMockup';
import { BufferScreen, ProfileScreen, RiskScreen } from './ScreenPreviews';

/**
 * Scroll progress of the phone stage, written to the CSS variable --p (0 → 1).
 * Written straight to the DOM so scrolling doesn't re-render React.
 */
function useStageProgress() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.style.setProperty('--p', '1');
      el.dataset.settled = 'true';
      return;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      const vh = window.innerHeight;
      const top = el.getBoundingClientRect().top;
      const raw = Math.min(1, Math.max(0, (vh * 0.85 - top) / (vh * 0.6)));
      const eased = 1 - Math.pow(1 - raw, 3);
      el.style.setProperty('--p', eased.toFixed(4));
      // Once flat, drop the 3D transform so the phone screens render crisp.
      el.dataset.settled = String(eased > 0.999);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  return ref;
}

export function Hero() {
  const { t } = useI18n();
  const stageRef = useStageProgress();
  const lines = ['hero.line1', 'hero.line2', 'hero.line3'];

  return (
    <section className="relative overflow-x-clip pt-28 md:pt-36">
      <div className="mx-auto max-w-page px-4 text-center sm:px-6">
        <h1 className="text-balance text-display-xl text-ink">
          {lines.map((key, i) => (
            <span key={key} className="block animate-fade-up" style={{ animationDelay: `${i * 110}ms` }}>
              {t(key)}
            </span>
          ))}
        </h1>
        <p
          className="mx-auto mt-6 max-w-2xl text-balance text-body text-mute animate-fade-up md:mt-8 md:text-body-lg"
          style={{ animationDelay: '380ms' }}
        >
          {t('hero.sub')}
        </p>
        <div
          className="mt-8 flex flex-col items-stretch justify-center gap-3 animate-fade-up sm:flex-row sm:items-center"
          style={{ animationDelay: '480ms' }}
        >
          <ButtonLink to="/app/welcome" size="lg">
            {t('hero.cta')}
          </ButtonLink>
          <ButtonLink to="#how" variant="secondary" size="lg">
            {t('hero.secondary')}
          </ButtonLink>
        </div>
        <p className="mt-5 text-micro text-mute animate-fade-up" style={{ animationDelay: '560ms' }}>
          {t('hero.disclaimer')}
        </p>
      </div>

      {/* Phone stage: tilted back at first, settles flat and fans out as you scroll. */}
      <div
        ref={stageRef}
        className="relative mx-auto hero-stage mt-12 max-w-page px-4 pb-24 animate-fade-up md:mt-14 md:pb-32"
        style={{ ['--p' as string]: 0, perspective: '1600px', animationDelay: '650ms' }}
      >
        <div
          className="hero-stage-inner relative mx-auto w-[min(76vw,300px)] md:w-[340px] lg:w-[360px]"
          style={{
            transformStyle: 'preserve-3d',
            transform:
              'translateY(calc((1 - var(--p)) * 48px)) rotateX(calc((1 - var(--p)) * 24deg)) scale(calc(0.92 + var(--p) * 0.08))',
            transformOrigin: '50% 0%',
          }}
        >
          <SidePhone side="left" label={t('profile.title')}>
            <ProfileScreen />
          </SidePhone>
          <SidePhone side="right" label={t('risk.title')}>
            <RiskScreen />
          </SidePhone>
          <DeviceMockup label={t('buffer.title')} className="relative z-10 w-full">
            <BufferScreen />
          </DeviceMockup>
        </div>

        <button
          type="button"
          onClick={() => window.scrollBy({ top: window.innerHeight * 0.8, behavior: 'smooth' })}
          aria-label={t('hero.scroll')}
          className="absolute right-6 top-1/3 hidden h-tap w-tap items-center justify-center rounded-full bg-canvas text-ink transition-colors hover:bg-line lg:flex"
        >
          <ArrowDown size={20} strokeWidth={1.6} />
        </button>
      </div>
    </section>
  );
}

function SidePhone({ side, label, children }: { side: 'left' | 'right'; label: string; children: React.ReactNode }) {
  const dir = side === 'left' ? -1 : 1;
  return (
    <div
      className="absolute inset-x-0 top-[7%] hidden md:block"
      style={{
        transform: `translateX(calc(var(--p) * ${dir * 88}%)) rotate(calc((1 - var(--p)) * ${dir * 5}deg)) scale(0.88)`,
        // Hidden until the stage starts settling, then fades in as it fans out.
        opacity: 'calc((var(--p) - 0.35) * 1.6)',
      }}
    >
      <DeviceMockup label={label} className="w-full">
        {children}
      </DeviceMockup>
    </div>
  );
}
