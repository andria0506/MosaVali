/**
 * Local read-state for backend alerts. The backend has no read flag, so read
 * alerts are remembered per consent in localStorage, keyed by consent_id and a
 * stable alert key (kind + text).
 */
import { useSyncExternalStore } from 'react';
import type { Alert } from '../types';

const key = (consentId: string) => `danazogi.read.${consentId}`;
export const alertKey = (a: Alert) => `${a.kind}:${a.en}`;

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
export const subscribeRead = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function readSet(consentId: string | null | undefined): Set<string> {
  if (!consentId) return new Set();
  try {
    return new Set(JSON.parse(localStorage.getItem(key(consentId)) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

export function markAllRead(consentId: string, alerts: Alert[]) {
  const s = readSet(consentId);
  alerts.forEach((a) => s.add(alertKey(a)));
  try {
    localStorage.setItem(key(consentId), JSON.stringify([...s]));
  } catch {
    // storage unavailable: alerts simply stay unread for this visit
  }
  notify();
}

/** Unread alert count for the chrome badge; re-renders when read state changes. */
export function useUnreadAlerts(consentId: string | null | undefined, alerts: Alert[] | undefined): number {
  return useSyncExternalStore(
    subscribeRead,
    () => (alerts ?? []).filter((a) => !readSet(consentId).has(alertKey(a))).length,
  );
}
