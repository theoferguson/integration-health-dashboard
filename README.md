# Integration Health Dashboard

A self-hosted, general-purpose observability dashboard for third-party
integrations — a minimal, AI-assisted Sentry/Datadog that **any** application can
report to. Apps send events over an SDK (or a plain `POST /api/ingest`); the
dashboard shows integration health at a glance, AI-classifies failures on demand,
and lets teams graph and triage what matters.

**[Original design doc (historical)](./docs/blueprint.md)** ·
**[Roadmap](./ROADMAP.md)**

## What it does

- **Ingest from anywhere.** Any codebase reports events with an API key —
  `POST /api/ingest` or the [`@theof/ihd-sdk`](./packages/sdk) package. Integration
  and event-type names are free-form; nothing is hardcoded to a particular domain.
- **Health at a glance.** Per-integration cards (healthy / degraded / down),
  success rates, recent-event stream, and trend sparklines from reported metrics.
- **All Events.** Paginated, filterable (integration / status / resolution),
  searchable, sortable, with CSV export.
- **Monitors.** Datadog-style saved event queries rendered as time-series graphs
  of the matching events — filter by integration/type/status plus predicates over
  `metrics.*`, `tags.*`, `payload.*`, `severity`, `environment`.
- **AI error triage.** Click any failure for an AI-generated category, severity,
  root cause, and suggested fix; then acknowledge / resolve / reopen. Falls back
  to a deterministic mock classifier when no OpenAI key is set.
- **Multi-tenant.** Social sign-in (GitHub / Google / Facebook) with open signup;
  each user gets an org, projects are org-scoped, members read and admins manage.

A companion repo, **`integrations-host-app`**, is a real reporter that exercises
this end to end (weather, NYT, NYC campaign-finance adapters emitting live events).

## Direction

The long-term goal is to **cut the technical middle out of integration
observability** — serving two audiences directly off the same event store,
instead of relying on an engineer to translate telemetry for everyone else:

- **A monitoring UI for non-technical users** — CSMs, support, and partnership
  teams answering *"is this customer's / partner's integration healthy?"* at a
  glance, without reading logs or writing queries.
- **A robust API as an agentic / MCP touchpoint** — a first-class programmatic
  surface (and an MCP server over it) so skills, agents, and MCP clients can
  query and evaluate integration status, and automate the monitor/triage loop
  a human would otherwise run by hand.

See the [Roadmap](./ROADMAP.md) for how the backlog maps to these two "front doors."

## The event model

Events are the one thing integrators send. All fields below the line are optional
(`schemaVersion` 2); a v1 reporter simply omits them and still works.

| Field | Required | Meaning |
|-------|----------|---------|
| `integration` | ✓ | Free-form label for the thing reporting, e.g. `stripe`, `weather`. |
| `event_type` | ✓ | Free-form, e.g. `payment.failed`, `forecast.sync`. |
| `status` | ✓ | `success` \| `failure` \| `pending`. Drives the health rollup. |
| `payload` | — | Arbitrary context object (stored as JSON). |
| `error` | — | `{ message*, code?, context? }` — AI-classified when `status` is `failure`. |
| `idempotency_key` | — | Per-project dedupe; the SDK auto-generates one per send. |
| `metrics` | — | `Record<string, number>` — numeric measures for trends / monitor predicates. |
| `tags` | — | `Record<string, string>` — labels for filtering / grouping. |
| `environment` | — | `prod` / `staging` / … |
| `severity` | — | `low` \| `medium` \| `high` \| `critical` (reporter-supplied). |
| `source` | — | Reporter identity, e.g. `my-api@1.4.0`. |

The server assigns each event a time-sortable UUIDv7 `id` and `timestamp`; `id`
is never sent by the client. See [`docs/DESIGN-monitors-and-event-data.md`](./docs/DESIGN-monitors-and-event-data.md).

> **Data handling.** `payload`, `tags`, and `error.context` are stored as sent,
> and a failure's `error` is sent to OpenAI when someone classifies it. Scrub
> sensitive data before it leaves your process with the SDK's
> [`beforeSend`](./packages/sdk/README.md#redacting-data-beforesend) hook.
> `payload` is capped at 32 KB at the ingest boundary; events age out after
> `EVENT_RETENTION_DAYS` (default 60).

## Reporting events

### With the SDK

```bash
npm install @theof/ihd-sdk
```

```ts
import { IHDClient } from '@theof/ihd-sdk'

// DSN is `https://<apiKey>@<host>`; the key comes from `npm run create-project`.
const monitor = new IHDClient({ dsn: process.env.IHD_DSN! })

await monitor.report({
  integration: 'stripe',
  eventType: 'payout.sync',
  status: 'success',
  metrics: { latencyMs: 214, itemCount: 12 },
})

try {
  await syncPayroll()
} catch (err) {
  await monitor.captureError(err, { integration: 'gusto', eventType: 'payroll.sync' })
}

// Express: auto-capture unhandled route errors
app.use(monitor.expressMiddleware('my-api'))
```

`report()` and `captureError()` never throw — they resolve to `{ ok: false }`
after retries, so a flaky IHD never breaks the caller. See the
[SDK README](./packages/sdk/README.md) for the full surface.

### Or with a raw request

```bash
curl -X POST https://integration-health-dashboard.fly.dev/api/ingest \
  -H "Authorization: Bearer proj_your_key" \
  -H "Content-Type: application/json" \
  -d '{
    "schemaVersion": 2,
    "integration": "stripe",
    "event_type": "payout.sync",
    "status": "success",
    "metrics": { "latencyMs": 214 }
  }'
```

Responses: `201 { event, duplicate: false }` on create, `200 { …, duplicate: true }`
on an idempotency hit, `400` with a specific message on a bad body, `401` on a
missing/invalid key, `429` once a project exceeds its per-minute ingest budget
(`RateLimit-*` headers say when to retry).

## Reading data (the `/api/v1` API)

Ingest is the write path; **`/api/v1`** is the read path — a versioned,
read-only surface for querying health, events, and monitors programmatically.
It's the foundation the planned MCP server wraps, so agents and scripts can
evaluate integration status without scraping the dashboard (see the
[Roadmap](./ROADMAP.md), Door 2).

Auth is a **read token** — org-scoped, read-only, and distinct from a project's
ingest key and the browser session (leaking one doesn't grant the others). Only
its hash is stored; the secret is shown once. Mint one from the CLI (or the
admin API — `POST /api/read-tokens`):

```bash
npm run create-read-token -w @ihd/api -- --org <orgId> --name "my-agent"
# run without --org to list your org ids
```

Then send it as a bearer token:

```bash
curl https://integration-health-dashboard.fly.dev/api/v1/health \
  -H "Authorization: Bearer ihd_read_your_token"
```

| Endpoint | Returns |
|----------|---------|
| `GET /api/v1` | Capability document scoped to your token (see _Agent discovery_ below). |
| `GET /api/v1/health` | Overall rollup + per-integration health. |
| `GET /api/v1/integrations` | Every integration with its health status. |
| `GET /api/v1/integrations/:id` | One integration's health + recent events. |
| `GET /api/v1/events` | Paginated, filterable events (`integration`, `status`, `resolution_status`, `since`, `search`, `sort_by`, `sort_order`, `limit`≤100, `offset`). |
| `GET /api/v1/events/:id` | A single event. |
| `GET /api/v1/monitors` | The org's saved monitors, each with its match spec + last-24h activity — list here, then pull one. |
| `GET /api/v1/monitors/:id` | A monitor's config + the events its match spec currently selects (paginated: `since`, `sort_by`, `sort_order`, `limit`, `offset`). |
| `GET /api/v1/monitors/:id/series` | A monitor's matching-event time series (`window`, `bucket`). |

All responses are org-scoped to the token. Errors use a consistent envelope,
`{ error: { code, message } }` — `401` (`unauthorized` / `invalid_token`), `400`
(`invalid_query`), `404` (`not_found`), `429` (`rate_limited`, default 300/min
per token via `READ_API_RATE_LIMIT_PER_MIN`, plus a coarse per-IP ceiling for
anonymous traffic; `RateLimit-*` headers say when to retry).

### Agent discovery

Two endpoints let an agent orient itself without hardcoding assumptions, following
the emerging llms.txt → capability-doc convention:

- **`GET /llms.txt`** (public, no token) — a Markdown orientation doc: what IHD is,
  how auth works, the endpoint list, a recommended workflow, and the boundaries.
  This is the file agents and crawlers look for; it describes the _shape_ of the
  API and never any org's data.
- **`GET /api/v1`** (token-scoped) — a JSON capability document for _this caller_:
  its org and token name, the org's **live filter values** (`vocabulary.filters`,
  keyed by the real snake_case query-param names — `integration` is pulled from the
  org's own events, so it's real rather than guessed), the enums that appear in
  responses (`vocabulary.responseValues` — health, error category, severity — kept
  apart from filters so agents don't invent `?category=`), the page-size cap, and
  the per-token rate budget. Undocumented limits are the top agent failure mode, so
  the budget travels in the payload.

The contract (enums, bounds, endpoint list, boundaries) lives in one module,
`services/apiContract.ts`, which `v1.ts` both **validates against and documents
from** — so a filter can't ship documented-but-unvalidated, or the reverse.

### MCP server

A remote **streamable-HTTP MCP server** (`POST /mcp`) exposes the same read
surface as one-per-action MCP tools (`get_health`, `list_integrations`,
`get_integration`, `query_events`, `get_event`, `list_monitors`, `get_monitor`,
`get_monitor_series`), so an agent in an MCP host can call the dashboard's data
directly instead of constructing HTTP requests. It wraps the exact service
functions `/api/v1` uses, so query semantics never fork between the two doors;
every tool is `readOnlyHint` and scoped to the caller's org.

**Two ways to connect** — one works today, one is planned:

- ✅ **Read token (now).** Paste an `ihd_read_*` bearer token. Works in Claude
  Code, the MCP Inspector, and any header-capable host:
  ```bash
  claude mcp add --transport http --scope user ihd \
    https://integration-health-dashboard.fly.dev/mcp \
    --header "Authorization: Bearer ihd_read_your_token"
  ```
- 🚧 **Browser sign-in / OAuth (planned, Phase 4).** The one-click
  "Add connector → sign in" flow for Claude.ai / Desktop / ChatGPT (which don't
  accept a pasted token). The auth check lives behind a single swappable boundary
  (`mcp/auth.ts`), so the tools and transport don't change when it lands.

📖 **Full walkthrough — getting a token, adding it in each host, example prompts,
boundaries, troubleshooting, and the planned OAuth path: [docs/CONNECTING-MCP.md](./docs/CONNECTING-MCP.md).**

## Why AI (and why not everywhere)

| Layer | Technology | Why |
|-------|------------|-----|
| Detection | Deterministic logic | Failures are caught by clear rules, reliably. |
| Classification | AI (OpenAI gpt-4o-mini) | Pattern recognition + context-aware fix suggestions across error types. |
| Decision | Human | AI suggests; engineers acknowledge / resolve. |

The classifier prompt is explicit in code (`services/classifier.ts`), tunable, and
fallback-safe (a deterministic mock runs when no API key is set). It reasons from
the error message rather than assuming what any integration is for, so it works
for arbitrary reporters.

## Tech stack

| Layer | Technology |
|-------|------------|
| Frontend | React + Vite + TypeScript + Tailwind |
| Backend | Node + Express + TypeScript |
| Storage | SQLite (`better-sqlite3`, WAL) on a Fly volume |
| AI | OpenAI API (gpt-4o-mini), mock fallback |
| Deployment | Fly.io |

## Project structure

```
integration-health-dashboard/
├── docs/                          # blueprint (historical), design docs
├── packages/
│   ├── api/     src/routes,services,db,middleware   # Express backend + SQLite
│   ├── web/     src/components,hooks,api             # React dashboard
│   ├── sdk/     src/index.ts                         # @theof/ihd-sdk
│   └── shared/  src/types,constants                  # shared types
├── ROADMAP.md
├── fly.toml
└── package.json                   # npm-workspace monorepo
```

## Running locally

Prerequisites: Node 20+, npm 9+. OpenAI key optional (mock classification works
without it).

```bash
git clone https://github.com/theoferguson/integration-health-dashboard.git
cd integration-health-dashboard
npm install

# optional, for real AI classification
export OPENAI_API_KEY=your_key_here

npm run dev          # API on :3001, web on :5173
```

Create a project (API key) to report against:

```bash
npm run create-project -- --name "my-app"   # prints an API key once — save it
```

Then send events with that key via the SDK or the `curl` above, or point the
companion `integrations-host-app` at your local IHD.

## Accounts & projects

Sign-in is social OAuth (GitHub / Google / Facebook) with **open signup** —
anyone can sign in and create projects, and signing in via several providers with
the same provider-verified email lands on one account. Each project is an API key
scoped to the creator's org; the Projects tab lists (and deletes) only your own.
Any project with a key can report in via `POST /api/ingest`.

The CLI script (`npm run create-project`) also works standalone for
scripting/bootstrapping — it creates an *ownerless* project (fine for ingest,
but it won't appear in anyone's Projects list, since it has no org).

### Setting up social sign-in

Sign-in supports **GitHub, Google, and Facebook** — configure any subset. Every
provider funnels through the same account model (one person who signs in via
several providers lands on one account, linked by a provider-verified email), and
each provider's OAuth app must register a **provider-scoped callback URL**:

```
<host>/api/auth/callback/<provider>
```

e.g. `http://localhost:3001/api/auth/callback/github` (dev) or
`https://<your-app>.fly.dev/api/auth/callback/google` (prod). Providers require an
exact match — use separate dev/prod apps.

- **GitHub** — [github.com/settings/developers](https://github.com/settings/developers)
  → **OAuth Apps** → **New OAuth App**. Callback:
  `<host>/api/auth/callback/github`. Fill `GITHUB_OAUTH_CLIENT_ID` /
  `GITHUB_OAUTH_CLIENT_SECRET`.
- **Google** — [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials)
  → **Create OAuth client ID** (Web application). Authorized redirect URI:
  `<host>/api/auth/callback/google`. Fill `GOOGLE_OAUTH_CLIENT_ID` /
  `GOOGLE_OAUTH_CLIENT_SECRET`.
- **Facebook** — [developers.facebook.com/apps](https://developers.facebook.com/apps)
  → add **Facebook Login** → Valid OAuth Redirect URI:
  `<host>/api/auth/callback/facebook`. Fill `FACEBOOK_OAUTH_CLIENT_ID` /
  `FACEBOOK_OAUTH_CLIENT_SECRET`.

Also set `SESSION_SECRET` (signs the session cookie — see `.env.example`).

> **Upgrading from the GitHub-only setup:** the callback moved from
> `/api/auth/callback` to `/api/auth/callback/github`. Update your existing GitHub
> OAuth App's Authorization callback URL, or GitHub sign-in will fail with a
> redirect-uri mismatch.

## Deployment (Fly.io)

```bash
brew install flyctl
fly auth login

fly apps create integration-health-dashboard
fly volumes create ihd_data --size 1 -a integration-health-dashboard --region sjc

# optional secrets (configure any subset of sign-in providers)
fly secrets set OPENAI_API_KEY=... SESSION_SECRET=... \
  GITHUB_OAUTH_CLIENT_ID=... GITHUB_OAUTH_CLIENT_SECRET=... \
  GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=... \
  FACEBOOK_OAUTH_CLIENT_ID=... FACEBOOK_OAUTH_CLIENT_SECRET=... \
  -a integration-health-dashboard

npm run build   # packages/web/dist must exist — the Dockerfile copies it
fly deploy
```

The volume must exist before the first deploy (`fly deploy` won't create it from
`fly.toml`'s `[[mounts]]`); without it, every redeploy wipes projects and events.

### Environment variables

| Variable | Description | Required |
|----------|-------------|----------|
| `OPENAI_API_KEY` | AI classification | No (mock fallback) |
| `PORT` | Server port | No (3001 local, 8080 prod) |
| `DB_PATH` | SQLite file path | No (`./data/ihd.db`; set to the mounted volume in prod) |
| `EVENT_RETENTION_DAYS` | Days before events are swept | No (default 60) |
| `INGEST_RATE_LIMIT_PER_MIN` | Max ingest requests per project per minute | No (default 120) |
| `READ_API_RATE_LIMIT_PER_MIN` | Max `/api/v1` read requests per token per minute | No (default 300) |
| `PUBLIC_BASE_URL` | Canonical public origin for the discovery docs' self-links (e.g. `https://integration-health-dashboard.fly.dev`) | Recommended in prod (falls back to the request Host) |
| `GITHUB_OAUTH_CLIENT_ID` / `_SECRET` | GitHub OAuth App | Only for GitHub sign-in |
| `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` | Google OAuth 2.0 client | Only for Google sign-in |
| `FACEBOOK_OAUTH_CLIENT_ID` / `_SECRET` | Facebook Login app | Only for Facebook sign-in |
| `SESSION_SECRET` | Signs the session cookie | Only for sign-in (insecure dev default otherwise) |

> **Per-provider callback URL.** Each provider's OAuth app must register the
> redirect URL `<host>/api/auth/callback/<provider>` (e.g.
> `.../api/auth/callback/github`, `.../api/auth/callback/google`,
> `.../api/auth/callback/facebook`). The callback is now provider-scoped — the
> GitHub app's earlier `/api/auth/callback` must be updated to
> `/api/auth/callback/github`. Configure only the providers you want; others just
> 500 on their login route until their env vars are set.

## About

Built by **Theo Ferguson** as a portfolio project demonstrating full-stack
TypeScript, AI-native development (LLMs as infrastructure, not magic), and
production thinking (error handling, graceful degradation, multi-tenancy). It
began as a construction-integrations demo; the classifier's domain awareness is
tunable, but the platform itself is domain-agnostic.
