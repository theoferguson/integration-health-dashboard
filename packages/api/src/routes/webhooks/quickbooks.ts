import { Router } from 'express';
import { createEvent } from '../../services/eventStore.js';
import type { CreateEventInput } from '../../types/index.js';

const router = Router();

// QuickBooks webhook receiver
// Handles: job cost exports, invoice creation, GL entries
router.post('/', (req, res) => {
  const { event_type, entity, job, error_simulation } = req.body;

  const input: CreateEventInput = {
    integration: 'quickbooks',
    eventType: event_type || 'unknown',
    status: error_simulation ? 'failure' : 'success',
    payload: {
      entity_type: entity?.type,
      entity_id: entity?.id,
      job_id: job?.id,
      ...req.body,
    },
  };

  if (error_simulation) {
    switch (error_simulation) {
      case 'stale_sync_token':
        input.error = {
          message: 'Sync token expired. Full resync required.',
          code: 'STALE_OBJECT',
          context: {
            last_sync_token: 'abc123',
            current_sync_token: 'def456',
            entities_affected: 47,
          },
        };
        break;
      case 'gl_account_mismatch':
        input.error = {
          message: 'GL Account mapping failed: Account "6200 - Materials" not found in QuickBooks',
          code: 'ENTITY_NOT_FOUND',
          context: {
            miter_account: '6200',
            miter_account_name: 'Materials',
            suggested_qb_accounts: ['6000 - Cost of Goods Sold', '6100 - Supplies'],
          },
        };
        break;
      case 'duplicate_invoice':
        input.error = {
          message: 'Duplicate invoice detected: Invoice #INV-2024-001 already exists in QuickBooks',
          code: 'DUPLICATE_ENTRY',
          context: {
            miter_invoice_id: 'INV-2024-001',
            qb_invoice_id: 'QBO-8834',
            created_at: new Date(Date.now() - 86400000).toISOString(),
          },
        };
        break;
      case 'auth_refresh_failed':
        input.error = {
          message: 'OAuth refresh token invalid. User must re-authorize.',
          code: '401',
          context: {
            last_successful_auth: new Date(Date.now() - 604800000).toISOString(),
            company_id: 'qb_company_123',
          },
        };
        break;
      default:
        input.error = {
          message: error_simulation,
          code: 'UNKNOWN',
        };
    }
  }

  const event = createEvent(input);

  res.status(200).json({
    received: true,
    event_id: event.id,
    status: event.status,
  });
});

export default router;
