import { Router } from 'express';
import { createEvent } from '../../services/eventStore.js';
import type { CreateEventInput } from '../../types/index.js';

const router = Router();

// Gusto webhook receiver
// Handles: employee syncs, timecard submissions, payroll runs
router.post('/', (req, res) => {
  const { event_type, employee, timecard, error_simulation } = req.body;

  const input: CreateEventInput = {
    integration: 'gusto',
    eventType: event_type || 'unknown',
    status: error_simulation ? 'failure' : 'success',
    payload: {
      employee_id: employee?.id,
      employee_name: employee?.name,
      timecard_id: timecard?.id,
      ...req.body,
    },
  };

  if (error_simulation) {
    switch (error_simulation) {
      case 'rate_limit':
        input.error = {
          message: '429 Too Many Requests - Rate limit exceeded',
          code: '429',
          context: {
            requests_this_minute: 62,
            limit: 60,
            retry_after: 45,
          },
        };
        break;
      case 'duplicate_ssn':
        input.error = {
          message: 'Duplicate SSN detected: Employee record conflicts with existing entry',
          code: 'DUPLICATE_ENTRY',
          context: {
            field: 'ssn',
            existing_employee_id: 'emp_8834',
            new_employee_id: employee?.id || 'emp_9921',
          },
        };
        break;
      case 'missing_required':
        input.error = {
          message: 'Validation failed: employee_id is required but was null',
          code: '400',
          context: {
            missing_fields: ['employee_id'],
            payload_snippet: { employee_id: null },
          },
        };
        break;
      case 'payroll_locked':
        input.error = {
          message: 'Cannot modify timecard: Payroll period is locked for processing',
          code: 'PAYROLL_LOCKED',
          context: {
            pay_period: '2024-01-15 to 2024-01-28',
            lock_time: new Date(Date.now() - 7200000).toISOString(),
            payroll_deadline: new Date(Date.now() + 86400000).toISOString(),
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
