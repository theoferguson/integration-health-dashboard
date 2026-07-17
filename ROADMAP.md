# Roadmap

Backlog for the Integration Health Dashboard (IHD) and its companion
`integrations-host-app`. Newest planning notes at the top of each section.

---

## 1. Address the code-review / simplification findings

Full report (2026-07-17, private artifact):
https://claude.ai/code/artifact/6ea6dab0-5b06-46ec-be12-3a305de34cd6

A two-repo review with extra scrutiny on the org-scoped multi-tenancy work.
One finding — the NYT API key leaking into IHD event payloads and logs — was
fixed and deployed (`integrations-host-app` commit `569c01c`). Everything
else is open, triage in roughly this order:

**Security / integrity (start here — two are in freshly-shipped org code):**
- IHD: viewers can mutate events (acknowledge / resolve / reopen / classify) —
  event routes use `requireOrgMember`, not `requireOrgAdmin`; `classify` also
  spends real OpenAI budget. `packages/api/src/routes/events.ts:20`
- IHD: `joinOrgByCode` can strand an org's sole admin and orphan its projects
  (invisible, undeletable, still ingesting). `services/orgStore.ts:103`
- Both apps: forgeable admin session if `SESSION_SECRET` is unset in prod —
  currently latent (secrets are set), but should throw on boot instead of
  falling back to a hardcoded default. `services/authToken.ts`

**Reliability (hangs / crashes):**
- No fetch timeout anywhere — SDK `report()` and host adapters can hang forever
  on a stalled upstream. Add `AbortSignal.timeout`, treat abort as retryable.
- Host app: `useAuth` has no error handling → one failed `/api/auth/me` bricks
  the whole UI on a permanent spinner. Add try/catch + signed-out fallback.
- Host app: no error boundary + unguarded `snapshot.data` destructure → a
  partial payload white-screens the app. Add a boundary; default arrays.
- Host app scheduler: no in-flight guard → overlapping runs of the same adapter.
- SDK: a 2xx with an empty body is reported as a failure (`.json()` throws).

**Correctness / UX:** civic-finance `NaN` total from one bad row; civic table vs
chart timezone off-by-one; stale dashboard data after an org switch; negative
`limit` dumps the whole event table; admin refresh throttle skips failing
integrations; 401/403 sign-in handling missing on non-Integrations tabs; a few
smaller items. See report.

**Simplifications (delete):** the `EventStore` class (one instance + 13
forwarding wrappers), dead `services/index.ts`, dead host `scripts/refresh.ts`
(source of the 2 failing `dist/` tests), duplicated `orgIdFor`, the unused
host-web `ApiError` taxonomy, dev deps shipped to the prod Docker image, and
the web bundle being built outside Docker. See report.

---

## 2. "Monitor" feature — user-defined event tracking

Let orgs define **monitors**: saved rules that watch for specific event types,
customizable by the event data — the IHD analogue of a Datadog/Sentry alert.

Rough shape:
- A new org-scoped `monitors` table: name, a match spec (integration,
  `event_type`, `status`, and predicates over `payload`/`error` fields — e.g.
  "`nyt-news` failures", or "weather events where `payload.tempF > 90`"), and
  state.
- A matching engine evaluated on ingest (and/or on a schedule) that records
  when a monitor fires, with a firing history.
- UI to create/list/edit/delete monitors and see recent firings; surface
  active/firing monitors on the dashboard.
- Depends on #3 — richer, more structured event data makes monitor predicates
  far more useful (numeric thresholds, tags, latency, etc.).

Open questions: notification channel (in-app only vs email/webhook), whether
monitors evaluate per-event or over a window (rate/threshold), and how firing
state clears.

---

## 3. Expand the data collected in events

Events today carry: `integration`, `event_type`, `status`, `timestamp`,
`payload`, `error`, `classification`, `resolution`, `idempotency_key`.
Expand the ingest schema (and SDK) with more structured, queryable fields so
the dashboard and monitors (#2) have more to work with. Candidates:
- Numeric **metrics** (latency/duration, item counts) for real trend charts.
- **Tags / labels** and an **environment** dimension (prod/staging) for
  filtering and grouping.
- **Severity** as a first-class field (not only derived from AI classification).
- A **source** identifier (host / adapter version).

Keep the SDK's wire format versioned (`schemaVersion`) and backward compatible;
new fields should be optional so existing reporters keep working.
