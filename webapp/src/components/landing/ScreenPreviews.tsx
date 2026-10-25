/**
 * App screens inside the landing-page phones. They render the backend's real
 * output for the synthetic demo persona (services/demo.ts) — every number is a
 * backend number, labelled synthetic on the page.
 */
import { useI18n } from '../../i18n';
import { getDemo } from '../../services/demo';
import { useApi } from '../../services/useApi';
import { PhoneScreen, ScreenHeader } from '../app/PhoneChrome';
import { RiskScale } from '../app/RiskScale';
import { AllocationBar } from '../app/charts';

function Loading() {
  return (
    <div className="space-y-4 px-6 pt-6">
      {[120, 220, 160].map((h) => (
        <div key={h} className="animate-pulse rounded-card bg-night-1" style={{ height: h }} />
      ))}
    </div>
  );
}

// ---------- Buffer ----------

export function BufferScreen() {
  const { t, L, money } = useI18n();
  const demo = useApi(getDemo);
  const d = demo.data;

  return (
    <PhoneScreen tab="analysis">
      {!d ? (
        <Loading />
      ) : (
        <>
          <ScreenHeader context={L(d.profile.profile.goal)} />
          <div className="px-6">
            <h2 className="text-[30px] font-light leading-tight tracking-[-0.03em]">{t('buffer.title')}</h2>

            <div className="mt-5 rounded-card border border-line-night bg-night-1 p-5">
              <p className="text-label text-mute-night">{t('buffer.total')}</p>
              <p className="num mt-1 text-figure">{money({ amount: d.profile.ingestion.totals.assets_gel, currency: 'GEL' })}</p>
              <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-night-3">
                <span
                  className="bg-accent-400"
                  style={{ width: `${(d.profile.liquidity.buffer_gel / Math.max(1, d.profile.ingestion.totals.assets_gel)) * 100}%` }}
                />
              </div>
              <div className="mt-3 flex justify-between text-label">
                <span className="text-accent-300">{money({ amount: d.profile.liquidity.buffer_gel, currency: 'GEL' })}</span>
                <span className="text-mute-night">{money({ amount: d.profile.liquidity.free_to_invest_gel, currency: 'GEL' })}</span>
              </div>
              <div className="mt-1 flex justify-between text-micro text-mute-night">
                <span>{t('buffer.protected')}</span>
                <span>{t('buffer.free')}</span>
              </div>
            </div>

            <div className="mt-3 rounded-card border border-line-night bg-night-1 p-5">
              <p className="text-label text-mute-night">{t('app.home.monthlyLimit')}</p>
              <p className="num mt-1 text-figure-sm">
                {money({ amount: d.profile.spending.affordable_monthly_gel, currency: 'GEL' })}
              </p>
            </div>
          </div>
        </>
      )}
    </PhoneScreen>
  );
}

// ---------- Missions (was Risk) ----------

export function RiskScreen() {
  const { t, L, num } = useI18n();
  const demo = useApi(getDemo);
  const d = demo.data;
  const rec = d?.missions.missions.find((m) => m.key === d.missions.recommended);

  return (
    <PhoneScreen tab="plan">
      {!d || !rec ? (
        <Loading />
      ) : (
        <>
          <ScreenHeader context={t('app.planflow.missionTitle')} />
          <div className="px-6 pt-2">
            <h2 className="text-[30px] font-light leading-tight tracking-[-0.03em]">{t('app.planflow.missionTitle')}</h2>

            <div className="mt-5 rounded-card border border-accent-400/40 bg-night-1 p-5">
              <div className="flex items-baseline justify-between">
                <p className="text-body">{L(rec)}</p>
                <p className="num text-figure-sm text-accent-300">{num(rec.probability * 100, 0)}%</p>
              </div>
              <p className="mt-1 text-micro text-mute-night">{L(rec, 'objective')}</p>
              <div className="mt-4">
                <RiskScale selected={rec.level} capacity={d.missions.capacity.level} />
              </div>
            </div>

            <div className="mt-3 space-y-2">
              {d.missions.missions
                .filter((m) => m.key !== rec.key)
                .map((m) => (
                  <div key={m.key} className="flex items-center justify-between rounded-2xl border border-line-night bg-night-1 px-4 py-3">
                    <span className="text-label">{L(m)}</span>
                    <span className="num text-label text-mute-night">{num(m.probability * 100, 0)}%</span>
                  </div>
                ))}
            </div>
          </div>
        </>
      )}
    </PhoneScreen>
  );
}

// ---------- Profile ----------

export function ProfileScreen() {
  const { t, L, money, num } = useI18n();
  const demo = useApi(getDemo);
  const d = demo.data;

  return (
    <PhoneScreen tab="profile">
      {!d ? (
        <Loading />
      ) : (
        <div className="px-6 pt-4">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-night-3 text-body">
              {d.persona.name_en.split(/\s+/).map((w) => w[0]).join('').slice(0, 2)}
            </span>
            <div className="min-w-0">
              <p className="text-body">{L(d.persona, 'name')}</p>
              <p className="truncate text-micro text-mute-night">{L(d.persona, 'occupation')}</p>
            </div>
          </div>
          <h2 className="mt-6 text-[30px] font-light leading-tight tracking-[-0.03em]">{t('profile.title')}</h2>

          <div className="mt-5 rounded-card border border-line-night bg-night-1 p-5">
            <p className="text-label text-mute-night">{t('app.profile.monthlyAvg')}</p>
            <p className="num mt-1 text-figure">{money({ amount: d.profile.ingestion.metrics.monthly_income, currency: 'GEL' })}</p>
            <p className="mt-1 text-micro text-mute-night">{t(`app.profile.incomeTypes.${d.profile.ingestion.income_type}`)}</p>
          </div>

          <div className="mt-3 rounded-card border border-line-night bg-night-1 p-5">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-label text-mute-night">{t('app.profile.capacityLevel')}</p>
              <p className="num text-label">{d.profile.profile.capacity.level}/10</p>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-night-3">
              <span className="block h-full rounded-full bg-accent-400" style={{ width: `${d.profile.profile.capacity.score * 100}%` }} />
            </div>
          </div>

          <div className="mt-3 rounded-card border border-line-night bg-night-1 p-5">
            <p className="text-label text-mute-night">{t('landing.preview.allocTitle')}</p>
            <div className="mt-3">
              <AllocationBar
                showLegend={false}
                slices={Object.entries(d.missions.missions.find((m) => m.key === d.missions.recommended)?.weights ?? {})
                  .filter(([, w]) => w > 0.005)
                  .sort((a, b) => b[1] - a[1])
                  .map(([k, w]) => ({
                    asset: k,
                    share: w,
                    label: L(d.missions.assets.find((a) => a.key === k) ?? { name_en: k, name_ka: k }, 'name'),
                  }))}
              />
            </div>
            <p className="mt-2 num text-micro text-mute-night">
              {t('landing.preview.allocNote', { n: num(d.missions.missions.find((m) => m.key === d.missions.recommended)?.probability ?? 0, 2) })}
            </p>
          </div>
        </div>
      )}
    </PhoneScreen>
  );
}
