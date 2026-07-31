# Connecting an MCP client to IHD

The Integration Health Dashboard exposes its read surface as a remote
**streamable-HTTP MCP server** at `POST /mcp`. Any MCP-capable agent (Claude
Code, the MCP Inspector, and other header-capable hosts) can call the dashboard's
data as tools — "which integrations are degraded, and why?" — instead of
constructing HTTP requests by hand.

There are two ways to connect. **One works today; one is planned.**

| Path | Auth | Status | Best for |
| --- | --- | --- | --- |
| **A — Read token** | paste an `ihd_read_*` bearer token | ✅ **Available now** | Claude Code, MCP Inspector, any host that lets you set a request header |
| **B — Browser sign-in (OAuth)** | click "Connect", sign in in a browser | 🚧 **Planned (Phase 4)** | Claude.ai / Claude Desktop / ChatGPT one-click connectors |

Both paths hit the exact same tools over the exact same org-scoped data — only
*how you authenticate* differs. The auth check lives behind one swappable
boundary (`packages/api/src/mcp/auth.ts`), so when Path B ships, none of the
tools or transport wiring changes.

---

## Path A — Read token (available now)

Three steps: get a token, add the server, verify. It takes about a minute.

### 1. Get a read token

A **read token** is org-scoped, read-only, revocable, and distinct from your
ingest key and browser session (leaking one doesn't grant the others). Only its
hash is stored — the secret is shown once, so copy it.

**Local dev:**

```bash
npm run create-read-token -w @ihd/api -- --org <orgId> --name "my-agent"
# run it without --org to list your org ids first
```

**Against production (Fly):**

```bash
fly ssh console -a integration-health-dashboard -C \
  "node /app/packages/api/dist/scripts/createReadToken.js --org <orgId> --name my-agent"
```

Admins can also mint one over the API: `POST /api/read-tokens` (see the app's
Read Tokens admin surface).

### 2. Add the server to your MCP host

**Claude Code** (one command — `--scope user` makes it available in every
project):

```bash
claude mcp add --transport http --scope user ihd \
  https://integration-health-dashboard.fly.dev/mcp \
  --header "Authorization: Bearer ihd_read_your_token"
```

**Any other header-capable host** — point it at the URL and set one header:

```
URL:     https://integration-health-dashboard.fly.dev/mcp
Header:  Authorization: Bearer ihd_read_your_token
```

**MCP Inspector** (for interactive testing):

```bash
npx @modelcontextprotocol/inspector
# Transport: Streamable HTTP
# URL:       https://integration-health-dashboard.fly.dev/mcp
# Header:    Authorization: Bearer ihd_read_your_token
```

### 3. Verify

```bash
claude mcp list
# ihd: https://integration-health-dashboard.fly.dev/mcp (HTTP) - ✔ Connected
```

Then just ask, in natural language:

> "Using the **ihd** MCP, what integrations are unhealthy right now, and why?"

Claude will call `get_health`, then drill into anything degraded with
`get_integration` / `query_events`.

### What you can ask

The tools map one-to-one to the `/api/v1` read endpoints:

| Tool | Does |
| --- | --- |
| `get_health` | Whole-org rollup (healthy / degraded / down) + every integration's health. **Start here.** |
| `list_integrations` | Every integration with its health status. |
| `get_integration` | One integration's health + its 20 most recent events (`id`). |
| `query_events` | Paginated, filterable events (`integration`, `status`, `resolution_status`, `since`, `search`, `sort_by`, `sort_order`, `limit`, `offset`). |
| `get_event` | A single event by `id`. |
| `list_monitors` | The org's saved monitors + last-24h activity. |
| `get_monitor` | A monitor's config + the events its match spec currently selects (`id`, paginated). |
| `get_monitor_series` | A monitor's matching-event time series (`id`, `window`, `bucket`). |

Example intents that work well:
- *"Are any of my integrations down? Summarize the root cause for each."*
- *"Show the last 20 failures for `stripe` and group them by error category."*
- *"What does the `nyc-civic-finance` monitor currently match?"*

### Good to know (boundaries)

- **Read-only.** Every tool is annotated `readOnlyHint`; there is no write/delete
  path here (reporting events is a separate door — `POST /api/ingest`).
- **Single-org scoped.** Your token resolves to exactly one organization; every
  result is filtered to it, and another org's ids return `not_found`.
- **Rate-limited.** The MCP door shares the `/api/v1` budget (per-token, with a
  coarser per-IP ceiling). Numeric args like `limit` are **coerced and clamped**,
  not rejected — send `"9999"` and you get `100`, not an error.
- **Revoke anytime.** Revoking the token (admin API / store) immediately returns
  `401` on the next call.

### Why not the Claude.ai one-click connector (yet)?

Claude.ai / Claude Desktop custom connectors **don't accept a user-pasted bearer
token** — they require an OAuth flow. So Path A targets Claude Code, the
Inspector, and other header-capable hosts today. The one-click experience is
Path B.

---

## Path B — Browser sign-in / OAuth (🚧 planned, Phase 4)

> **Not available yet.** This section describes the planned experience so you know
> where it's headed; there are no steps to follow today. Use Path A for now.

The goal is the same "add a connector" flow you see for major MCP integrations
(Notion, Atlassian, etc.): in Claude.ai / Claude Desktop / ChatGPT you'll click
**Add connector → IHD**, a browser window opens, you **sign in** (Google,
Facebook, GitHub, or email), approve access, and you're connected — **no token to
mint or paste.**

What it will involve under the hood (for the curious):

- IHD runs an **OAuth 2.1 authorization server** (built on the MCP TypeScript
  SDK's provider scaffold) with PKCE and dynamic client registration / CIMD, plus
  the discovery metadata (`/.well-known/oauth-protected-resource`,
  `/.well-known/oauth-authorization-server`) MCP hosts look for.
- Sign-in **federates to the identity providers** added in Phases 2–3 (Google /
  Facebook / GitHub / email + magic link).
- The MCP server becomes an **OAuth resource server**: it validates the
  access token (audience-checked) at the same `mcp/auth.ts` boundary that today
  validates a read token. **The tools and transport don't change** — only how a
  caller is authenticated.

Tracking: see ROADMAP #11 (Door 2). When Path B ships, this section becomes a
real step-by-step and the table at the top flips to ✅.

---

## Troubleshooting

| Response | Meaning | Fix |
| --- | --- | --- |
| `401 unauthorized` | No token sent | Add the `Authorization: Bearer ...` header. |
| `401 invalid_token` | Token is wrong or revoked | Mint a fresh token; update your host config. |
| `403 forbidden` | Disallowed `Origin` (DNS-rebinding guard) | Use the real host; browser clients must originate from an allowed origin. |
| `405 method_not_allowed` | Non-POST to `/mcp` | MCP uses `POST`; check your host's transport is "Streamable HTTP". |
| `429 rate_limited` | Over the per-token/IP budget | Back off; the `RateLimit-*` headers say when to retry. |
