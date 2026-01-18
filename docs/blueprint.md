# Blueprint: Integration Health Dashboard

*A Miter-style design document for an AI-native integration monitoring system*

## Overview

### Problem Statement

Construction contractors using modern software platforms rely on multiple third-party integrations: project management (Procore), payroll (Gusto), accounting (QuickBooks), payments (Stripe), and compliance systems (LCPtracker). When these integrations fail, the impact is immediate:

- **Payroll delays** — Workers don't get paid on time
- **Job costing gaps** — Project profitability becomes invisible
- **Field purchase blocks** — Workers can't buy materials
- **Compliance risk** — Certified payroll reports miss deadlines

Today, engineers manually triage these failures by reading logs, identifying patterns, and looking up documentation. This is slow, error-prone, and doesn't scale.

### Proposed Solution

An integration health dashboard that:

1. Centralizes webhook events from all integrated systems
2. Automatically detects and categorizes failures
3. Uses AI to explain errors in plain English and suggest fixes
4. Provides real-time visibility to engineering and operations teams

### Non-Goals

- Real OAuth/authentication with external systems (simulated for demo)
- Persistent storage (in-memory for demo)
- Alerting/notification system
- Multi-tenant support

## Technical Approach

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    React Dashboard                          │
│                                                             │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌────────────┐  │
│  │  Health   │ │Integration│ │   Event   │ │   Error    │  │
│  │  Overview │ │   Cards   │ │   Stream  │ │   Triage   │  │
│  └───────────┘ └───────────┘ └───────────┘ └────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Express API                              │
│                                                             │
│  ┌────────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │   /webhooks/*  │  │   /events    │  │ /integrations  │  │
│  │   (receivers)  │  │  (log/query) │  │    (health)    │  │
│  └────────────────┘  └──────────────┘  └────────────────┘  │
│                              │                              │
│                    ┌─────────▼─────────┐                   │
│                    │   AI Classifier   │                   │
│                    │  (OpenAI GPT-4o)  │                   │
│                    └───────────────────┘                   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 In-Memory Event Store                       │
└─────────────────────────────────────────────────────────────┘
```

### Data Model

#### Integration Event

```typescript
interface IntegrationEvent {
  id: string;                    // UUID
  integration: IntegrationType;  // 'procore' | 'gusto' | etc.
  eventType: string;             // 'employee.sync' | 'invoice.created'
  status: 'success' | 'failure';
  timestamp: Date;
  payload: Record<string, unknown>;
  error?: {
    message: string;
    code?: string;
    context?: Record<string, unknown>;
  };
  classification?: ErrorClassification;
}
```

#### Error Classification

```typescript
interface ErrorClassification {
  category: 'auth' | 'rate_limit' | 'data_validation' |
            'data_state_mismatch' | 'spending_control' |
            'compliance' | 'unknown';
  severity: 'low' | 'medium' | 'high' | 'critical';
  cause: string;           // Plain English explanation
  suggestedFix: string;    // Actionable steps
  affectedData?: string[]; // What data is impacted
  businessImpact?: string; // How this affects operations
}
```

### AI Classifier Design

#### Why AI for Classification?

Integration errors follow patterns, but the context around them varies significantly. A static rule engine would require maintaining hundreds of specific cases. An LLM can:

1. Generalize across error types within categories
2. Understand construction domain context
3. Generate human-readable explanations
4. Suggest domain-appropriate fixes

#### Why Not AI Everywhere?

- **Detection** should be deterministic. Failures are detected by HTTP status codes, validation rules, and explicit error responses.
- **Health calculation** should be arithmetic. Success rate = successes / total events.
- **Action decisions** should be human. AI suggests, humans decide.

#### Prompt Design

The classifier uses a system prompt with embedded domain knowledge:

```
You are an integration support engineer for a construction contractor
software platform (similar to Miter).

Your job is to analyze integration failures and provide actionable insights.
The platform integrates with:
- Procore (project management - jobs, cost codes, daily logs)
- Gusto (payroll - employee data, timecards, payroll runs)
- QuickBooks (accounting - job costs, invoices, GL entries)
- Stripe Issuing (payments - virtual cards for field purchases)
- Certified Payroll systems (compliance - LCPtracker, WH-347, prevailing wage)

When analyzing errors, consider:
1. Common failure patterns for each integration
2. Impact on construction workflows (job costing, payroll, field operations)
3. Urgency based on payroll deadlines, job schedules, or compliance requirements
4. Specific, actionable fixes that a support engineer or contractor admin can take
```

This prompt is:
- **Explicit** — Lists all integrations and their purposes
- **Domain-aware** — References construction-specific concerns
- **Actionable** — Instructs the model to suggest specific fixes

#### Failure Modes and Guardrails

1. **API unavailable** — Falls back to deterministic mock classification based on error keywords
2. **Slow response** — 5-second timeout, cached results prevent repeated calls
3. **Hallucination risk** — Classification is advisory only; engineers validate before acting
4. **Cost control** — Uses gpt-4o-mini (cheap, fast) instead of full GPT-4

### Health Score Calculation

Integration health is calculated from the last 24 hours of events:

```typescript
function calculateStatus(successRate: number, errorsLast24h: number): Status {
  if (successRate >= 98 && errorsLast24h < 5) return 'healthy';
  if (successRate >= 90 || errorsLast24h < 20) return 'degraded';
  return 'down';
}
```

This is intentionally simple. Production would consider:
- Time-weighted recent failures
- Integration-specific SLAs
- Business hours vs off-hours

## Trade-offs

### In-Memory vs Persistent Storage

**Decision**: In-memory for this demo.

**Reasoning**:
- Demonstrates the concept without database complexity
- Real implementation would use MongoDB for flexible schema
- Time-series queries would benefit from proper indexing

**If I had more time**: Add MongoDB with TTL indexes for automatic event expiration.

### Real vs Simulated Integrations

**Decision**: Simulated webhooks with realistic payloads and error scenarios.

**Reasoning**:
- Real OAuth requires account setup, secrets management
- Demo should be self-contained and runnable anywhere
- Simulation covers the interesting failure modes

**If I had more time**: Add one real integration (Stripe Issuing has a good sandbox).

### Monorepo vs Separate Repos

**Decision**: npm workspaces monorepo.

**Reasoning**:
- Shared types between packages
- Single PR for full-stack changes
- Simpler CI/CD

**Trade-off**: Package boundaries are softer, easier to create coupling.

## Security Considerations

### Data Privacy

- In production, PII (SSNs, employee names) should be encrypted at rest
- Error context should redact sensitive fields before storing
- AI classifier should never receive raw PII

### Webhook Authentication

- Real implementation would verify webhook signatures (e.g., Stripe-Signature header)
- Endpoints should validate source IP ranges where possible

### API Authentication

- Not implemented in this demo
- Production would use session-based auth or API keys

## Testing Strategy

### What's Tested

- Unit tests for health calculator logic
- Integration tests for webhook receivers
- E2E tests for error classification flow

### What's Not Tested (Demo Constraints)

- Frontend components (would use React Testing Library)
- AI classifier output quality (would need golden dataset)
- Load testing

## Migration Path to Production

1. **Add MongoDB** — Replace in-memory store with persistent events
2. **Add Authentication** — Integrate with existing auth system
3. **Real Webhooks** — Start with Stripe Issuing (best sandbox experience)
4. **Alerting** — PagerDuty/Slack integration for critical errors
5. **Team Routing** — Assign errors to responsible engineers

## Success Metrics

In production, we'd measure:

- **MTTD (Mean Time to Detect)** — How quickly failures appear in dashboard
- **MTTR (Mean Time to Resolve)** — From detection to resolution
- **AI Accuracy** — % of classifications marked "helpful" by engineers
- **Integration Uptime** — % time each integration is healthy

---

*This document follows the "build the blueprint" principle: write things down to clarify thinking and align teams.*
