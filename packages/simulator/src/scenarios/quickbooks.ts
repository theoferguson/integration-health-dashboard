import type { SimulationScenario } from '../types.js';

export const quickbooksScenarios: SimulationScenario[] = [
  {
    name: 'QuickBooks - Invoice Created',
    description: 'Invoice successfully exported to QuickBooks',
    integration: 'quickbooks',
    endpoint: '/api/webhooks/quickbooks',
    isError: false,
    payload: {
      event_type: 'invoice.created',
      entity: {
        type: 'invoice',
        id: 'INV-2024-042',
      },
      job: {
        id: 'JOB-4821',
        name: 'Downtown Office Tower',
      },
      data: {
        customer: 'Acme Development Corp',
        amount: 48750.00,
        due_date: '2024-02-15',
        line_items: [
          { description: 'Electrical rough-in - Phase 1', amount: 32000 },
          { description: 'Materials', amount: 16750 },
        ],
      },
    },
  },
  {
    name: 'QuickBooks - Job Cost Sync',
    description: 'Job costs synced to QuickBooks GL',
    integration: 'quickbooks',
    endpoint: '/api/webhooks/quickbooks',
    isError: false,
    payload: {
      event_type: 'job_cost.sync',
      entity: {
        type: 'journal_entry',
        id: 'JE-2024-0891',
      },
      job: {
        id: 'JOB-4821',
      },
      data: {
        period: '2024-01',
        total_labor: 87432.50,
        total_materials: 34521.00,
        total_subcontractor: 25000.00,
      },
    },
  },
  {
    name: 'QuickBooks - Payment Received',
    description: 'Customer payment recorded',
    integration: 'quickbooks',
    endpoint: '/api/webhooks/quickbooks',
    isError: false,
    payload: {
      event_type: 'payment.received',
      entity: {
        type: 'payment',
        id: 'PMT-2024-0234',
      },
      data: {
        customer: 'Acme Development Corp',
        amount: 48750.00,
        invoice_id: 'INV-2024-042',
        payment_method: 'ACH',
      },
    },
  },
  {
    name: 'QuickBooks - Stale Sync Token',
    description: 'Sync token expired, full resync needed',
    integration: 'quickbooks',
    endpoint: '/api/webhooks/quickbooks',
    isError: true,
    payload: {
      event_type: 'sync.delta',
      entity: {
        type: 'sync',
      },
      error_simulation: 'stale_sync_token',
    },
  },
  {
    name: 'QuickBooks - GL Account Mismatch',
    description: 'Account mapping failed between Miter and QBO',
    integration: 'quickbooks',
    endpoint: '/api/webhooks/quickbooks',
    isError: true,
    payload: {
      event_type: 'job_cost.sync',
      entity: {
        type: 'journal_entry',
      },
      job: {
        id: 'JOB-4821',
      },
      error_simulation: 'gl_account_mismatch',
    },
  },
  {
    name: 'QuickBooks - Duplicate Invoice',
    description: 'Invoice already exists in QuickBooks',
    integration: 'quickbooks',
    endpoint: '/api/webhooks/quickbooks',
    isError: true,
    payload: {
      event_type: 'invoice.created',
      entity: {
        type: 'invoice',
        id: 'INV-2024-001',
      },
      error_simulation: 'duplicate_invoice',
    },
  },
  {
    name: 'QuickBooks - OAuth Refresh Failed',
    description: 'Token refresh failed, re-authorization required',
    integration: 'quickbooks',
    endpoint: '/api/webhooks/quickbooks',
    isError: true,
    payload: {
      event_type: 'auth.refresh',
      entity: {
        type: 'auth',
      },
      error_simulation: 'auth_refresh_failed',
    },
  },
];
