import { Router } from 'express';
import { createEvent } from '../../services/eventStore.js';
import type { CreateEventInput } from '../../types/index.js';

const router = Router();

// Procore webhook receiver
// Handles: job syncs, cost code updates, daily logs
router.post('/', (req, res) => {
  const { event_type, resource, error_simulation } = req.body;

  const input: CreateEventInput = {
    integration: 'procore',
    eventType: event_type || 'unknown',
    status: error_simulation ? 'failure' : 'success',
    payload: {
      resource_type: resource?.type,
      resource_id: resource?.id,
      project_id: resource?.project_id,
      ...req.body,
    },
  };

  // Simulate various error scenarios
  if (error_simulation) {
    switch (error_simulation) {
      case 'project_archived':
        input.error = {
          message: `Entity not found: Project #${resource?.project_id || '12847'} has been archived in Procore`,
          code: '404',
          context: {
            job_id: resource?.job_id || 'JOB-4821',
            procore_project_id: resource?.project_id || 12847,
            last_successful_sync: new Date(Date.now() - 86400000).toISOString(),
          },
        };
        break;
      case 'cost_code_mismatch':
        input.error = {
          message: 'Cost code mapping failed: Code "03-100" exists in Procore but has no matching code in Miter',
          code: 'MAPPING_ERROR',
          context: {
            procore_cost_code: '03-100',
            procore_code_name: 'Concrete - Formwork',
            suggestion: 'Create matching cost code or update mapping',
          },
        };
        break;
      case 'auth_expired':
        input.error = {
          message: 'OAuth token expired. Re-authentication required.',
          code: '401',
          context: {
            token_expired_at: new Date(Date.now() - 3600000).toISOString(),
            scopes: ['read', 'write'],
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

  res.status(error_simulation ? 200 : 200).json({
    received: true,
    event_id: event.id,
    status: event.status,
  });
});

export default router;
