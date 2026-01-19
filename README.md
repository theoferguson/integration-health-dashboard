# Integration Health Dashboard

An AI-native monitoring tool for third-party integrations, built to demonstrate full-stack TypeScript development, AI-assisted error classification, and construction-domain awareness.

**[Live Demo](https://integration-health-dashboard.fly.dev)** | **[View Blueprint](./docs/blueprint.md)**

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
For this demo, events are stored in memory. In production, this would be MongoDB or PostgreSQL with proper indexing for time-series queries.

### 3. Prompt Engineering as Code
The AI classifier prompt is explicit and tunable. Construction domain knowledge is embedded directly in the system prompt, making it easy to adjust for different industries.

### 4. Monorepo with Workspaces
Single repository with npm workspaces for coordinated development while maintaining package boundaries.

### 5. Minimal UI
Clarity over polish. The dashboard prioritizes information density and actionability over visual flourish.

## What I'd Build Next

With more time, I would add:

1. **Persistent storage** — MongoDB for events, integration configs, sync history
2. **Alerting** — Configurable thresholds, Slack/email notifications
3. **Retry queue** — Automatic retry with exponential backoff
4. **Integration-specific SLAs** — Health scores based on expected sync frequency
5. **Team assignment** — Route errors to responsible engineers
6. **Audit log** — Track who acknowledged/resolved issues
7. **Real webhook verification** — Stripe signature verification, OAuth token management
8. **Sync scheduling** — Configurable sync schedules per pipeline/client

## Deployment

### Deploy to Fly.io

```bash
# Install Fly CLI
brew install flyctl

# Login
fly auth login

# Deploy (first time)
fly launch

# Deploy (subsequent)
fly deploy
```

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `OPENAI_API_KEY` | OpenAI API key for AI classification | No (mock fallback) |
| `PORT` | Server port | No (defaults to 3001 locally, 8080 in prod) |

## About

Built by **Theo Ferguson** as a portfolio project demonstrating:

- **AI-native development** — Using LLMs as infrastructure, not magic
- **Full-stack ownership** — Backend, frontend, deployment, documentation
- **Domain awareness** — Construction software integrations (payroll, job costing, compliance)
- **Production thinking** — Error handling, graceful degradation, observability

---

*This project was built to demonstrate how I approach software development: lean, opinionated, and focused on real problems.*
