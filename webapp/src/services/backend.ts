/**
 * Typed client for the MosaVali FastAPI backend — the single source of truth.
 * Session ({consent_id, token, persona_id}) lives in sessionStorage. A 404 on a
 * session endpoint means the consent expired, was revoked or the server
 * restarted: the session is cleared and the app returns to /app/welcome.
 */
import type {
  AuditView, ChapterCode, CustomCustomerIn, Explanation, Flight, FundsView, GoalInput, Instruction,
  MissionKey, MissionsView, ModelCards, Persona, PlanResult, Profile, Receipt, Session, StockCheck,
  StockProfile, TbcSandboxStatus, Trade,
} from '../types';

export class ApiError extends Error {
  constructor(public status: number, public body: Record<string, unknown>) {
    super(String(body.error ?? body.detail ?? `Request failed (${status})`));
  }
}

/** Human-readable message: 409 compliance text first, then 422 field errors. */
export function errorMessage(e: unknown, pick: (o: { ka: string; en: string }) => string): string {
  if (e instanceof ApiError) {
    const body = e.body as {
      checks?: { status: string; title_en: string; title_ka: string; en: string; ka: string }[];
      compliance?: { checks?: { status: string; title_en: string; title_ka: string; en: string; ka: string }[] };
      detail?: unknown;
    };
    const checks = body.compliance?.checks ?? body.checks ?? [];
    const flagged = checks.find((c) => c.status === 'block' || c.status === 'warn');
    if (flagged) return pick({ en: flagged.en || flagged.title_en, ka: flagged.ka || flagged.title_ka });
    const detail = body.detail;
    if (Array.isArray(detail)) {
      const first = detail[0] as { msg?: string } | undefined;
      if (first?.msg) return first.msg;
    }
    if (typeof detail === 'string') return detail;
  }
  // fetch() itself failed: the API server isn't running or can't be reached (no HTTP status at all).
  if (e instanceof TypeError) {
    return pick({
      en: "Can't reach the MosaVali server. Check that the backend is running, then try again.",
      ka: 'MosaVali-ს სერვერთან კავშირი ვერ დამყარდა. შეამოწმეთ, რომ სერვერი ჩართულია, და სცადეთ თავიდან.',
    });
  }
  return e instanceof Error ? e.message : String(e);
}

const STORAGE_KEY = 'danazogi.session.v1';
let onSessionGone: (() => void) | null = null;

/** SessionContext registers this: clear state and navigate to /app/welcome. */
export function setSessionGoneHandler(fn: () => void) {
  onSessionGone = fn;
}

export function loadStoredSession(): { session: Session; persona: Persona | null } | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { s: Session; p: Persona | null };
    return parsed?.s?.consent_id && parsed?.s?.token ? { session: parsed.s, persona: parsed.p ?? null } : null;
  } catch {
    return null;
  }
}

export function storeSession(session: Session | null, persona: Persona | null = null) {
  try {
    if (session) sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ s: session, p: persona }));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage unavailable: session simply will not survive a reload
  }
}

async function call<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['X-Consent-Token'] = token;
  const res = await fetch(path, { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 404 && token) {
      // Only a 404 for *this* stored session means expired/revoked/restarted.
      const id = path.match(/\/(?:sessions|consents)\/([^/]+)/)?.[1];
      if (id && id === loadStoredSession()?.session.consent_id) onSessionGone?.();
    }
    throw new ApiError(res.status, body);
  }
  return body as T;
}

const q = (params: Record<string, string | number | undefined | null>) => {
  const s = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => v !== undefined && v !== null && s.set(k, String(v)));
  const str = s.toString();
  return str ? `?${str}` : '';
};

export interface MarketSnapshot {
  snapshot: { fx_spot: number; [k: string]: unknown };
  assets: { key: string; code: string; name_ka: string; name_en: string; currency: string; rate: number; source: string }[];
  macro: Record<string, number>;
  episodes: Record<string, unknown>;
  cpi_source: string;
  replay_source: string;
}

export const api = {
  personas: () =>
    call<{ personas: Persona[]; organiser_customers?: Persona[]; tbc_sandbox?: TbcSandboxStatus; banks?: Record<string, { name: string; name_ka: string }>; scopes?: string[]; synthetic?: string }>('/api/personas'),
  tbcStatus: (force = false) => call<TbcSandboxStatus>(`/api/tbc-status${q({ force: force ? 1 : undefined })}`),
  market: () => call<MarketSnapshot>('/api/market'),
  models: () => call<ModelCards>('/api/models'),
  customCustomer: (body: CustomCustomerIn) =>
    call<{ persona_id: string; persona: Persona; synthetic: string }>('/api/custom-customers', { method: 'POST', body: JSON.stringify(body) }),
  consent: (body: { persona_id: string; banks: string[]; scopes: string[]; duration_days: number; cash_at_home: number | null; simulate_timeout: string | null }) =>
    call<Session & { scopes: string[]; expires: string }>('/api/consents', { method: 'POST', body: JSON.stringify(body) }),
  consentInfo: (s: Session) => call<Record<string, unknown>>(`/api/consents/${s.consent_id}`, {}, s.token),
  revoke: (s: Session) => call<Receipt>(`/api/consents/${s.consent_id}`, { method: 'DELETE' }, s.token),
  profile: (s: Session) => call<Profile>(`/api/sessions/${s.consent_id}/profile`, {}, s.token),
  missions: (s: Session, monthly?: number, focus?: MissionKey) =>
    call<MissionsView>(`/api/sessions/${s.consent_id}/missions${q({ monthly, focus })}`, {}, s.token),
  plan: (s: Session, mission: MissionKey, acknowledge: string[], monthly?: number) =>
    call<PlanResult>(`/api/sessions/${s.consent_id}/plan`, { method: 'POST', body: JSON.stringify({ mission, acknowledge, monthly }) }, s.token),
  explain: (s: Session, mission: MissionKey, monthly?: number) =>
    call<Explanation>(`/api/sessions/${s.consent_id}/explain${q({ mission, monthly })}`, {}, s.token),
  trades: (s: Session) => call<{ mission: MissionKey | null; monthly: number | null; trades: Trade[] }>(`/api/sessions/${s.consent_id}/trades`, {}, s.token),
  trade: (s: Session, id: string, decision: 'approve' | 'reject' | 'edit', amount_gel?: number) =>
    call<Trade>(`/api/sessions/${s.consent_id}/trades/${id}`, { method: 'POST', body: JSON.stringify({ decision, amount_gel }) }, s.token),
  instruction: (s: Session) => call<Instruction>(`/api/sessions/${s.consent_id}/instruction`, {}, s.token),
  goal: (s: Session, goal: GoalInput) =>
    call<Profile>(`/api/sessions/${s.consent_id}/goal`, { method: 'PUT', body: JSON.stringify(goal) }, s.token),
  funds: (s: Session, monthly?: number, mission?: MissionKey) =>
    call<FundsView>(`/api/sessions/${s.consent_id}/funds${q({ monthly, mission })}`, {}, s.token),
  stockCheck: (s: Session, profile: StockProfile, share: number, mission?: MissionKey, monthly?: number) =>
    call<StockCheck>(`/api/sessions/${s.consent_id}/stock-check`, { method: 'POST', body: JSON.stringify({ profile, share, mission, monthly }) }, s.token),
  flightStart: (s: Session, mission: MissionKey, chapters?: ChapterCode[]) =>
    call<Flight>(`/api/sessions/${s.consent_id}/sandbox`, { method: 'POST', body: JSON.stringify({ mission, chapters }) }, s.token),
  flightStep: (s: Session, id: string, action: string, untilDecision = false) =>
    call<Flight>(`/api/sessions/${s.consent_id}/sandbox/${id}/step`, { method: 'POST', body: JSON.stringify({ action, until_decision: untilDecision }) }, s.token),
  audit: (s: Session) => call<AuditView>(`/api/sessions/${s.consent_id}/audit`, {}, s.token),
};
