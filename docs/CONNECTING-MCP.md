# Connecting an MCP client to IHD

The Integration Health Dashboard exposes its read surface as a remote
**streamable-HTTP MCP server** at `POST /mcp`. Any MCP-capable agent (Claude
Code, the MCP Inspector, and other header-capable hosts) can call the dashboard's
data as tools — "which integrations are degraded, and why?" — instead of
constructing HTTP requests by hand.

There are two ways to connect. **Both work today.**

| Path | Auth | Status | Best for |
| --- | --- | --- | --- |
| **A — Read token** | paste an `ihd_read_*` bearer token | ✅ **Available now** | Claude Code, MCP Inspector, any host that lets you set a request header |
| **B — Browser sign-in (OAuth)** | click "Connect", sign in in a browser | ✅ **Available now** | Claude.ai / Claude Desktop / ChatGPT one-click connectors |

Both paths hit the exact same tools over the exact same org-scoped data — only
*how you authenticate* differs. The auth check lives behind one swappable
boundary (`packages/api/src/mcp/auth.ts`), which now **accepts either
credential** — so adding OAuth did not break any existing read-token setup, and
no tool or transport wiring changed.

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

### When to use Path A vs Path B

Claude.ai / Claude Desktop custom connectors **don't accept a user-pasted bearer
token** — they require OAuth, so use **Path B** there. Path A remains the fastest
route for Claude Code, the Inspector, and other header-capable hosts, and for
unattended/CI agents where no human is present to click through a browser.

---

## Path B — Browser sign-in / OAuth (available now)

The same "add a connector" flow you see for major MCP integrations: click **Add
connector**, a browser window opens, you **sign in** and approve — **no token to
mint or paste.**

### Steps

1. In Claude.ai or Claude Desktop, go to **Settings → Connectors → Add custom
   connector**.
2. Enter the server URL:

   ```
   https://integration-health-dashboard.fly.dev/mcp
   ```

3. Click **Connect**. A browser window opens.
4. **Sign in** — Google, GitHub, Facebook, or email + password. (If you're already
   signed in to the dashboard, this step is skipped.)
5. You'll see an **Authorize connection** screen naming the client and the
   organization it will read. Click **Allow**.
6. You're connected. The connector's tools appear in the client.

That's it — no configuration file, no header, no secret to store.

### What's happening under the hood

- IHD runs an **OAuth 2.1 authorization server** on the MCP TypeScript SDK's
  provider scaffold, with **PKCE (S256, mandatory)** and **dynamic client
  registration** (RFC 7591), plus the discovery metadata MCP hosts look for:
  `/.well-known/oauth-authorization-server` and
  `/.well-known/oauth-protected-resource/mcp`. A `401` from `/mcp` carries a
  `WWW-Authenticate: Bearer resource_metadata="…"` pointer (RFC 9728), which is
  how a connector bootstraps the flow from nothing but the URL.
- Clients are registered **public, with no client secret** — PKCE is what
  authenticates the exchange. (The SDK compares client secrets in plaintext, so
  not issuing one means there's no usable credential sitting in the database.)
- Sign-in **reuses the same session and identity providers** as the dashboard
  (Google / GitHub / Facebook / email + password), so an OAuth grant is tied to a
  real account and its org.
- The MCP server acts as an **OAuth resource server**: the access token is
  validated and **audience-checked (RFC 8707)** at the same `mcp/auth.ts`
  boundary that validates a read token, so a token minted for a different
  resource can't be replayed here.

### Security notes

- **Read-only.** The consent screen says so, and it's true at the tool level —
  every MCP tool wraps a read path.
- **Authorization codes are single-use** and expire in 60 seconds.
- **Refresh tokens rotate.** Using an old one after a refresh fails, which is what
  surfaces a stolen token instead of granting silent parallel access.
- **Access tokens expire in 1 hour**; the client refreshes automatically.

---

## Troubleshooting

| Response | Meaning | Fix |
| --- | --- | --- |
| `401 unauthorized` | No token sent | Add the `Authorization: Bearer ...` header (Path A), or connect via OAuth (Path B). |
| `401 invalid_token` | Token is wrong, revoked, or expired | Mint a fresh read token, or reconnect the OAuth connector. |
| `401` mentioning *different resource* | An OAuth token minted for another server was replayed here (RFC 8707) | Reconnect the connector against this server's URL. |
| `400 invalid_grant` on connect | Code expired (60s), was already used, or PKCE failed | Start the connection again from your client. |
| `403 forbidden` | Disallowed `Origin` (DNS-rebinding guard) | Use the real host; browser clients must originate from an allowed origin. |
| `405 method_not_allowed` | Non-POST to `/mcp` | MCP uses `POST`; check your host's transport is "Streamable HTTP". |
| `429 rate_limited` | Over the per-token/IP budget | Back off; the `RateLimit-*` headers say when to retry. |
