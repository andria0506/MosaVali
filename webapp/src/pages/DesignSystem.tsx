import { Info, ShieldCheck } from 'lucide-react';
import { useI18n } from '../i18n';
import { Button } from '../components/ui/Button';
import { LanguageToggle } from '../components/ui/LanguageToggle';
import { Logo } from '../components/ui/Logo';

/** Living style guide: every token rendered with real Georgian/English copy. */

const swatches: { name: string; className: string; hex: string; dark?: boolean }[] = [
  { name: 'ink', className: 'bg-ink', hex: '#0A0A0A', dark: true },
  { name: 'paper', className: 'bg-paper border border-line', hex: '#FFFFFF' },
  { name: 'canvas', className: 'bg-canvas', hex: '#F5F5F2' },
  { name: 'night', className: 'bg-night', hex: '#050606', dark: true },
  { name: 'night-1', className: 'bg-night-1', hex: '#0E100F', dark: true },
  { name: 'night-2', className: 'bg-night-2', hex: '#151817', dark: true },
  { name: 'night-3', className: 'bg-night-3', hex: '#1D2120', dark: true },
  { name: 'accent-400', className: 'bg-accent-400', hex: '#4FC48A' },
  { name: 'accent-600', className: 'bg-accent-600', hex: '#21875A', dark: true },
  { name: 'caution-400', className: 'bg-caution-400', hex: '#E9AC45' },
];

const typeScale = [
  { token: 'display-xl', className: 'text-display-xl', spec: 'clamp(44–104px) / 300 / −0.045em' },
  { token: 'display', className: 'text-display', spec: 'clamp(36–68px) / 300 / −0.04em' },
  { token: 'title', className: 'text-title', spec: 'clamp(28–40px) / 400 / −0.03em' },
  { token: 'figure', className: 'text-figure num', spec: '44px / 300 / tabular' },
  { token: 'heading', className: 'text-heading', spec: '22px / 500' },
  { token: 'body-lg', className: 'text-body-lg', spec: '18px / 1.6' },
  { token: 'body', className: 'text-body', spec: '16px / 1.55' },
  { token: 'label', className: 'text-label', spec: '14px / 1.4' },
  { token: 'micro', className: 'text-micro', spec: '12px / 1.35' },
];

export default function DesignSystem() {
  const { t, money } = useI18n();
  return (
    <main className="mx-auto max-w-page px-4 py-10 sm:px-6 lg:px-10">
      <header className="flex items-center justify-between gap-4">
        <Logo />
        <LanguageToggle />
      </header>
      <h1 className="mt-16 text-display">{t('design.title')}</h1>

      <section className="mt-16">
        <h2 className="text-heading">{t('design.colors')}</h2>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {swatches.map((s) => (
            // Labels sit under the swatch: text on some swatch colors can't reach 4.5:1 contrast.
            <div key={s.name}>
              <div className={`h-20 rounded-card ${s.className}`} />
              <p className="mt-2 text-label text-ink">{s.name}</p>
              <p className="num text-micro text-mute">{s.hex}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-20">
        <h2 className="text-heading">{t('design.type')}</h2>
        <div className="mt-6 divide-y divide-line">
          {typeScale.map((row) => (
            <div key={row.token} className="grid gap-2 py-6 md:grid-cols-[180px_1fr]">
              <div>
                <p className="text-label">{row.token}</p>
                <p className="text-micro text-mute">{row.spec}</p>
              </div>
              <p className={`break-words-ka ${row.className}`}>
                {row.token.startsWith('figure') ? money({ amount: 24500, currency: 'GEL' }) : t('design.sample')}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-20">
        <h2 className="text-heading">{t('design.components')}</h2>
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <div className="space-y-4 rounded-card-lg bg-canvas p-6">
            <div className="flex flex-wrap gap-3">
              <Button size="lg">{t('design.primary')}</Button>
              <Button size="lg" variant="secondary">
                {t('design.secondary')}
              </Button>
            </div>
            <Button size="lg" className="w-full max-w-sm">
              {t('app.connect.allow')}
            </Button>
          </div>

          <div className="space-y-4 rounded-card-lg bg-night p-6 text-paper">
            <div className="flex flex-wrap gap-3">
              <Button size="lg" variant="accent">
                {t('design.primary')}
              </Button>
              <Button size="lg" variant="inverse">
                {t('design.secondary')}
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-accent-400/15 px-3 py-1.5 text-label text-accent-300">
                {t('design.toneSafe')}
              </span>
              <span className="rounded-full bg-night-3 px-3 py-1.5 text-label text-paper/80">
                {t('design.toneNeutral')}
              </span>
              <span className="rounded-full bg-caution-400/15 px-3 py-1.5 text-label text-caution-300">
                {t('design.toneCaution')}
              </span>
            </div>
            <div className="rounded-card border border-line-night bg-night-1 p-5">
              <p className="flex items-center gap-2 text-label text-mute-night">
                <ShieldCheck size={16} className="text-accent-400" /> {t('buffer.protected')}
              </p>
              <p className="num mt-2 text-figure">{money({ amount: 11900, currency: 'GEL' })}</p>
            </div>
            <div className="rounded-card border border-caution-400/30 bg-caution-400/10 p-5">
              <p className="flex items-center gap-2 text-body font-medium text-caution-300">
                <Info size={18} /> {t('risk.above')}
              </p>
              <p className="mt-2 text-label text-paper/90">{t('reasons.risk.fixed_target')}</p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
