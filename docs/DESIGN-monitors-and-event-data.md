# Design: Expanded event data (#3) + Monitors (#2)

Covers ROADMAP workstreams #2 and #3. They ship in that dependency order —
**#3 first**, because a monitor's predicates are only interesting once events
carry structured, queryable fields (metrics, tags, severity) instead of an
opaque `payload` blob.

Guiding constraints (unchanged from the rest of the app):
- SQLite + better-sqlite3, single in-process Express server, boot-time
  idempotent `ALTER TABLE` migrations (see `db/connection.ts`).
- Wire format is versioned (`schemaVersion`) and snake_case at the `/api/ingest`
  trust boundary; internal types are camelCase.
- Everything org-scoped; admin writes, members read (existing middleware).

---

## Part A — Expand event data (#3)

### New event fields (all optional, all backward compatible)

| Field | Type | Purpose |
|-------|------|---------|
| `metrics` | `Record<string, number>` | Numeric measures — `latencyMs`, `itemCount`, etc. Powers real trend charts and numeric monitor predicates. |
| `tags` | `Record<string, string>` | Free-form labels for filtering/grouping (`region: "us-east"`). |
| `environment` | `string` | `prod` / `staging` / … — a first-class dimension. |
| `severity` | `ErrorSeverity` (`low\|medium\|high\|critical`) | First-class, reporter-supplied, **distinct from** the AI `classification.severity` (which stays derived-only). |
| `source` | `string` | Reporter identity — host + adapter version, e.g. `iha@1.4.0`. |

`ErrorSeverity` already exists in `shared/types/events.ts` — reuse it.

### Wire contract — `schemaVersion: 2`

Bump to 2, but **keep accepting 1**. A v1 body is a v2 body with all new fields
absent. New keys are snake_case where multi-word (`schema_version` stays as-is
per current spec; fields here are single tokens except none need underscores):

```jsonc
{
  "schemaVersion": 2,
  "integration": "weather",
  "event_type": "refresh",
  "status": "success",
  "payload": { ... },
  "error": { ... },
  "idempotency_key": "…",
  // new (all optional):
  "metrics":     { "latencyMs": 214, "itemCount": 12 },
  "tags":        { "region": "us-east" },
  "environment": "prod",
  "severity":    "high",
  "source":      "iha@1.4.0"
}
```

Validation (`parseIngestBody`): accept `schemaVersion` ∈ {1, 2}; when present,
`metrics` must be an object of finite numbers, `tags` an object of strings,
`environment`/`source` strings, `severity` one of the enum. Reject malformed —
this is the public trust boundary.

### DB migration

Five nullable columns on `events`, added via the existing PRAGMA-guarded
`ALTER TABLE` pattern in `connection.ts`:

```sql
ALTER TABLE events ADD COLUMN metrics TEXT;      -- JSON
ALTER TABLE events ADD COLUMN tags TEXT;         -- JSON
ALTER TABLE events ADD COLUMN environment TEXT;
ALTER TABLE events ADD COLUMN severity TEXT;
ALTER TABLE events ADD COLUMN source TEXT;
```

`metrics`/`tags` stored as JSON strings (same as `payload`/`error`), the rest
scalar. `rowToEvent` hydrates them; `createEvent` persists them.

### SDK (`@theof/ihd-sdk` → 0.2.0)

Extend `ReportInput` with the five optional fields, send `schemaVersion: 2`.
Old callers keep working (fields optional). Publish, then bump the host app.

### What it unlocks immediately
- `metrics.latencyMs` over time → a real latency trend chart (today's charts are
  event counts only).
- `environment` / `tags` as dashboard filters (reuse the events `buildWhere`).
- Reporter-supplied `severity` shown without waiting on an AI classify call.

### Scope cut (v1)
No per-field indexing beyond what exists; metric/tag filtering uses
`json_extract` like the current `resolution` filter. Add a generated column +
index only if a real query gets slow. `# ponytail: json_extract scan, index a
hot metric if it matters.`

---

## Part B — Monitors (#2)

A **monitor** is an org-scoped saved rule that watches for events matching a
spec and records a **firing** each time one does. The IHD analogue of a
Datadog/Sentry alert.

### Data model

```sql
CREATE TABLE monitors (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL REFERENCES orgs(id),
  name       TEXT NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1,
  match_spec TEXT NOT NULL,          -- JSON, see below
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE monitor_firings (
  id         TEXT PRIMARY KEY,
  monitor_id TEXT NOT NULL REFERENCES monitors(id),
  event_id   TEXT NOT NULL REFERENCES events(id),
  fired_at   INTEGER NOT NULL
);
CREATE INDEX idx_firings_monitor ON monitor_firings(monitor_id, fired_at DESC);
```

Match spec is one JSON column (like `resolution`/`classification`) — no separate
predicate table:

```jsonc
{
  "integration": "nyt-news",        // optional exact matches
  "eventType":   "refresh",
  "status":      "failure",
  "predicates": [                    // ALL must hold (AND)
    { "field": "severity",          "op": "gte",      "value": "high" },
    { "field": "metrics.latencyMs", "op": "gt",       "value": 1000 },
    { "field": "tags.region",       "op": "eq",       "value": "us-east" },
    { "field": "payload.tempF",     "op": "gt",       "value": 90 }
  ]
}
```

- **Field path**: first token is a namespace — `status`, `severity`,
  `environment`, `integration`, `eventType` are top-level; `metrics.*`,
  `tags.*`, `payload.*`, `error.*` index into the JSON. One split on the first
  `.`; no deep paths in v1.
- **Ops**: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `contains`, `exists`. Numeric
  ops coerce both sides to number and require finite; `gte` on `severity` uses
  the enum's ordinal (`low<medium<high<critical`). String `contains` for
  substring.
- The evaluator is a ~40-line typed function over the in-memory
  `IntegrationEvent`, not a query language. One `demo()` self-check covering
  each op is the test.

### Evaluation — on ingest, in-process

After `createEvent` succeeds in the ingest route, resolve the project's
`org_id`, load that org's **enabled** monitors, evaluate the new event against
each, and insert a `monitor_firings` row per match. Synchronous and cheap (an
org has a handful of monitors; matching is in-memory). No separate scheduler —
the writer is already in this process.

`# ponytail: per-event evaluation, no windowing. Rate/threshold monitors
("5 failures in 10m") are a v2 — add a windowed evaluator then.`

Failure of monitor evaluation must **never** fail the ingest write — wrap it in
try/catch and log; an event is recorded even if a monitor errors.

### API (`/api/monitors`, org-scoped)

| Method | Path | Who | Notes |
|--------|------|-----|-------|
| GET | `/api/monitors` | member | list org's monitors + last-fired summary |
| POST | `/api/monitors` | **admin** | create (validate match_spec) |
| PATCH | `/api/monitors/:id` | **admin** | rename / enable / edit spec |
| DELETE | `/api/monitors/:id` | **admin** | |
| GET | `/api/monitors/:id/firings` | member | recent firings (paginated) |

Reuse `requireOrgMember` / `requireOrgAdmin` and `getOrgId`. Scope every query
by `org_id`, same pattern as events/projects.

### UI

- New **Monitors** tab: list (name, enabled toggle, match summary, last fired,
  fire count), create/edit form that builds the match spec (integration +
  event_type + status dropdowns, then a repeatable predicate row:
  field-path / op / value), and a firings panel per monitor.
- Dashboard: a small "N monitors firing recently" badge linking to the tab.
- Viewers see read-only (no create/edit/toggle), consistent with Projects.

### Scope cuts (v1)
- In-app only — no email/webhook/Slack. (Notification channels = v2.)
- Per-event matching only — no rate/threshold windows (v2).
- No mute/snooze; disable the monitor instead.
- Firing history retained unbounded; add a retention sweep if it grows.

---

## Sequencing

1. **#3 event data** — types + migration + ingest validation + eventStore +
   SDK 0.2.0 + one new chart/filter. Ship and publish SDK.
2. **#2 monitors** — tables + match evaluator (+ self-check) + ingest hook +
   routes + UI. Predicates now have metrics/tags/severity to bite on.

Each is independently shippable; #2 is far more useful after #1.

## Open questions for review
- Reporter-supplied `severity` vs AI `classification.severity` — keep both
  distinct (proposed), or have one override the other on display?
- Monitor firing on **every** matching event vs de-duping while a condition
  stays true (needs "resolved" semantics — leans v2 windowing)?
- v2 notifications: which channel first — webhook (most portfolio-relevant) or
  email?
