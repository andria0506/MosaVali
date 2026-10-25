# Backend integration guide

How to point another frontend at the MosaVali API during the hackathon. This is a
local prototype: all people, banks, merchants and transactions are **synthetic**,
there are no real transfers, and nothing here is production banking, auth or storage.

## Run it

```bash
cd backend && .venv/Scripts/python.exe -m uvicorn danazogi.api:app --port 8000
# then http://127.0.0.1:8000 serves the built frontend AND the API
```

- **Same origin**: the FastAPI app serves the webapp build and `/api` on port 8000.
  For a separate dev server, proxy `/api` (and `/api/yahoo`) to `http://127.0.0.1:8000`
  — `webapp/vite.config.ts` does exactly that (`API_TARGET`, default :8001). Do not
  add CORS hacks; the app has no CORS middleware on purpose.
- **Interactive docs**: `GET /docs` (Swagger UI) and `GET /openapi.json` list every
  route and schema.
- **Health**: `GET /api/health` → `{"status": "ok", "models": {...}}`.

## What the server serves

| Path | What |
|---|---|
| `/api/*` | The JSON API (below). Unknown `/api/*` paths return JSON 404, never HTML. |
| `/api/yahoo/{path}` | Read-only Yahoo Finance relay: only `v1/finance/search` and `v8/finance/chart/<symbol>` are forwarded (everything else → 404). Query strings pass through, 10 s timeout, upstream status/content-type mirrored with `Cache-Control: public, max-age=300`, upstream failure → 502 JSON. Used only by the stock-exploration pages. |
| everything else | SPA fallback to `webapp/dist` (resolved inside dist, never above it); only registered when `webapp/dist` exists. |

The webapp (`webapp/`) is the reference client: `webapp/src/services/backend.ts` is
the typed client for every endpoint below, and `webapp/src/state/SessionContext.tsx`
holds `{consent_id, token, persona_id}` in `sessionStorage`.

**Demo deep link** (webapp): `/app/demo/<persona>[?timeout=<bank>][&next=<path>]` —
the page POSTs `/api/consents` with all the persona's banks and scopes
(`simulate_timeout` when `timeout` is given), stores the session, prefetches the
profile and navigates to `next` (default `/app`). Pure frontend sugar over the API
below — useful for tests, QA and rehearsals.

## Session and token

1. `GET /api/personas` → persona cards, organiser customers (`cus-001`…`cus-100`),
   valid `banks` and `scopes`.
2. `POST /api/consents` → 201:
   ```json
   {"persona_id": "nino", "banks": ["MT", "RI"],
    "scopes": ["balances", "transactions", "loans", "deposits"],
    "duration_days": 90, "cash_at_home": null, "simulate_timeout": null}
   ```
   Response contains `consent_id` and `token`. **Send the token as the
   `X-Consent-Token` header on every session call; never log it.**
   - Bank list is canonicalised (duplicates dropped) and must only contain banks
     where the persona has accounts — unknown/unowned banks get 422, an empty or
     missing-bank list gets 422. A proper non-empty subset is allowed and flags
     the profile as `partial_data` (see below).
   - Unknown scopes get 422; `balances` and `transactions` are mandatory.
     Skipping `loans`/`deposits` or a bank the customer uses is a valid consent,
     but the profile is `partial_data` with a zero saving limit.
   - `simulate_timeout: "RI"` simulates a bank outage for demo purposes.
3. `GET /api/consents/{id}` and `DELETE /api/consents/{id}` (revoke) use the same
   token header. Sessions are **in memory, single process** — restart or expiry
   (`duration_days`) invalidates them; afterwards every session call returns 404.
   An unknown, wrong or missing token also returns 404.

## Endpoints (session calls all need `X-Consent-Token`)

| Method & path | Purpose |
|---|---|
| `GET /api/health` | status + model versions |
| `GET /api/personas` | personas, organiser customers, banks, scopes, cached `tbc_sandbox` status (nullable until first probe) |
| `GET /api/tbc-status?force=false` | live sandbox reachability probe (status only) |
| `GET /api/market` | market snapshot, asset assumptions, macro |
| `GET /api/models` | frozen model cards (versions, metrics) |
| `POST /api/custom-customers` | create a synthetic customer from typed values (201) |
| `POST /api/consents` | create session (201) |
| `GET /api/consents/{id}` | session public state |
| `DELETE /api/consents/{id}` | revoke + purge |
| `GET /api/sessions/{id}/profile` | ingestion + liquidity/spending regressions + peers + inflation; includes `partial_data`; per-bank status lives at `consent.bank_status`; no `tbc_sandbox` field here |
| `PUT /api/sessions/{id}/goal` | update goal `{kind, amount, currency, years}` — resets mission selection, simulator runs and behaviour score |
| `GET /api/sessions/{id}/missions?monthly=&focus=` | mission cards `protect|goal|balance|growth` |
| `GET /api/sessions/{id}/funds?monthly=&mission=` | fund-type comparison for the plan |
| `POST /api/sessions/{id}/stock-check` | one-stock what-if `{profile, share, mission?, monthly?}` |
| `POST /api/sessions/{id}/plan` | select mission `{mission, monthly?, acknowledge?[]}` → proposed trades with compliance `checks` |
| `GET /api/sessions/{id}/explain?mission=&monthly=` | Shapley explanation (16 coalitions), bilingual narrative |
| `GET /api/sessions/{id}/trades` | `{mission, monthly, trades}` — `monthly` is the stored selected amount |
| `POST /api/sessions/{id}/trades/{trade_id}` | `{decision: "approve"\|"reject"\|"edit", amount_gel?}` |
| `GET /api/sessions/{id}/instruction` | final instruction for approved steps only |
| `POST /api/sessions/{id}/sandbox` | start simulator `{mission, chapters?}` (`chapters` null/[] = all, max 4) |
| `POST /api/sessions/{id}/sandbox/{flight}/step` | `{action, until_decision?}` step/replay |
| `GET /api/sessions/{id}/audit` | hash-chained audit log + `verification.valid` |

`monthly` on `missions`/`funds`/`explain` is a query param `0 ≤ monthly ≤ 100,000`
(finite). `monthly`/`amount_gel`/`amount` in bodies reject non-finite values.

### New/changed response fields

- `profile.liquidity` adds:
  - `reserve_basis` — what set the required reserve:
    `cash_need_model` (the cautious model estimate is above the rule),
    `minimum_rule` (3-month minimum binds because the estimate is lower),
    `fallback_minimum` (incomplete or irregular history → ≥ 6-month floor),
    `all_assets` (essential spending could not be measured → everything protected).
  - `minimum_months` — the reserve floor in months that was applied.
  - `minimum_gel` — that floor in GEL (`minimum_months × essential spend`).
  - `bound_collapsed` — true when the cautious estimate equals the expected one
    (within 0.5 GEL): outcomes are zero-inflated, so the 90th percentile can sit
    at or below the mean; the minimum rule then covers the customer. Label it.
- `missions` adds:
  - `recommendation_reason` — machine-readable reason for `recommended`, one of
    `preserve_goal` (goal kind is "preserve savings" → Protect),
    `only_safe_allowed` (every other mission needs an acknowledgment or is blocked),
    `none_reach` (every card below 5% on-time),
    `all_reach_lowest_risk` (every allowed mission ≥ 95% → lowest risk wins),
    `best_chance` (highest probability among missions without warnings; ties → lower risk).
  - `recommendation_text` — the same reason as a bilingual `{ka, en}` sentence;
    for `none_reach` it lists the levers that would help. Show it near the goal.
- `profile.goal_source` can be `custom_input` — a goal typed into the custom-
  customer form rather than a persona/organiser/customer-edit value.

### Custom customers (`POST /api/custom-customers`)

Creates a synthetic customer generated from typed values (the "Try your own
numbers" form). In memory only — cleared on restart, capped at **1,000** per
process (`409` at the cap), and **not** listed in `GET /api/personas`. After
creation the normal consent flow applies: `POST /api/consents` with the
returned `persona_id`.

Body (201 on success → `{"persona_id", "persona", "synthetic"}` — `persona` is a
card like `/api/personas`, `synthetic` is a label sentence):

- `label` string 1–40 chars (blank → "Custom customer"); `age` int 18–90;
  `region` `tbilisi|adjara|imereti|other`; `household` int 1–8;
  `bank` must be a key of `personas.banks` (422 otherwise).
- `income_kind` `salary|pension|business`; `monthly_income` 0–100,000;
  `pay_day` int 1–28.
- Monthly spending, each 0–50,000 GEL: `rent`, `utilities`, `groceries`,
  `transport`, `delivery`, `dining`, `taxi`.
- `usd_loan_instalment` 0–20,000 and `usd_loan_balance` 0–1,000,000 — an
  instalment without a balance (or vice versa) is a 422.
- Savings: `gel_current`, `gel_savings`, `gel_term_deposit` each 0–10,000,000 GEL;
  `usd_savings` 0–10,000,000 USD; `cash_at_home` 0–1,000,000.
- `goal` — same shape as `PUT /goal` (`{kind, amount, currency, years}`).
- All floats reject `NaN`/`Infinity` (422), same as everywhere else.

## Expected status codes

- **200/201** — success. Plan/trade/instruction bodies carry `checks` per item and
  missions carry a nested `compliance` block; a 200 can still contain flagged
  `status: "blocked"` trades for the customer to fix.
- **404** — unknown persona; unknown, expired or revoked consent; a wrong or
  missing token; unknown trade ID; unknown simulator flight (old flight IDs die
  after a goal edit, old trade IDs die after re-selecting a mission).
- **409** — compliance, always `{"error", ...}`:
  - `POST /plan` missing acknowledgments → `{"error", "mission": "<key>", "missing": ["RULE-01"], "compliance": {...}}`
  - `POST /plan` blocked mission → `{"error", "mission", "compliance"}` with `compliance.blocking_rules`
  - trade/instruction failures → `{"error", "checks": [...]}` (plus the offending `trade` on approve)
  - Rule names in use: `VULN-01`, `CAP-01`, `BEH-01`, `BUF-01`, `CONC-01`,
    `PROD-01`, `AFF-01`, `DATA-01`, `SPEND-01`, `SOURCE-01`.
- **422** — request validation: bad types/ranges, `NaN`/`Infinity` anywhere,
  unknown banks/scopes, invalid goal (e.g. `years: 0`), invalid amounts.
  Never a 500 for non-finite input.

## Plan/trade/instruction flow the frontend must follow

1. `GET /missions` → each card carries a `compliance` block
   (`blocked`, `blocking_rules`, `needs_acknowledgment`, `checks`). Show it and
   collect an explicit customer confirmation for any warned rules — never
   auto-acknowledge.
2. `POST /plan` with `{mission, monthly?, acknowledge: []}`. Missing
   acknowledgments → 409 with `missing`; re-POST with `acknowledge: ["RULE-01"]`
   only after the customer confirmed. Success →
   `{mission (with nested `compliance`), trades, levers, strategies, acknowledged, monthly}`.
3. `POST /trades/{id}` per step: `approve`, `reject`, or `edit` + `amount_gel`
   (≤ 10,000,000). Editing regenerates `action_en`/`action_ka` text, floors the
   amount to cents, clears any previous approval, and re-runs portfolio checks —
   a blocked edit stays visible until edited back safe.
4. Approvals are validated **cumulatively**: combined transfers cannot exceed a
   source account balance (`SOURCE-01`); accessible cash is checked **per date in
   chronological order**, so money freed by a later term-deposit maturity cannot
   fund an earlier transfer below the protected buffer (`BUF-01`); asset shares
   can't exceed caps (`CONC-01`). A second approval that would overdraw fails
   with 409 — rejected steps can't fund others.
5. `GET /instruction` returns only **approved** steps. It re-validates the
   approved subset, so an instruction can't silently survive a rejection.
   Fields: `steps`, `total_gel` (one-off sum), `monthly_total_gel` (recurring sum),
   `projection_basis: "confirmed_full_plan"`, plus a disclaimer that the displayed
   goal estimate assumes the *full* proposed plan — approving a subset or editing
   amounts changes the outcome.
6. Trade IDs are **server-generated and opaque** — use each returned `id`
   verbatim and do not construct or prefix your own. Re-selecting a mission
   replaces the whole trade list with fresh IDs; drop the old list. `PUT /goal`
   clears selection, flights and the simulator score.

## Monetary and model truth

- Every forecast number comes from the backend: `profile.liquidity` /
  `profile.spending` (expected vs cautious GEL amounts), `mission.probability`,
  `levers`, instruction totals. Never invent or recompute these client-side.
- `affordable_monthly_gel` is the enforced cap for recurring plans (`AFF-01`);
  it is `0.0` when `partial_data` or a reserve shortfall applies.
- The "cautious" bound is a 90% population-level calibration, not a per-person
  guarantee — keep UI wording honest.

## TBC sandbox probe

`GET /api/tbc-status` (and `personas.tbc_sandbox`, the same cached result) is a
**reachability/status probe only** — it is never stored on the profile.
`live_available: true` means the mock endpoint responded (HTTP 401/403 =
reachable and enforcing auth, **not** authenticated). `data_source` is always
`organiser_xlsx_100_customers`, `integration_mode` is `status_probe_only` and
`authenticated` is always `false`. No account data is ever read over the
network: persona data comes from the local synthetic generator, organiser
customers from the local workbook.

## Limitations (say them out loud in the demo)

- Synthetic data throughout; the open-banking "fetch" reads local personas/workbook.
- In-memory, single-process sessions; no persistence, no multi-worker safety.
- Consent token is a demo credential, not OAuth; a leaked token grants the session.
- The API validates and explains; it never moves money.
