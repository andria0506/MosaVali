/**
 * Landing-page previews show the backend's real output, not invented numbers.
 * One shared demo session for the synthetic persona "nino" is created on first
 * use — never written to sessionStorage, never shown as the active customer.
 * When the API doesn't answer in time (asleep or unreachable on a static host), the previews use
 * public/landing-demo.json: the same backend output, captured by scripts/landing-snapshot.mjs.
 */
import { api } from './backend';
import type { FundsView, MissionsView, Persona, Profile, Session, StockCheck } from '../types';

export interface DemoData {
  /** Null when the data comes from the captured snapshot (no live session to call). */
  session: Session | null;
  persona: Persona;
  profile: Profile;
  missions: MissionsView;
  funds: FundsView;
  /** Only in the snapshot; live previews ask the API. */
  stockCheck?: StockCheck;
  banks?: Record<string, { name: string; name_ka: string }>;
}

const LIVE_TIMEOUT_MS = 6000;

let pending: Promise<DemoData> | undefined;
let snapshotPending: Promise<DemoData> | undefined;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}

function snapshot(): Promise<DemoData> {
  snapshotPending ??= fetch('/landing-demo.json')
    .then((r) => {
      if (!r.ok) throw new Error(`snapshot ${r.status}`);
      return r.json() as Promise<Omit<DemoData, 'session'>>;
    })
    .then((d) => ({ ...d, session: null }));
  snapshotPending.catch(() => {
    snapshotPending = undefined;
  });
  return snapshotPending;
}

async function live(): Promise<DemoData> {
  const { personas } = await api.personas();
  const persona = personas.find((p) => p.id === 'nino') ?? personas[0];
  const s = await api.consent({
    persona_id: persona.id,
    banks: persona.banks.map((b) => b.code),
    scopes: ['balances', 'transactions', 'deposits', 'loans'],
    duration_days: 1,
    cash_at_home: persona.cash_at_home,
    simulate_timeout: null,
  });
  const session: Session = { consent_id: s.consent_id, token: s.token, persona_id: persona.id };
  const profile = await api.profile(session);
  const missions = await api.missions(session, profile.default_monthly);
  const funds = await api.funds(session, profile.default_monthly, missions.recommended);
  return { session, persona, profile, missions, funds };
}

export function getDemo(): Promise<DemoData> {
  if (!pending) {
    pending = withTimeout(live(), LIVE_TIMEOUT_MS).catch(() => snapshot());
    pending.catch(() => {
      pending = undefined;
    });
  }
  return pending;
}

/** The synthetic bank universe for the landing page: live from /api/personas, else from the snapshot. */
export function getDemoBanks(): Promise<Record<string, { name: string; name_ka: string }>> {
  return withTimeout(api.personas(), LIVE_TIMEOUT_MS)
    .then((r) => r.banks ?? {})
    .catch(() => snapshot().then((d) => d.banks ?? {}));
}
