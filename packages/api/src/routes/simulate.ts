import { Router } from 'express';
import { createEvent, clearEvents } from '../services/eventStore.js';
import type { IntegrationType, CreateEventInput } from '../types/index.js';

const router = Router();

// Demo simulation scenarios
const demoScenarios: CreateEventInput[] = [
  // Successful events
  {
    integration: 'procore',
    eventType: 'project.sync',
    status: 'success',
    payload: { project_id: 12847, name: 'Downtown Office Tower - Phase 2' },
  },
  {
    integration: 'procore',
    eventType: 'cost_code.updated',
    status: 'success',
    payload: { code: '03-100', name: 'Concrete - Formwork' },
  },
  {
    integration: 'gusto',
    eventType: 'employee.sync',
    status: 'success',
    payload: { employee_id: 'emp_9921', name: 'Mike Torres' },
  },
  {
    integration: 'gusto',
    eventType: 'timecard.submitted',
    status: 'success',
    payload: { employee: 'Mike Torres', hours: 84, job_id: 'JOB-4821' },
  },
  {
    integration: 'gusto',
    eventType: 'payroll.completed',
    status: 'success',
    payload: { employees_paid: 47, total_gross: 187432.5 },
  },
  {
    integration: 'quickbooks',
    eventType: 'invoice.created',
    status: 'success',
    payload: { invoice_id: 'INV-2024-042', amount: 48750.0 },
  },
  {
    integration: 'quickbooks',
    eventType: 'job_cost.sync',
    status: 'success',
    payload: { job_id: 'JOB-4821', total_labor: 87432.5 },
  },
  {
    integration: 'stripe_issuing',
    eventType: 'issuing_authorization.created',
    status: 'success',
    payload: { cardholder: 'Mike Torres', merchant: 'Home Depot #4521', amount: 342.87 },
  },
  {
    integration: 'stripe_issuing',
    eventType: 'issuing_transaction.created',
    status: 'success',
    payload: { cardholder: 'Sarah Chen', merchant: 'Lowes #2234', amount: 156.0 },
  },
  {
    integration: 'certified_payroll',
    eventType: 'report.generated',
    status: 'success',
    payload: { report_type: 'WH-347', workers_included: 24 },
  },
  {
    integration: 'certified_payroll',
    eventType: 'export.completed',
    status: 'success',
    payload: { report_type: 'LCPtracker', records_exported: 47 },
  },
  // Error events for triage
  {
    integration: 'procore',
    eventType: 'project.sync',
    status: 'failure',
    payload: { project_id: 12847 },
    error: {
      message: 'Entity not found: Project #12847 has been archived in Procore',
      code: '404',
      context: {
        job_id: 'JOB-4821',
        procore_project_id: 12847,
        last_successful_sync: new Date(Date.now() - 86400000).toISOString(),
      },
    },
  },
  {
    integration: 'gusto',
    eventType: 'employee.sync',
    status: 'failure',
    payload: { employee_id: null },
    error: {
      message: 'Validation failed: employee_id is required but was null',
      code: '400',
      context: { missing_fields: ['employee_id'] },
    },
  },
  {
    integration: 'quickbooks',
    eventType: 'job_cost.sync',
    status: 'failure',
    payload: { job_id: 'JOB-4821' },
    error: {
      message: 'GL Account mapping failed: Account "6200 - Materials" not found in QuickBooks',
      code: 'ENTITY_NOT_FOUND',
      context: {
        miter_account: '6200',
        miter_account_name: 'Materials',
        suggested_qb_accounts: ['6000 - Cost of Goods Sold', '6100 - Supplies'],
      },
    },
  },
  {
    integration: 'stripe_issuing',
    eventType: 'issuing_authorization.request',
    status: 'failure',
    payload: { cardholder: 'Mike Torres', amount: 847.32 },
    error: {
      message: 'Authorization declined: spending_limit_exceeded',
      code: 'card_declined',
      context: {
        card_id: 'ic_1NqJ...',
        cardholder: 'Mike Torres',
        merchant: 'Home Depot #4521',
        amount: 847.32,
        job_id: 'JOB-4821',
        current_limit: 500,
      },
    },
  },
  {
    integration: 'certified_payroll',
    eventType: 'report.generation_failed',
    status: 'failure',
    payload: { report_type: 'WH-347' },
    error: {
      message: 'Prevailing wage rate not configured for classification: Electrician - Journeyman',
      code: 'MISSING_WAGE_RATE',
      context: {
        classification: 'Electrician - Journeyman',
        job_id: 'JOB-4821',
        county: 'Los Angeles',
        affected_employees: ['Mike Torres', 'Sarah Chen', 'James Wilson'],
        deadline: new Date(Date.now() + 172800000).toISOString(),
      },
    },
  },
];

router.post('/', (req, res) => {
  const mode = req.query.mode || 'demo';
  const reset = req.query.reset === 'true';

  if (reset) {
    clearEvents();
  }

  // Add some randomized successful events first
  const successEvents = demoScenarios.filter((s) => s.status === 'success');
  const errorEvents = demoScenarios.filter((s) => s.status === 'failure');

  // Seed 15-20 successful events
  const successCount = 15 + Math.floor(Math.random() * 6);
  for (let i = 0; i < successCount; i++) {
    const scenario = successEvents[Math.floor(Math.random() * successEvents.length)];
    createEvent({ ...scenario });
  }

  // Add 3-5 error events
  const errorCount = mode === 'demo' ? 3 + Math.floor(Math.random() * 3) : errorEvents.length;
  const selectedErrors = errorEvents
    .sort(() => Math.random() - 0.5)
    .slice(0, errorCount);

  for (const scenario of selectedErrors) {
    createEvent({ ...scenario });
  }

  res.json({
    success: true,
    message: `Seeded ${successCount} successful events and ${errorCount} error events`,
    successCount,
    errorCount,
  });
});

export default router;
