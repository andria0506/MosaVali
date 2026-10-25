import { Link } from 'react-router-dom';
import { ArrowRight, Database, ScrollText } from 'lucide-react';
import { useI18n } from '../../i18n';
import { useSession } from '../../state/SessionContext';
import { LanguageToggle } from '../../components/ui/LanguageToggle';
import { ButtonLink } from '../../components/ui/Button';
import { PersonaSwitcher } from '../../components/app/AppShell';
import { Badge, Loading, Screen } from '../../components/app/kit';
import { KV, Page, PageHead, Panel, td, th } from '../../components/app/dash';

const PRODUCTS = ['current', 'savings', 'term_deposit', 'loan', 'cash'];

/** Profile: who the data belongs to, where it came from, the consent that allowed it, and transparency. */
export default function Profile() {
  const { t, L, money, date } = useI18n();
  const { profile: p, persona } = useSession();
  if (!p) return <Screen><Loading /></Screen>;

  const ing = p.ingestion;
  const bankName = (code: string) => {
    const b = persona?.banks.find((x) => x.code === code);
    return b ? L(b, 'name') || b.name : code;
  };
  const source = persona?.source === 'organiser_xlsx' ? 'organiser' : persona?.source === 'custom' ? 'custom' : 'persona';

  return (
    <Page>
      <PageHead
        title={L(ing.psu, 'name')}
        sub={`${L(ing.psu, 'city')} · ${t('app.profile.historyMonths', { n: ing.months_of_history })}`}
        badge={<Badge tone="caution">{t('app.shell.synthetic')}</Badge>}
        actions={
          <ButtonLink to="/app/profile/privacy" variant="inverse">
            <ScrollText size={16} /> {t('app.profileTab.audit')}
          </ButtonLink>
        }
      />

      {p.partial_data && (
        <Panel tone="caution" className="mb-4">
          <p className="text-label">{t('app.home.partialData')}</p>
        </Panel>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {/* Accounts read with consent */}
          <Panel flush title={t('app.profileTab.accounts')} sub={t('app.profileTab.sourceBody', { n: ing.transaction_count, accounts: ing.accounts.length })}>
            <div className="overflow-x-auto pb-2" tabIndex={0} role="region" aria-label={t('app.profileTab.accounts')}>
              <table className="w-full min-w-[28rem]">
                <thead>
                  <tr>
                    <th className={th}>{t('app.profileTab.colAccount')}</th>
                    <th className={th}>{t('app.profileTab.colBank')}</th>
                    <th className={`${th} text-right`}>{t('app.profileTab.colBalance')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-night/70 border-t border-line-night">
                  {ing.accounts.map((a) => (
                    <tr key={a.id}>
                      <td className={td}>
                        <span className="block">{PRODUCTS.includes(a.product) ? t(`app.profileTab.products.${a.product}`) : a.product}</span>
                        <span className="num block text-micro text-mute-night">
                          •••• {a.iban.slice(-4)}
                          {a.maturity ? ` · ${t('app.profileTab.matures', { date: date(a.maturity, 'day') })}` : ''}
                        </span>
                      </td>
                      <td className={`${td} text-mute-night`}>{L(a, 'bank_name') || a.bank_name}</td>
                      <td className={`${td} text-right`}>
                        <span className="num block">{money({ amount: a.balance, currency: a.currency === 'USD' ? 'USD' : 'GEL' })}</span>
                        {a.currency === 'USD' && <span className="num block text-micro text-mute-night">≈ {money({ amount: a.balance_gel, currency: 'GEL' })}</span>}
                      </td>
                    </tr>
                  ))}
                  {ing.cash_at_home > 0 && (
                    <tr>
                      <td className={td}>{t('app.profileTab.cashAtHome')}</td>
                      <td className={`${td} text-mute-night`}>—</td>
                      <td className={`${td} num text-right`}>{money({ amount: ing.cash_at_home, currency: 'GEL' })}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* Consent and banks */}
          <Panel title={t('app.profile.consentTitle')}>
            <div className="grid gap-3 sm:grid-cols-2">
              {p.consent.banks.map((code) => {
                const ok = (p.consent.bank_status[code] ?? 'ok') === 'ok';
                return (
                  <div key={code} className="flex items-center gap-3 rounded-xl border border-line-night bg-night-2/60 p-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-paper text-micro font-medium tracking-wide text-ink">{code}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-label">{bankName(code)}</span>
                      <span className={`flex items-center gap-1.5 text-micro ${ok ? 'text-accent-300' : 'text-caution-300'}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-accent-400' : 'bg-caution-400'}`} />
                        {t(`app.progress.bankStatus.${ok ? 'ok' : 'timeout'}`)}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="mt-4">
              <KV
                rows={[
                  { label: t('app.profile.consentScopes'), value: p.consent.scopes.map((s) => t(`app.connect.scopes.${s}.title`)).join(', ') },
                  { label: t('app.profile.consentExpires'), value: date(p.consent.expires, 'day') },
                ]}
              />
            </div>
          </Panel>
        </div>

        <div className="space-y-4">
          {/* Where the numbers come from */}
          <Panel title={t('app.profileTab.sourceTitle')}>
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-400/15 text-accent-300">
                <Database size={18} />
              </span>
              <p className="text-label text-paper/90">{t(`app.profileTab.source.${source}`)}</p>
            </div>
            {p.goal_source === 'organiser_assumed' && (
              <div className="mt-3">
                <Badge tone="caution">{t('app.goal.assumed')}</Badge>
              </div>
            )}
          </Panel>

          {/* Transparency */}
          <Link to="/app/profile/privacy" className="block rounded-[1.25rem] border border-line-night bg-gradient-to-br from-accent-400/[0.10] via-night-1 to-night-1 p-5 transition-colors hover:border-paper/25">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-night-3 text-paper/85">
              <ScrollText size={18} />
            </span>
            <span className="mt-4 block text-body">{t('app.profileTab.audit')}</span>
            <span className="mt-1 block text-label text-mute-night">{t('app.profileTab.auditBody')}</span>
            <span className="mt-4 inline-flex items-center gap-1 text-label text-accent-300">
              {t('app.profileTab.open')} <ArrowRight size={16} />
            </span>
          </Link>

          {/* Settings */}
          <Panel title={t('app.profileTab.settings')}>
            <p className="mb-2 text-micro text-mute-night">{t('nav.language')}</p>
            <LanguageToggle dark />
            <p className="mb-2 mt-5 text-micro text-mute-night">{t('app.shell.switchPersona')}</p>
            <PersonaSwitcher full />
            <p className="mt-2 text-micro text-mute-night">{t('app.shell.switchNotice')}</p>
          </Panel>
        </div>
      </div>
    </Page>
  );
}
