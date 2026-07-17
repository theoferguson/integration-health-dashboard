import OpenAI from 'openai';
import type { IntegrationEvent, ErrorClassification } from '../types/index.js';

// Only initialize OpenAI client if API key is present
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const SYSTEM_PROMPT = `You are an on-call engineer triaging integration failures for a monitoring platform. Projects report events for arbitrary third-party integrations - public APIs, webhooks, scheduled data syncs - and you help explain what went wrong and what to do about it.

You won't always recognize the specific integration being reported. Reason from the error message, error code, event type, and payload/context provided rather than assuming what the integration is used for.

When analyzing errors, consider:
1. Common failure patterns across integrations: expired or invalid credentials, rate limiting, malformed or unexpected response data, stale or missing referenced records, network/timeout issues, and quota or policy limits enforced by the external system
2. Urgency: is this a one-off blip likely to self-resolve, or does it indicate the integration is down and data has stopped flowing?
3. Specific, actionable fixes an engineer can take right now

Always respond in JSON format with these fields:
- category: one of "auth", "rate_limit", "data_validation", "data_state_mismatch", "network", "spending_control", "compliance", "unknown"
- severity: one of "low", "medium", "high", "critical"
- cause: plain English explanation of what went wrong (2-3 sentences max)
- suggestedFix: specific, actionable steps to resolve (2-4 steps)
- affectedData: array of data types that may be affected
- businessImpact: how this affects the contractor's operations (1 sentence)`;

function buildUserPrompt(event: IntegrationEvent): string {
  return `Analyze this integration failure:

Integration: ${event.integration}
Event Type: ${event.eventType}
Error Message: ${event.error?.message || 'Unknown error'}
Error Code: ${event.error?.code || 'N/A'}
Context: ${JSON.stringify(event.error?.context || {}, null, 2)}
Payload: ${JSON.stringify(event.payload, null, 2)}

Provide your analysis in JSON format.`;
}

export async function classifyError(
  event: IntegrationEvent
): Promise<ErrorClassification> {
  // If no error or already classified, skip
  if (!event.error || event.status !== 'failure') {
    throw new Error('Event has no error to classify');
  }

  // Check if API key is configured and client is available
  if (!openai) {
    // Return a mock classification for demo purposes
    return getMockClassification(event);
  }

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(event) },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 500,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from OpenAI');
    }

    const classification = JSON.parse(content) as ErrorClassification;
    return classification;
  } catch (error) {
    console.error('Error classifying with OpenAI:', error);
    // Fallback to mock classification
    return getMockClassification(event);
  }
}

// Mock classifications for demo when no API key is set
function getMockClassification(event: IntegrationEvent): ErrorClassification {
  const errorMessage = event.error?.message?.toLowerCase() || '';
  const errorCode = event.error?.code?.toLowerCase() || '';

  // Spending/quota controls - check first as "declined" is a common generic phrase
  if (
    errorMessage.includes('spending') ||
    errorMessage.includes('spending_limit') ||
    errorMessage.includes('declined') ||
    errorCode === 'card_declined'
  ) {
    return {
      category: 'spending_control',
      severity: 'high',
      cause:
        'A spend or quota limit enforced by the external system blocked this action.',
      suggestedFix:
        'Review the configured limit for this integration. If legitimate, raise the limit or use an alternative path for this action.',
      affectedData: ['transaction'],
      businessImpact:
        'The attempted action did not complete and may need manual review.',
    };
  }

  // Auth errors
  if (
    errorMessage.includes('oauth') ||
    errorMessage.includes('token expired') ||
    errorMessage.includes('unauthorized') ||
    errorMessage.includes('re-auth') ||
    errorCode === '401'
  ) {
    return {
      category: 'auth',
      severity: 'high',
      cause: `Authentication failed for ${event.integration}. The credentials or access token may have expired or been revoked.`,
      suggestedFix:
        'Re-authenticate or rotate the credentials for this integration, then retry.',
      affectedData: ['all sync operations'],
      businessImpact:
        'No data will sync from this integration until the connection is restored.',
    };
  }

  // Rate limit errors
  if (
    errorMessage.includes('rate limit') ||
    errorMessage.includes('too many requests') ||
    errorMessage.includes('429') ||
    errorCode === '429'
  ) {
    return {
      category: 'rate_limit',
      severity: 'low',
      cause: `${event.integration} rate limit exceeded. Too many requests were made in a short period.`,
      suggestedFix:
        'This will auto-resolve. If frequent, consider spacing out bulk operations or requesting a higher rate limit from the provider.',
      affectedData: ['pending sync items'],
      businessImpact:
        'Temporary delay in data sync. Will automatically retry.',
    };
  }

  // Data validation errors
  if (
    errorMessage.includes('validation') ||
    errorMessage.includes('required') ||
    errorMessage.includes('invalid') ||
    errorMessage.includes('null')
  ) {
    return {
      category: 'data_validation',
      severity: 'medium',
      cause: `Data validation failed. The ${event.integration} payload contains missing or invalid fields.`,
      suggestedFix:
        'Review the failed record for missing required fields. Check if recent changes in the source system affected the data format.',
      affectedData: [event.eventType],
      businessImpact:
        'Affected records will not sync until the data issues are resolved.',
    };
  }

  // Data state mismatch (archived, deleted, not found)
  if (
    errorMessage.includes('archived') ||
    errorMessage.includes('not found') ||
    errorMessage.includes('entity not found') ||
    errorMessage.includes('mapping failed') ||
    errorCode === '404'
  ) {
    return {
      category: 'data_state_mismatch',
      severity: 'medium',
      cause: `The referenced entity in ${event.integration} has been archived, deleted, or cannot be found. This often happens when data is modified in the external system without updating the integration.`,
      suggestedFix:
        'Review the affected record in both systems. Either restore the entity in the source system or update the mapping in your application.',
      affectedData: [event.eventType],
      businessImpact:
        'Related data will not sync until the entity reference is corrected.',
    };
  }

  // Default unknown classification
  return {
    category: 'unknown',
    severity: 'medium',
    cause: `An unexpected error occurred with ${event.integration}: ${event.error?.message}`,
    suggestedFix:
      'Review the error details and contact support if the issue persists. Check the integration logs for more context.',
    affectedData: [event.eventType],
    businessImpact: 'Some data may not sync correctly until the issue is resolved.',
  };
}
