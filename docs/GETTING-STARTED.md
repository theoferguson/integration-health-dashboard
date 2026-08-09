# Getting started

The Integration Health Dashboard watches third-party integrations for you. An
app reports what happened — a sync succeeded, a webhook 500'd — and the
dashboard turns that stream into health, alerts you when something stops
reporting, and explains failures with AI triage.

There are two ways to use it, and they read the same data:

- **From the dashboard** — sign in, point an app at it, watch the cards. No
  code beyond the one call that reports events.
- **From an agent** — connect an MCP client and ask questions in English:
  *"which integrations are degraded, and why?"*

Pick the path you need. They are independent; doing one first does not commit
you to the other.

---

## Path 1 — Using the dashboard

### 1. Sign in

Click **Sign in** in the header. One modal offers everything: Google, GitHub,
Facebook, or an email and password. Signup is open — the first sign-in creates
your account.

There is no password reset yet, so if you use email and password, keep it
somewhere safe. The social buttons are the recovery path.

### 2. You get an organization automatically

Signing in creates an organization for you and makes you its **admin**. An
organization owns everything else: projects, events, monitors, and read tokens.
You never have to create one.

To bring in teammates, open the **Projects** tab and share the invite code. They
sign in, paste the code, and land in your organization as **viewers** — they can
read everything and triage events, but cannot create projects, mint tokens, or
regenerate the invite code. Only admins can do those.

Regenerating the invite code immediately invalidates the old one. Do that if it
leaks.

### 3. Create a project and get an API key

A **project** is one reporting source and holds one ingest API key.

In the **Projects** tab, click **New project**, name it, and copy the API key.
**It is shown once.** If you lose it, delete the project and make another.

The same thing from the CLI, for local development:

```bash
npm run create-project -w @ihd/api -- --name "my-app"
```

### 4. Report your first event

Anything that can make an HTTP request can report. There is no agent to install
and no naming scheme to follow — `integration` and `event_type` are free-form
strings that you choose.

```bash
curl -X POST https://integration-health-dashboard.fly.dev/api/ingest \
  -H "Authorization: Bearer <your-api-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "schemaVersion": 2,
    "integration": "stripe",
    "event_type": "invoice.sync",
    "status": "success",
    "metrics": { "latencyMs": 240, "itemCount": 12 },
    "environment": "production"
  }'
```

From Node, the SDK does the same thing with retries and timeouts handled:

```bash
npm install @theof/ihd-sdk
```

```js
import { IHDClient } from '@theof/ihd-sdk';

const ihd = new IHDClient({
  apiKey: process.env.IHD_API_KEY,
  endpoint: 'https://integration-health-dashboard.fly.dev',
});

await ihd.report({
  integration: 'stripe',
  eventType: 'invoice.sync',
  status: 'success',
  metrics: { latencyMs: 240 },
});

// and when it goes wrong
try {
  await syncInvoices();
} catch (err) {
  await ihd.captureError(err, { integration: 'stripe', eventType: 'invoice.sync' });
}
```

Report failures as well as successes. A dashboard that only ever sees successes
cannot tell you a success rate, and the AI triage has nothing to work with.

### 5. Read the dashboard

- **Integrations** — one card per integration, discovered from the events
  themselves. Health, success rate over the last 24 hours, and trend sparklines
  from any numeric `metrics` you send.
- **All Events** — every event, filterable by integration, status, and
  resolution state, plus search, sort, and CSV export.
- **Monitors** — saved queries rendered as time-series graphs. Filter by
  integration, type, and status, with predicates over `metrics.*`, `tags.*`,
  `payload.*`, `severity`, and `environment`.
- **Projects** — API keys, the invite code, and read tokens.

### 6. Understand what a card is telling you

**Healthy / degraded / down** comes from two independent things: how many events
failed recently, and whether the integration is still reporting at all.

That second one matters more than it sounds. An integration that has stopped
reporting may have succeeded on every event it ever sent — a success rate can
never catch it. So each integration's normal rhythm is learned from its own
history, and one that goes quiet for more than about three of its usual
intervals is marked **not reporting**, then **down** if the silence continues.
A card that says *"Not reporting — normally every 2m"* means the reporter died,
not the upstream service.

Slow reporters are judged on their own timescale: a weekly job is not late after
a day of quiet.

### 7. Triage a failure

Click any event to open it. For failures you get a **Classify** button — AI
returns a category (auth, rate limit, data validation, network, …), a severity,
a probable root cause, and a suggested fix. Then mark it **acknowledged** or
**resolved**, with notes; reopen it if it comes back.

Classification is on demand, not automatic, so it costs nothing until you ask.
Without an OpenAI key the dashboard falls back to a deterministic keyword
classifier, so the flow still works.

---

## Path 2 — Using it from an agent (MCP)

The dashboard exposes its read surface as a remote **MCP server**, so an agent
can answer questions about your integrations instead of you reading cards. It is
strictly read-only: there is no tool that can change or delete anything.

This section gets you connected. For the full reference — every tool, the OAuth
internals, and a troubleshooting table — see
[CONNECTING-MCP.md](./CONNECTING-MCP.md).

### 1. Choose how to authenticate

- **Read token** — mint a token, paste it as a header. Best for Claude Code, the
  MCP Inspector, CI, and anything unattended.
- **Browser sign-in (OAuth)** — click Connect, sign in, approve. Required for
  Claude.ai and Claude Desktop, which do not accept a pasted token.

Both reach identical tools over identical data. Only the credential differs.

### 2a. Read token

Mint one in the **Projects** tab under **Read tokens** (admins only), or from
the CLI:

```bash
npm run create-read-token -w @ihd/api -- --org <orgId> --name "my-agent"
```

The secret is shown once and only its hash is stored. A read token is
org-scoped, read-only, and revocable, and it is a different credential from
your ingest API key and your browser session — leaking one does not grant the
others.

Then add the server. In Claude Code that is one command:

```bash
claude mcp add --transport http --scope user ihd \
  https://integration-health-dashboard.fly.dev/mcp \
  --header "Authorization: Bearer ihd_read_your_token"
```

Any other header-capable host needs the same two facts:

```
URL:     https://integration-health-dashboard.fly.dev/mcp
Header:  Authorization: Bearer ihd_read_your_token
```

### 2b. Browser sign-in

In Claude.ai or Claude Desktop, go to **Settings → Connectors → Add custom
connector**, enter the server URL, and click **Connect**:

```
https://integration-health-dashboard.fly.dev/mcp
```

A browser opens. Sign in with the same account you use for the dashboard, then
approve the **Authorize connection** screen, which names the client and the
organization it will read. Nothing to mint, paste, or store.

### 3. Verify

```bash
claude mcp list
# ihd: https://integration-health-dashboard.fly.dev/mcp (HTTP) - ✔ Connected
```

Then ask a question:

> Using the **ihd** MCP, what integrations are unhealthy right now, and why?

A good agent will call `get_health` first, then drill into anything degraded
with `get_integration` and `query_events`.

### 4. What an agent can ask for

Eight tools, mapping one-to-one onto the `/api/v1` read endpoints:
`get_health`, `list_integrations`, `get_integration`, `query_events`,
`get_event`, `list_monitors`, `get_monitor`, and `get_monitor_series`.

Agents do not need to be told how to use them. `GET /api/v1` returns a
capability document — your organization, the integration ids it actually
reports, every legal filter value, and the current limits — and the server ships
a recommended workflow so an agent starts with the one cheap call that answers
*"is anything wrong?"* instead of paging everything.

### Boundaries worth knowing

- **Read-only.** Every tool is annotated as such. Reporting events is a
  separate door (`POST /api/ingest`) with a separate credential.
- **Single-org scoped.** A token resolves to exactly one organization. Another
  organization's ids come back as `not_found`.
- **Rate-limited.** Numeric arguments are clamped rather than rejected — asking
  for `limit: 9999` gets you 100, not an error.
- **Revocable.** Revoking a token returns `401` on the very next call.

---

## Configuration (self-hosting)

Only two variables matter before you deploy. Everything else has a working
default.

- **`SESSION_SECRET`** — signs the session cookie. Without it the server falls
  back to an insecure dev-only default and says so in the logs. Generate one
  with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
- **`PUBLIC_BASE_URL`** — the canonical public origin, no trailing slash. The
  agent-facing docs and the OAuth issuer hand out absolute URLs; without this
  they would echo the incoming `Host` header, so a forged one could point
  credentials somewhere else. Set it in production.

Sign-in providers — configure any subset, or none and use email and password:

- **`GITHUB_OAUTH_CLIENT_ID`** / **`GITHUB_OAUTH_CLIENT_SECRET`**
- **`GOOGLE_OAUTH_CLIENT_ID`** / **`GOOGLE_OAUTH_CLIENT_SECRET`**
- **`FACEBOOK_OAUTH_CLIENT_ID`** / **`FACEBOOK_OAUTH_CLIENT_SECRET`**

Each provider's OAuth app must register the callback URL
`<your-base-url>/api/auth/callback/<provider>` — for example
`http://localhost:3001/api/auth/callback/github` in development.

Optional:

- **`OPENAI_API_KEY`** — enables real AI classification. Without it the
  deterministic keyword classifier takes over and the triage flow still works.
- **`DB_PATH`** — SQLite file location. Defaults to `./data/ihd.db` relative to
  `packages/api`. On a container, put it on a mounted volume or you lose your
  data on deploy.
- **`PORT`** — defaults to `3000` (`3001` in the example env file).
- **`EVENT_RETENTION_DAYS`** — events older than this are dropped. Defaults to
  60.
- **`INGEST_RATE_LIMIT_PER_MIN`**, **`READ_API_RATE_LIMIT_PER_MIN`**,
  **`AUTH_RATE_LIMIT_PER_MIN`** — per-door rate limits.

### Running it locally

```bash
npm install
cp .env.example .env    # then fill in SESSION_SECRET
npm run dev             # API on :3001, web on :5173
```

---

## Where to go next

- [CONNECTING-MCP.md](./CONNECTING-MCP.md) — the full MCP reference: every tool,
  both auth paths in depth, OAuth internals, and troubleshooting.
- [README](../README.md) — what the project is, how it is built, and why.
- [ROADMAP](../ROADMAP.md) — what is shipped and what is next.
