import OpenAI from 'openai';
import type { IntegrationEvent, ErrorClassification } from '../types/index.js';

// Only initialize OpenAI client if API key is present
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const SYSTEM_PROMPT = `You are an integration support engineer for a construction contractor software platform (similar to Miter).

Your job is to analyze integration failures and provide actionable insights. The platform integrates with:
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

  // Spending control (Stripe specific) - check first as "declined" is common
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
        'Card transaction was declined due to spending controls or insufficient funds.',
      suggestedFix:
        'Review the cardholder limits in Stripe. If legitimate, temporarily increase the limit or use an alternative payment method.',
      affectedData: ['card_transaction'],
      businessImpact:
        'Field worker may be unable to purchase materials, potentially delaying job progress.',
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
      cause: `Authentication failed for ${event.integration}. The access token may have expired or been revoked.`,
      suggestedFix:
        'Re-authenticate the integration by going to Settings > Integrations and clicking "Reconnect" for this service.',
      affectedData: ['all sync operations'],
      businessImpact:
        'No data will sync until the connection is restored, potentially affecting payroll and job costing.',
    };
  }

  // Compliance errors (certified payroll specific) - check before rate_limit due to "wage rate"
  if (
    errorMessage.includes('prevailing wage') ||
    errorMessage.includes('wage rate') ||
    errorMessage.includes('apprentice') ||
    errorMessage.includes('fringe') ||
    errorMessage.includes('wh-347') ||
    errorMessage.includes('lcptracker') ||
    errorMessage.includes('certified payroll')
  ) {
    return {
      category: 'compliance',
      severity: 'critical',
      cause: `Certified payroll compliance check failed. Required wage or worker data is missing or incorrect.`,
      suggestedFix:
        'Review the affected worker classifications and wage rates. Ensure all required fields (apprentice info, prevailing wage rates, fringe benefits) are configured before the submission deadline.',
      affectedData: ['certified_payroll_report', 'worker_classifications'],
      businessImpact:
        'Compliance reports cannot be submitted until resolved, risking regulatory penalties and payment delays.',
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
