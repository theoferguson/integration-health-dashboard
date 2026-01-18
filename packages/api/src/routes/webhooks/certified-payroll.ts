import { Router } from 'express';
import { createEvent } from '../../services/eventStore.js';
import type { CreateEventInput } from '../../types/index.js';

const router = Router();

// Certified Payroll webhook receiver
// Handles: LCPtracker exports, WH-347 generation, prevailing wage validation
router.post('/', (req, res) => {
  const { event_type, report, job, error_simulation } = req.body;

  const input: CreateEventInput = {
    integration: 'certified_payroll',
    eventType: event_type || 'unknown',
    status: error_simulation ? 'failure' : 'success',
    payload: {
      report_type: report?.type,
      report_id: report?.id,
      job_id: job?.id,
      project_name: job?.name,
      pay_period: report?.pay_period,
      ...req.body,
    },
  };

  if (error_simulation) {
    switch (error_simulation) {
      case 'missing_wage_rate':
        input.error = {
          message: 'Prevailing wage rate not configured for classification: Electrician - Journeyman',
          code: 'MISSING_WAGE_RATE',
          context: {
            classification: 'Electrician - Journeyman',
            job_id: job?.id || 'JOB-4821',
            county: 'Los Angeles',
            affected_employees: ['Mike Torres', 'Sarah Chen', 'James Wilson'],
            deadline: new Date(Date.now() + 172800000).toISOString(),
          },
        };
        break;
      case 'incomplete_worker_data':
        input.error = {
          message: 'WH-347 generation failed: Missing required apprentice data',
          code: 'INCOMPLETE_DATA',
          context: {
            missing_fields: ['apprentice_registration_number', 'apprentice_program'],
            affected_workers: ['David Martinez', 'Emily Johnson'],
            report_type: 'WH-347',
            deadline: new Date(Date.now() + 86400000).toISOString(),
          },
        };
        break;
      case 'lcptracker_auth':
        input.error = {
          message: 'LCPtracker authentication failed: Invalid API credentials',
          code: '401',
          context: {
            last_successful_export: new Date(Date.now() - 604800000).toISOString(),
            pending_reports: 3,
          },
        };
        break;
      case 'fringe_calculation_error':
        input.error = {
          message: 'Fringe benefit calculation mismatch: Calculated rate differs from prevailing wage determination',
          code: 'CALCULATION_ERROR',
          context: {
            classification: 'Laborer - General',
            calculated_fringe: 12.45,
            required_fringe: 14.82,
            difference: -2.37,
            affected_hours: 320,
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
