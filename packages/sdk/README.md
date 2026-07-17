# @theof/ihd-sdk

Client SDK for reporting integration events to [Integration Health Dashboard](https://github.com/theoferguson/integration-health-dashboard).

## Install

```bash
npm install @theof/ihd-sdk
```

## Usage

```ts
import { IHDClient } from '@theof/ihd-sdk'

const monitor = new IHDClient({
  apiKey: process.env.IHD_API_KEY!,      // from `npm run create-project` in the IHD repo
  endpoint: 'https://integration-health-dashboard.fly.dev',
})

// Report a successful sync
await monitor.report({
  integration: 'weather',
  eventType: 'forecast.sync',
  status: 'success',
  payload: { zone: 'NYZ072' },
})

// Report a caught error
try {
  await fetchForecast()
} catch (err) {
  await monitor.captureError(err, {
    integration: 'weather',
    eventType: 'forecast.sync',
    context: { zone: 'NYZ072' },
  })
}

// Express: auto-capture unhandled route errors
app.use(monitor.expressMiddleware('my-app'))
```

## Notes

- `report()` and `captureError()` never throw. They resolve to `{ ok: false }`
  after exhausting retries, so a flaky or briefly-down IHD deployment never
  breaks the calling process.
- Retries transient failures (network errors, 5xx) up to 3 times with
  exponential backoff; 4xx responses (bad request, bad API key) fail fast.
- In a short-lived process (e.g. a scheduled job that exits after one run),
  `await` the call so the send completes before the process exits.
- Requires Node 18+ (uses the global `fetch`). Zero runtime dependencies.
