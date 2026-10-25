/**
 * The active backend session plus the profile/missions cache — the app's data
 * source. Every number on screen comes from the FastAPI backend; nothing is
 * computed here beyond routing and caching.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, loadStoredSession, setSessionGoneHandler, storeSession } from '../services/backend';
import type { Flight, GoalInput, MissionKey, MissionsView, Persona, PlanResult, Profile, Session } from '../types';

interface SessionCtx {
  session: Session | null;
  persona: Persona | null;
  profile: Profile | null;
  missions: MissionsView | null;
  missionsLoading: boolean;
  monthly: number | null;
  chosen: MissionKey | null;
  /** The mission every screen shows: chosen here, else confirmed on the backend, else recommended. */
  missionKey: MissionKey | null;
  plan: PlanResult | null;
  flight: Flight | null;
  /** Transient message shown on Welcome (e.g. "session expired"). */
  notice: string | null;
  setNotice: (n: string | null) => void;
  personas: Persona[] | null;
  /** Organiser workbook customers (cus-…) — selectable on Welcome, not in the switcher. */
  organisers: Persona[] | null;
  /** Custom personas created this visit (POST /api/custom-customers). */
  customs: Persona[];
  /** Look a persona up across demo, organiser and custom lists. */
  findPersona: (id: string) => Persona | undefined;
  /** Store the session after the consent POST; the progress screen finishes the load. */
  connect: (persona: Persona, session: Session) => void;
  /** Fetch profile + start missions load (ConnectProgress → Home). */
  finishConnect: () => Promise<void>;
  /** Switch customer: drop the session and open Connect for that persona. */
  switchTo: (personaId: string) => void;
  clearSession: () => void;
  addCustomPersona: (p: Persona) => void;
  setMonthly: (m: number) => void;
  choose: (m: MissionKey) => void;
  setPlan: Dispatch<SetStateAction<PlanResult | null>>;
  setFlight: (f: Flight | null) => void;
  refreshMissions: (opts?: { monthly?: number; focus?: MissionKey }) => Promise<void>;
  updateGoal: (goal: GoalInput) => Promise<void>;
}

const Ctx = createContext<SessionCtx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const stored = useRef(loadStoredSession()).current;
  const [session, setSession] = useState<Session | null>(stored?.session ?? null);
  const [persona, setPersona] = useState<Persona | null>(stored?.persona ?? null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [missions, setMissions] = useState<MissionsView | null>(null);
  const [missionsLoading, setMissionsLoading] = useState(false);
  const [monthly, setMonthlyState] = useState<number | null>(null);
  const [chosen, setChosen] = useState<MissionKey | null>(null);
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [flight, setFlight] = useState<Flight | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [personas, setPersonas] = useState<Persona[] | null>(null);
  const [organisers, setOrganisers] = useState<Persona[] | null>(null);
  const [customs, setCustoms] = useState<Persona[]>([]);
  const req = useRef(0);
  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;

  const clearSession = useCallback(() => {
    req.current++;
    sessionRef.current = null;
    storeSession(null);
    setSession(null); setPersona(null); setProfile(null); setMissions(null);
    setMonthlyState(null); setChosen(null); setPlan(null); setFlight(null);
  }, []);

  useEffect(() => {
    let active = true;
    setSessionGoneHandler(() => {
      clearSession();
      setNotice('gone');
      navigate('/app/welcome');
    });
    if (stored) {
      Promise.all([api.profile(stored.session), api.trades(stored.session)]).then(async ([p, savedPlan]) => {
        if (!active || sessionRef.current?.consent_id !== stored.session.consent_id) return;
        const savedMonthly = savedPlan.monthly ?? p.default_monthly;
        setProfile(p);
        setMonthlyState(savedMonthly);
        setChosen(savedPlan.mission);
        const view = await api.missions(stored.session, savedMonthly, savedPlan.mission ?? undefined);
        if (active && sessionRef.current?.consent_id === stored.session.consent_id) setMissions(view);
      }).catch(() => undefined);
    }
    api.personas().then((r) => {
      if (!active) return;
      setPersonas(r.personas);
      setOrganisers(r.organiser_customers ?? []);
    }).catch(() => { if (active) { setPersonas([]); setOrganisers([]); } });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadMissions = useCallback(async (s: Session, m: number | undefined, focus: MissionKey | undefined) => {
    const id = ++req.current;
    setMissionsLoading(true);
    try {
      const view = await api.missions(s, m, focus);
      if (id === req.current && sessionRef.current?.consent_id === s.consent_id) setMissions(view);
    } finally {
      if (id === req.current) setMissionsLoading(false);
    }
  }, []);

  const connect = useCallback((p: Persona, s: Session) => {
    req.current++;
    sessionRef.current = s;
    setPersona(p); setSession(s);
    setProfile(null); setMissions(null); setChosen(null); setPlan(null); setMonthlyState(null); setFlight(null);
    storeSession(s, p);
  }, []);

  const finishConnect = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;
    const p = await api.profile(s);
    if (sessionRef.current?.consent_id !== s.consent_id) return;
    setProfile(p);
    setMonthlyState(p.default_monthly);
    void loadMissions(s, p.default_monthly, undefined);
  }, [loadMissions]);

  const switchTo = useCallback((personaId: string) => {
    clearSession();
    navigate(`/app/connect?persona=${personaId}`);
  }, [clearSession, navigate]);

  const findPersona = useCallback(
    (id: string) => personas?.find((p) => p.id === id) ?? organisers?.find((p) => p.id === id) ?? customs.find((p) => p.id === id),
    [personas, organisers, customs],
  );
  const addCustomPersona = useCallback((p: Persona) => setCustoms((v) => [...v, p]), []);

  const missionKey = chosen ?? missions?.selected ?? missions?.recommended ?? null;
  const value = useMemo<SessionCtx>(() => ({
    session, persona, profile, missions, missionsLoading, monthly, chosen, missionKey, plan, flight, notice, personas, organisers, customs, findPersona,
    setNotice, connect, finishConnect, switchTo, clearSession, addCustomPersona, setPlan, setFlight,
    setMonthly: (m) => { setMonthlyState(m); setPlan(null); if (session) void loadMissions(session, m, chosen ?? undefined); },
    choose: (m) => { setChosen(m); setPlan(null); if (session) void loadMissions(session, monthly ?? undefined, m); },
    refreshMissions: async (opts) => { if (session) await loadMissions(session, opts?.monthly ?? monthly ?? undefined, opts?.focus ?? chosen ?? undefined); },
    updateGoal: async (goal) => {
      if (!session) return;
      const p = await api.goal(session, goal);
      if (sessionRef.current?.consent_id !== session.consent_id) return;
      setProfile(p); setChosen(null); setPlan(null);
      setFlight(null);
      setMonthlyState(p.default_monthly);
      await loadMissions(session, p.default_monthly, undefined);
    },
  }), [session, persona, profile, missions, missionsLoading, monthly, chosen, missionKey, plan, flight, notice, personas, organisers, customs, findPersona,
    connect, finishConnect, switchTo, clearSession, addCustomPersona, loadMissions]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useSession outside SessionProvider');
  return c;
}
