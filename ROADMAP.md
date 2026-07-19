# Roadmap

Backlog for the Integration Health Dashboard (IHD) and its companion
`integrations-host-app`. Newest planning notes at the top of each section.

---

## 5. Host app: history per integration (not just a live snapshot)

Today the host app stores one `snapshots` row per integration (upsert, latest
only). Turn each integration into an **ongoing tracker** with history, and pick
the presentation that fits each data type rather than one generic view:
- **weather** — time series of temperature/conditions; a line/area chart over time.
- **nyc-civic-finance** — cumulative contributions and daily inflow; running
  totals + a "new since last check" feed.
- **nyt-news / nyt-books** — change log / rank movement over time (books already
  has rank-vs-last-week; make it a real trend), not just the current list.

Shape:
- Append-only `snapshot_history` table (integration, fetched_at, data) alongside
  the current latest-snapshot row, OR make `snapshots` append-only and derive
  "latest" with `MAX(fetched_at)`.
- Only append when the data actually changed (the new `fetch_state` signature /
  `isUnchanged` check already tells us this cheaply - no dupe points).
- Per-integration history views on the web tabs.
- Needs its own retention sweep (tie into workstream #4's 60-day cutoff).

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

**Decided (2026-07-19):** a monitor is a Datadog-style **graph of the events
matching its configuration**, not a per-event alerter — the graph is derived
from the events table, no stored "firings" required. Notifications are **in-app
only** for v1 (a thin optional alert layer). Depends on #3 (**confirmed: do #3
first**). Event-level dedupe (UUIDv7 ids + idempotency) means the graph counts
distinct real events. See `docs/DESIGN-monitors-and-event-data.md` Part B.

Still open: exact alert-trigger semantics (threshold/window vs "any new match")
— settle when building #2, doesn't block #3.

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
