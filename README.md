# Integration Health Dashboard

An AI-native monitoring tool for third-party integrations, built to demonstrate full-stack TypeScript development, AI-assisted error classification, and construction-domain awareness.

**[View Blueprint](./docs/blueprint.md)**

## Problem

Companies integrating with multiple external systems (CRMs, payroll, ERPs, payments) struggle to quickly triage integration failures. Engineers waste time manually classifying errors that follow predictable patterns, while non-technical stakeholders lack visibility into system health.

In construction specifically, integration failures can have immediate business impact:
- Payroll sync issues delay workers getting paid
- Job costing gaps affect project profitability tracking
- Card authorization failures stop field workers from purchasing materials
- Compliance report failures risk regulatory penalties

## Solution

A dashboard that:
- **Receives webhooks** from integrated systems (simulated for demo)
- **Detects and logs failures** with full context
- **Uses AI to classify errors** and suggest actionable fixes
- **Shows integration health at a glance** for engineering and ops teams

### Key Features

- **System Health Overview** — Real-time status of all integrations with error resolution tracking
- **Event Stream** — Chronological log of sync events and failures with resolution status indicators
- **All Events View** — Paginated, filterable, sortable view of all events with CSV export
- **AI Error Triage** — Click any failure to get AI-generated analysis, root cause, and suggested fix
- **Data Sync Monitoring** — Track sync pipeline health across clients, view execution details, trigger manual syncs
- **Construction Domain Awareness** — AI understands job costing, prevailing wage, certified payroll

## Why AI (and Why Not Everywhere)

This project demonstrates a deliberate approach to AI integration:

| Layer | Technology | Why |
|-------|------------|-----|
| Detection | Deterministic logic | Failures should be caught reliably with clear rules |
| Classification | AI (OpenAI GPT-4o-mini) | Pattern recognition across error types, context-aware suggestions |
| Decision | Human | AI suggests, engineers and contractors decide and act |

AI is a **force multiplier**, not a replacement for engineering judgment. The AI layer is:
- Transparent (prompts are visible in code)
- Tunable (easy to adjust for different domains)
- Fallback-safe (mock classification when API unavailable)

## Simulated Integrations

The dashboard simulates 5 integrations relevant to construction contractor software:

| Integration | Type | Data Flow |
|------------|------|-----------|
| **Procore** | Project Management | Jobs, cost codes, daily logs |
| **Gusto** | Payroll | Employees, timecards, payroll runs |
| **QuickBooks** | Accounting | Invoices, job costs, GL entries |
| **Stripe Issuing** | Payments | Card authorizations, transactions |
| **Certified Payroll** | Compliance | WH-347, LCPtracker, prevailing wage |

Each integration includes realistic error scenarios: auth failures, rate limits, data validation, and domain-specific issues.

## Data Sync Monitoring

The dashboard includes a comprehensive sync monitoring system that tracks data synchronization across all client instances:

### Sync Pipelines

| Pipeline | Integration | Direction | Data Type |
|----------|-------------|-----------|-----------|
| Projects | Procore | Pull | Project data and metadata |
| Cost Codes | Procore | Pull | Cost code structures |
| Employees | Gusto | Pull | Employee records |
| Timecards | Gusto | Pull | Time entries |
| Invoices | QuickBooks | Pull | Invoice data |
| GL Entries | QuickBooks | Push | Journal entries |
| Transactions | Stripe Issuing | Pull | Card transactions |

### Features

- **System Overview** — Company-wide health metrics, sync rates, failing/stale instance counts
- **Pipeline Health Table** — Success rates, instance counts, average durations per pipeline
- **Failing Instances Alert** — Immediate visibility into sync failures with error details
- **Per-Client Instance View** — Filter by client, status; view recent executions
- **Execution Details** — Full request/response inspection, record counts, errors, warnings, and changes
- **Manual Sync Trigger** — Trigger immediate sync for any instance

## All Events View

A comprehensive view for auditing and exporting all integration events:

- **Pagination** — Browse through all events with configurable page sizes
- **Filtering** — Filter by integration, status (success/failure), resolution status (open/acknowledged/resolved)
- **Search** — Full-text search across event types, integrations, and error messages
- **Sorting** — Sort by timestamp, integration, event type, or status
- **CSV Export** — Export filtered events with full details for offline analysis

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React + Vite + TypeScript |
| Backend | Node + Express + TypeScript |
| AI | OpenAI API (gpt-4o-mini) |
| Styling | Tailwind CSS |
| Deployment | Fly.io |

## Project Structure

```
integration-health-dashboard/
├── docs/
│   └── blueprint.md              # Design document
├── packages/
│   ├── api/                      # Express backend
│   │   └── src/
│   │       ├── routes/           # Webhook receivers, events, integrations, sync
│   │       ├── services/         # Event store, health calculator, AI classifier, sync store
│   │       └── types/            # TypeScript types
│   ├── web/                      # React frontend
│   │   └── src/
│   │       ├── components/       # Dashboard, EventStream, EventsView, ErrorTriage, DataSyncDashboard
│   │       └── api/              # API client
│   └── simulator/                # Webhook simulator
│       └── src/scenarios/        # Per-integration test scenarios
├── fly.toml                      # Deployment config
└── package.json                  # Monorepo workspace config
```

## Running Locally

### Prerequisites
- Node.js 20+
- npm 9+
- OpenAI API key (optional, mock classification works without it)

### Setup

```bash
# Clone the repository
git clone https://github.com/theoferguson/integration-health-dashboard.git
cd integration-health-dashboard

# Install dependencies
npm install

# Set up environment (optional, for real AI classification)
export OPENAI_API_KEY=your_key_here

# Start the development servers
npm run dev
```

This starts:
- API server at http://localhost:3001
- Frontend at http://localhost:5173

### Running the Simulator

```bash
# Seed demo data (success events + errors for triage)
npm run simulate -- --demo

# Run all scenarios
npm run simulate

# Run scenarios for specific integration
npm run simulate -- --integration procore
```

## Design Decisions

### 1. TypeScript Everywhere
Type safety across frontend, backend, and simulator. Shared types ensure consistency.

### 2. In-Memory Event Store
For this demo, events are stored in memory. In production, this would be replaced with SQLite (see roadmap below).

### 3. Prompt Engineering as Code
The AI classifier prompt is explicit and tunable. Construction domain knowledge is embedded directly in the system prompt, making it easy to adjust for different industries.

### 4. Monorepo with Workspaces
Single repository with npm workspaces for coordinated development while maintaining package boundaries.

### 5. Minimal UI
Clarity over polish. The dashboard prioritizes information density and actionability over visual flourish.

---

## Roadmap — Evolving into a General Observability Tool

The current dashboard is a high-quality demo with simulated data. The next phase expands it into a lightweight, self-hosted observability platform — a minimal Sentry/Datadog that any codebase can instrument against via an SDK.

### Why this direction

The architecture is already right. The event model, triage workflow, AI classification, and sync monitoring are all production-quality. What's missing is:
1. Persistent storage so data survives server restarts
2. A way for real applications to send events to the dashboard
3. Project isolation so multiple codebases can be monitored independently

### Phase 1 — Persistent storage (SQLite)

**Goal:** Events survive restarts. Dashboard becomes genuinely useful, not just a demo.

Replace the in-memory `EventStore` with `better-sqlite3`. SQLite is the right choice here — no separate database service, single file on disk, fast enough for thousands of events, and Fly.io supports persistent volumes natively.

Schema:

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  api_key TEXT UNIQUE NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  integration TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  payload TEXT NOT NULL,      -- JSON
  error TEXT,                 -- JSON
  classification TEXT,        -- JSON
  resolution TEXT,            -- JSON
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX idx_events_project_time ON events(project_id, timestamp DESC);
CREATE INDEX idx_events_status ON events(project_id, status);
```

**Changes required:**
- Swap `EventStore` service (same interface, different backing)
- Add `projects` table and lightweight key management endpoint
- Mount a Fly.io persistent volume at `/data`
- Update `fly.toml` with volume config

**Effort:** ~1 day

---

### Phase 2 — Generic ingestion endpoint

**Goal:** Accept events from any application, not just the simulated construction integrations.

Add a new route `POST /api/ingest` that accepts a general-purpose event payload authenticated by API key:

```ts
// Request body
{
  integration: string,      // e.g. "stripe", "auth", "database", or any label
  event_type: string,       // e.g. "payment.failed", "login.error"
  status: "success" | "failure" | "pending",
  payload: Record<string, unknown>,
  error?: {
    message: string,
    code?: string,
    stack?: string,
    context?: Record<string, unknown>
  }
}

// Auth header
Authorization: Bearer proj_xxxxxxxxxxxx
```

The existing construction-specific webhook routes (`/api/webhooks/procore`, etc.) stay as-is and power the demo mode. The new `/api/ingest` endpoint is the generic entry point for SDK usage.

**Effort:** ~half day

---

### Phase 3 — SDK package (`packages/sdk`)

**Goal:** A small npm package developers drop into their applications to start sending events to the dashboard.

```bash
npm install @theof/ihd-sdk
```

#### Node.js / Express

```ts
import { IHDClient } from '@theof/ihd-sdk'

const monitor = new IHDClient({
  apiKey: process.env.IHD_API_KEY,
  endpoint: 'https://integration-health-dashboard.fly.dev',
  project: 'my-api'
})

// Auto-capture unhandled Express errors
app.use(monitor.expressMiddleware())

// Manual capture anywhere
try {
  await syncPayroll()
} catch (err) {
  monitor.capture(err, {
    integration: 'gusto',
    event_type: 'payroll.sync',
    context: { clientId, payPeriod }
  })
}
```

#### React

```tsx
import { IHDErrorBoundary } from '@theof/ihd-sdk/react'

// Wraps your app — captures unhandled React errors
<IHDErrorBoundary client={monitor}>
  <App />
</IHDErrorBoundary>
```

#### SDK internals

- Batches events and flushes every 2s (or immediately on error)
- Fire-and-forget by default — never blocks the calling process
- Retries failed sends up to 3 times with exponential backoff
- TypeScript-native with full type exports
- Zero required dependencies (uses `fetch`, available in Node 18+)

**Effort:** ~1–2 days

---

### Phase 4 — Dashboard UI adjustments

**Goal:** Surface project-level data and make the dashboard useful for generic apps, not just the construction demo.

- **Project switcher** — dropdown to switch between monitored projects
- **Generic integration labels** — "auth", "database", "payments" alongside existing construction labels
- **Demo mode toggle** — button to seed the existing construction scenarios for showcase purposes
- **API key management page** — create/revoke keys, view project usage

**Effort:** ~half day

---

### Total scope

| Phase | Description | Effort |
|-------|-------------|--------|
| 1 | SQLite persistence + Fly volume | ~1 day |
| 2 | Generic `/api/ingest` endpoint | ~half day |
| 3 | SDK package (Node + React) | ~1–2 days |
| 4 | Dashboard UI adjustments | ~half day |
| **Total** | | **~3–4 days** |

---

### What this enables

Once complete, any project can be instrumented in under 5 minutes:

```bash
npm install @theof/ihd-sdk
```

```ts
const monitor = new IHDClient({ apiKey: 'proj_xxx', endpoint: '...' })
app.use(monitor.expressMiddleware())
```

Events flow into the dashboard, get AI-classified on demand, and can be triaged, acknowledged, and resolved by the team. The construction demo remains as a showcase of domain-specific capability.

---

## Accounts & Projects

Sign-in is GitHub OAuth with **open signup** - anyone with a GitHub account
can sign in and create their own projects. Each project is an API key scoped
to whoever created it; the "Projects" tab lists (and lets you delete) only
your own, never anyone else's. This is what makes IHD an actual multi-tenant
platform rather than a single-operator tool - any project, yours or someone
else's, can report in via `POST /api/ingest` once it has a key.

The CLI script (`npm run create-project`) still works standalone for
scripting/bootstrapping - it creates an ownerless project not tied to any
account, which is fine for ingest (auth there is by API key, not by owner)
but won't show up in anyone's "Projects" list.

### Setting up the GitHub OAuth App

One-time step on your own GitHub account:

1. Go to [github.com/settings/developers](https://github.com/settings/developers) → **OAuth Apps** → **New OAuth App**.
2. Homepage URL: `http://localhost:5173` for local dev, or your Fly app's URL in production.
3. **Authorization callback URL**: `http://localhost:3001/api/auth/callback` locally, or `https://<your-app>.fly.dev/api/auth/callback` in production. GitHub requires an exact match - use two separate OAuth Apps (dev/prod) rather than switching one back and forth.
4. Generate a client secret, then fill in `.env`: `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, `SESSION_SECRET` (see `.env.example` for how to generate it).

## Deployment

### Deploy to Fly.io

```bash
# Install Fly CLI
brew install flyctl

# Login
fly auth login

fly apps create integration-health-dashboard
fly volumes create ihd_data --size 1 -a integration-health-dashboard --region sjc

# optional secrets
fly secrets set OPENAI_API_KEY=... GITHUB_OAUTH_CLIENT_ID=... GITHUB_OAUTH_CLIENT_SECRET=... SESSION_SECRET=... -a integration-health-dashboard

npm run build   # packages/web/dist must exist locally - the Dockerfile copies
                # it rather than building it
fly deploy
```

The volume has to exist before the first deploy - `fly deploy` won't
auto-create it from `fly.toml`'s `[[mounts]]` block. Without it, every
restart/redeploy wipes all projects and events (Fly Machines don't persist
local disk by default).

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `OPENAI_API_KEY` | OpenAI API key for AI classification | No (mock fallback) |
| `PORT` | Server port | No (defaults to 3001 locally, 8080 in prod) |
| `DB_PATH` | SQLite file path | No (defaults to `./data/ihd.db`; set to a mounted volume path in production) |
| `GITHUB_OAUTH_CLIENT_ID` / `_SECRET` | GitHub OAuth App credentials | Only for sign-in/project management |
| `SESSION_SECRET` | Signs the session cookie | Only for sign-in (insecure dev default otherwise) |

---

## About

Built by **Theo Ferguson** as a portfolio project demonstrating:

- **AI-native development** — Using LLMs as infrastructure, not magic
- **Full-stack ownership** — Backend, frontend, deployment, documentation
- **Domain awareness** — Construction software integrations (payroll, job costing, compliance)
- **Production thinking** — Error handling, graceful degradation, observability

---
