// Captures the backend output the landing previews show (synthetic persona "nino") into
// public/landing-demo.json. The landing page falls back to it when the API is asleep or unreachable,
// e.g. on a static host before the backend wakes. Re-run after a model or data change.
// Usage: node scripts/landing-snapshot.mjs [apiBase]   (default http://127.0.0.1:8000)
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const base = process.argv[2] ?? 'http://127.0.0.1:8000';
const OUT = fileURLToPath(new URL('../public/landing-demo.json', import.meta.url));

async function call(path, init = {}, token) {
  const headers = { 'Content-Type': 'application/json', ...(token ? { 'X-Consent-Token': token } : {}) };
  const res = await fetch(base + path, { ...init, headers });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

const { personas, banks } = await call('/api/personas');
const persona = personas.find((p) => p.id === 'nino') ?? personas[0];
const s = await call('/api/consents', {
  method: 'POST',
  body: JSON.stringify({
    persona_id: persona.id,
    banks: persona.banks.map((b) => b.code),
    scopes: ['balances', 'transactions', 'deposits', 'loans'],
    duration_days: 1,
    cash_at_home: persona.cash_at_home,
    simulate_timeout: null,
  }),
});
const sid = `/api/sessions/${s.consent_id}`;
const profile = await call(`${sid}/profile`, {}, s.token);
const monthly = profile.default_monthly;
const missions = await call(`${sid}/missions?monthly=${monthly}`, {}, s.token);
const funds = await call(`${sid}/funds?monthly=${monthly}&mission=${missions.recommended}`, {}, s.token);
const stockCheck = await call(
  `${sid}/stock-check`,
  { method: 'POST', body: JSON.stringify({ profile: 'big_tech', share: 0.2, mission: missions.recommended, monthly }) },
  s.token,
);
await call(`/api/consents/${s.consent_id}`, { method: 'DELETE' }, s.token).catch(() => {});

const snapshot = { captured_at: new Date().toISOString(), data_kind: 'synthetic_demo', persona, banks, profile, missions, funds, stockCheck };
writeFileSync(OUT, JSON.stringify(snapshot));
console.log(`wrote ${OUT} (${Math.round(JSON.stringify(snapshot).length / 1024)} KB)`);
