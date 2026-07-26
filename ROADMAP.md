# Roadmap

Backlog for the Integration Health Dashboard (IHD) and its companion
`integrations-host-app`. Newest planning notes at the top of each section.

---

## North Star — cut the middle out of integration observability

The long-term direction: IHD serves two audiences **directly**, collapsing the
technical intermediary that normally sits between raw integration telemetry and
the people (or agents) who act on it. Two front doors onto the same event store:

1. **A monitoring UI for non-technical users** — CSMs, support, partnerships, and
   account teams who need to answer *"is this customer's / partner's integration
   healthy?"* without reading logs or writing queries. Health at a glance,
   plain-language status, and saved Monitors — no observability background
   required.

2. **A robust API as an agentic / MCP touchpoint** — a first-class programmatic
   surface (and an MCP server over it) so skills, agents, and MCP clients can
   query and evaluate integration status efficiently, and automate the
   monitor/triage loop a human would otherwise run by hand.

Both doors read the same events, monitors, and classifications. The bet is that
the value isn't the dashboard or the API in isolation — it's removing the
"an engineer in the middle interprets telemetry for everyone else" step for a
human **and** an agent audience at once.

Everything in the backlog below is a step toward one or both doors:
- **Door 1 (human UI):** #2 Monitors, richer per-integration signals (#5),
  in-app alerting.
- **Door 2 (agent API):** #11 read/query API + MCP server, plus the contract
  work that makes the data agent-legible — #7 `status` widening, #8 OTel interop,
  #6 batching.

---

## 11. Agentic read/query API + MCP server (Door 2)

The programmatic front door. Today the API is ingest-first (write events) plus
the web app's own read endpoints; Door 2 needs a **stable, documented read/query
surface** built for agents, and an **MCP server** over it.

Rough shape (decision-first, nothing built yet):
- A versioned read API: list/query events, integration health rollups, and
  monitor state, with filters mirroring the web app (integration / status /
  time window / `metrics.*` / `tags.*` / severity) — the same predicates
  Monitors already speak, exposed programmatically.
- Auth for non-interactive callers: scoped API tokens (read-only), distinct from
  the ingest key and the browser session.
- An **MCP server** wrapping that API so an agent can ask "which of this org's
  integrations are degraded, and why?" and get structured, classification-aware
  answers — not raw rows to re-derive.
- Output shaped for agent consumption: summaries + the AI classification/root
  cause already computed server-side, so the agent evaluates rather than parses.

Depends on / benefits from: #7 (`status` widening — agent/analytics events),
#8 (OTel mapping — agent-legible field names). Does **not** block Door 1.

---

## 6. General-purpose hardening — make IHD a credible public tool

From a 2026-07-20 review of the public contract against observability
best-practice (Sentry DSN/envelope, Datadog events + unified `env`/`service`/
`version` tagging, OTel semantic conventions, SDK batching/sampling/PII norms).
The core contract is already domain-agnostic (no IHA coupling in the wire/SDK/
storage/auth) — this list is what would make it *best-practice* general, not just
uncoupled.

**Done (2026-07-20):**
- [x] Publish the SDK properly — `publishConfig.access=public`, `prepublishOnly`
  build. **`@theof/ihd-sdk@0.4.0` is published** (DSN config + `beforeSend`); npm
  and the READMEs are in sync.
- [x] Reconcile the README with the shipped product (it described a construction
  demo, a nonexistent `simulator`, an in-memory store, and an SDK API —
  `monitor.capture`/React/2s-batching — that was never built). `blueprint.md`
  marked historical.
- [x] DSN-style single-string config: `new IHDClient({ dsn: 'https://<key>@host' })`.
- [x] **PII / redaction** (#4, 2026-07-20) — SDK `beforeSend(event)` hook (redact or
  return null to drop; a throwing hook drops rather than sends unredacted) +
  32 KB server-side `payload` cap at ingest. Data-handling documented in both
  READMEs. SDK **0.4.0**.

**Done (2026-07-21, deployed 2026-07-22):**
- [x] **Ingest rate limiting** (#5) — `express-rate-limit` on `/api/ingest`, keyed
  by project API key (per-IP fallback for missing/invalid keys), default 120/min
  via `INGEST_RATE_LIMIT_PER_MIN`, emits IETF `RateLimit-*` headers, returns 429.
  `middleware/rateLimit.ts`. Per-project metering self-checked in
  `routes/__tests__/ingestRateLimit.test.ts`. Merged via PR #1 (`3b3860e`) and
  **live in prod** (Fly release v21) — verified `ratelimit-policy: 120;w=60`.

**Deferred (noted, not yet built):**
- [ ] **`status` widening** (#7) — accept a non-operational `'info'` value (or make
  `status` optional) so product/analytics events fit, without diluting the
  "integration health" identity. A small, decision-first change.
- [ ] **Batching / non-blocking transport** (#6) — batch ingest endpoint + client
  buffer + `flush()`. This is the "Datadog-logger" thread; only bites at volume.
- [ ] **OTel interoperability** (#8) — document the mapping (`integration≈service.name`,
  `event_type≈event.name`, `severity≈severity_number`); long-term an OTLP-logs
  ingest shim. The thing that makes it truly "general."
- [ ] **Ownerless-project gap** (#10) — CLI projects ingest but their events belong
  to no org, so nobody can view them. Attach to an org or document.
- [ ] **Scale ceiling** (#9) — single SQLite file / one Fly machine is single-writer;
  document the ceiling rather than pretend it scales horizontally.

---

## 5. Build out each integration for a more illustrative IHD — ✅ adapter hook shipped (2026-07-19)

Not a per-integration history/tracker — the goal is to flesh each host-app
integration out so the IHD has richer, more illustrative data. Done via an
**adapter `dimensions()` hook**: `IntegrationAdapter.dimensions?(snapshot)`
returns `{ metrics?, tags?, payload?, severity? }`, which `runAdapter` merges
into the IHD report (runner-owned `latencyMs`/`itemCount`/`source`/`environment`
still win on collision). Each integration now opts in to emit its own queryable
signals — no change to the IHD schema (schemaVersion 2 already carries them) and
no new tables. This is the mechanism that makes #2 monitor predicates bite on
real per-integration data.

Emitted today (host `adapters/*.ts`):
- **weather** — `metrics.tempF` + `alertCount`, `tags.conditions`, `severity`
  from active NWS alerts. ("tempF > 90" / "any Severe alert" are now monitorable.)
- **nyc-civic-finance** — `metrics.totalAmount` + `maxContribution`.
- **nyt-news** — `metrics.topStoriesCount`/`mostViewedCount`, `tags.topSection`.
- **nyt-books** — `metrics.newEntries` + `topWeeksOnList`, `tags.list`.

**Deploy:** host-app only (no SDK/IHD change). Adapters already send schemaVersion
2. Redeploy the host to start emitting the new dimensions.

Remaining (optional, backlog):
- IHD web: per-metric mini-charts on the integration cards driven by whatever
  metrics arrive (the `Sparkline` already generalizes beyond latency).

---

## 1. Address the code-review / simplification findings

Full report (2026-07-17, private artifact):
https://claude.ai/code/artifact/6ea6dab0-5b06-46ec-be12-3a305de34cd6

A two-repo review with extra scrutiny on the org-scoped multi-tenancy work.
Most findings are now fixed (2026-07-17, IHD `042514c`/`4e30e10`,
host-app `dfb33f4`; NYT key leak earlier in host-app `569c01c`). Remaining
open items are at the bottom.

**Security / integrity — DONE:**
- [x] IHD: event mutation routes (classify/acknowledge/resolve/reopen) now
  require `requireOrgAdmin`, not just membership. `routes/events.ts`
- [x] IHD: `joinOrgByCode` refuses to strand a sole admin of an org with
  members/projects (409). `services/orgStore.ts`
- [x] Both apps: `SESSION_SECRET` resolved once at boot, throws in prod if
  unset instead of a forgeable default. `services/authToken.ts`

**Reliability — DONE:**
- [x] Fetch timeouts: SDK `report()` (`AbortSignal.timeout`, retryable) and
  host `fetchJson` (shared root for all adapters).
- [x] Host `useAuth`: signed-out fallback on a failed `/api/auth/me`.
- [x] Host: `ErrorBoundary` around tab content (partial payload no longer
  white-screens). `components/ErrorBoundary.tsx`
- [x] Host scheduler: in-flight guard against overlapping adapter runs.
- [x] SDK: a 2xx with an empty/unparseable body is no longer a false failure.

**Correctness / UX — DONE:**
- [x] civic-finance `NaN` total (coerce non-numeric amounts to 0).
- [x] civic table vs chart timezone off-by-one (format both from the string).
- [x] stale dashboard data after an org switch (refetch health on org change).
- [x] negative `limit` dumped the whole event table (clamp to [1, MAX]).
- [x] admin refresh throttle now keyed on last attempt, not just a snapshot,
  so failing integrations are throttled too.
- [x] 401/403 handled as a sign-in prompt on the All Events tab.

**Simplifications — DONE:** dropped the `EventStore` class + 13 forwarding
wrappers (plain functions now), deleted dead `services/index.ts`, hoisted the
duplicated `orgIdFor` into `middleware/auth.getOrgId`.

**Simplifications — decided against / N/A:**
- Host `scripts/refresh.ts` is NOT dead — it's wired to `npm run refresh` and
  cited in UI empty-states. The "2 failing dist tests" don't reproduce:
  vitest 4 excludes `dist/**` by default. No change.
- Host-web `ApiError` taxonomy kept — the `.status` field is genuinely useful
  (IHD web now uses it for 401/403 handling); deleting 3 fields isn't worth it.

**Still open (deferred — deploy-sensitive, need a real `fly deploy` to verify):**
- Prod Docker image copies the full `node_modules` (dev deps included). Split a
  prod-only deps stage (`npm install --omit=dev`).
- Web bundle is built locally before `fly deploy` (stale-bundle footgun). Move
  the `@ihd/web` build into the Dockerfile builder stage.
  Do these two together as one focused change with a local `docker build` +
  boot check before deploying.

---

## 2. "Monitor" feature — ✅ v1 IMPLEMENTED (2026-07-19, `43aef40`)

Graph-only v1 shipped: org-scoped `monitors` table, a match engine
(`monitorMatch.ts` — `buildMatchClause`/`validateMatchSpec`, json paths bound
not interpolated, severity ordinal, 8-case self-check), org-scoped CRUD +
bucketed graph query (`monitorStore.ts`), `/api/monitors` routes (member read /
admin write), and a **Monitors** tab (list with 24h match badge + enable/delete,
create form with a predicate builder, expandable bar-chart graph over 24h/7d/30d).

**Deploy:** ✅ live in prod (Fly release v21, 2026-07-22). IHD-only; the
`monitors` table is created on boot (`CREATE IF NOT EXISTS`). No SDK/host change.

**Scope cuts (v1) — deferred:**
- No notifications/firings yet (graph is the artifact). In-app alert layer is a
  follow-on once trigger semantics are chosen (threshold/window vs any-new-match).
- No spec editing in the UI (create + toggle + delete only); PATCH-spec exists
  server-side, wire an edit form when needed.
- No dashboard "N firing" badge yet.
- Firing/alert history + its retention sweep — only if the alert layer lands.

Original design notes below.

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

**Decided (2026-07-19):** a monitor is a Datadog-style **graph of the events
matching its configuration**, not a per-event alerter — the graph is derived
from the events table, no stored "firings" required. Notifications are **in-app
only** for v1 (a thin optional alert layer). Depends on #3 (**confirmed: do #3
first**). Event-level dedupe (UUIDv7 ids + idempotency) means the graph counts
distinct real events. See `docs/DESIGN-monitors-and-event-data.md` Part B.

Still open: exact alert-trigger semantics (threshold/window vs "any new match")
— settle when building #2, doesn't block #3.

---

## 3. Expand the data collected in events — ✅ IMPLEMENTED (2026-07-19, `d726aff`)

Platform capability shipped: schemaVersion 2 with optional `metrics`, `tags`,
`environment`, `severity`, `source`; UUIDv7 event ids; SDK 0.2.0. Backward
compatible (v1 reporters still work; old event rows keep v4 ids).

**Deploy / publish:**
- IHD deploy picks up the columns + validation + UUIDv7 (safe: existing DB
  gets the columns ALTERed on boot).
- Publish SDK `0.2.0` when ready; the host app only needs the bump once we wire
  its adapters to actually emit dimensions (below).

**Follow-ons — DONE (2026-07-19, host `73361e9`, IHD web `c1c0a43`):**
- [x] Host adapters emit `metrics.latencyMs` + `metrics.itemCount`, `source`
  (`integrations-host-app@0.1.0`), `environment` (NODE_ENV) on every refresh.
- [x] IHD web: latency trend sparkline per integration card (metrics.latencyMs).

**Deploy ordering (must be in this order):**
1. Deploy IHD #3 (accepts schemaVersion 1 **and** 2) — the live IHD still
   rejects v2.
2. Publish `@theof/ihd-sdk` 0.2.0, then `npm install` in the host (reconciles
   the lockfile, still at 0.1.1 in the commit).
3. Deploy the host (now emits v2). Latency sparklines fill in once events flow.

Original scope notes:

Events today carry: `integration`, `event_type`, `status`, `timestamp`,
`payload`, `error`, `classification`, `resolution`, `idempotency_key`.
Expand the ingest schema (and SDK) with more structured, queryable fields so
the dashboard and monitors (#2) have more to work with. Candidates:
- Numeric **metrics** (latency/duration, item counts) for real trend charts.
- **Tags / labels** and an **environment** dimension (prod/staging) for
  filtering and grouping.
- **Severity** as a first-class field (not only derived from AI classification).
- A **source** identifier (host / adapter version).

Also (decided 2026-07-19): switch event `id`s from random **UUIDv4 to UUIDv7**
(time-sortable, still unique) — cleaner ordering/pagination and a distinct id
per real event. Keep the `idempotency_key` retry-dedupe (a retried send stays
one row; we are NOT making every POST unique). This is the "best-practice event
ID system" that underpins the Monitor graphs in #2.

Keep the SDK's wire format versioned (`schemaVersion`) and backward compatible;
new fields should be optional so existing reporters keep working.

**Confirmed: #3 is the next build**, ahead of #2.

---

## 4. Data retention / cleanup (remove data older than 60 days)

Requested as a host-app cleanup, but the host app **doesn't accumulate history**:
its `snapshots` table is upsert, one row per integration, overwritten each
refresh (~4 rows total). Nothing there ages.

The data that actually grows unbounded is **IHD's `events` table** — every
reported event is inserted and never deleted (the only `DELETE FROM events` is
the test-only `clearEvents`). That's what a 60-day retention job should target.

Plan:
- A scheduled sweep (node-cron in the IHD process, or a small daily job) that
  runs `DELETE FROM events WHERE timestamp < ?` for a 60-day cutoff.
- Make the window configurable (`EVENT_RETENTION_DAYS`, default 60).
- When the Monitor feature (#2) lands, its `monitor_firings` history needs the
  same sweep (also currently unbounded per that design).
- Consider `VACUUM`/WAL checkpoint after large deletes so the SQLite file
  actually shrinks on the Fly volume.
- Leave a `ponytail:` note if we start with a naive full-table delete.
