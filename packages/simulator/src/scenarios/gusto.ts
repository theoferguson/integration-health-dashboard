import type { SimulationScenario } from '../types.js';

export const gustoScenarios: SimulationScenario[] = [
  {
    name: 'Gusto - Employee Sync Success',
    description: 'Successfully synced employee data from Gusto',
    integration: 'gusto',
    endpoint: '/api/webhooks/gusto',
    isError: false,
    payload: {
      event_type: 'employee.sync',
      employee: {
        id: 'emp_9921',
        name: 'Mike Torres',
        email: 'mike.torres@example.com',
        classification: 'Electrician - Journeyman',
      },
      data: {
        department: 'Field Operations',
        start_date: '2022-03-15',
        status: 'active',
      },
    },
  },
  {
    name: 'Gusto - Timecard Submission',
    description: 'Timecard submitted for payroll processing',
    integration: 'gusto',
    endpoint: '/api/webhooks/gusto',
    isError: false,
    payload: {
      event_type: 'timecard.submitted',
      employee: {
        id: 'emp_9921',
        name: 'Mike Torres',
      },
      timecard: {
        id: 'tc_2024_0115_9921',
        pay_period: '2024-01-01 to 2024-01-14',
        total_hours: 84,
        overtime_hours: 4,
      },
      job_allocations: [
        { job_id: 'JOB-4821', hours: 40, cost_code: '03-100' },
        { job_id: 'JOB-4822', hours: 44, cost_code: '16-100' },
      ],
    },
  },
  {
    name: 'Gusto - Payroll Run Complete',
    description: 'Payroll successfully processed',
    integration: 'gusto',
    endpoint: '/api/webhooks/gusto',
    isError: false,
    payload: {
      event_type: 'payroll.completed',
      data: {
        pay_period: '2024-01-01 to 2024-01-14',
        employees_paid: 47,
        total_gross: 187432.50,
        total_net: 142891.23,
        check_date: '2024-01-19',
      },
    },
  },
  {
    name: 'Gusto - Rate Limit Exceeded',
    description: 'Too many API requests to Gusto',
    integration: 'gusto',
    endpoint: '/api/webhooks/gusto',
    isError: true,
    payload: {
      event_type: 'employee.sync',
      employee: {
        id: 'emp_9922',
        name: 'Sarah Chen',
      },
      error_simulation: 'rate_limit',
    },
  },
  {
    name: 'Gusto - Duplicate SSN',
    description: 'Employee record conflicts with existing entry',
    integration: 'gusto',
    endpoint: '/api/webhooks/gusto',
    isError: true,
    payload: {
      event_type: 'employee.created',
      employee: {
        id: 'emp_9923',
        name: 'John Smith',
      },
      error_simulation: 'duplicate_ssn',
    },
  },
  {
    name: 'Gusto - Missing Required Field',
    description: 'Employee sync failed due to null ID',
    integration: 'gusto',
    endpoint: '/api/webhooks/gusto',
    isError: true,
    payload: {
      event_type: 'employee.sync',
      employee: {
        id: null,
        name: 'Unknown Employee',
      },
      error_simulation: 'missing_required',
    },
  },
  {
    name: 'Gusto - Payroll Period Locked',
    description: 'Cannot modify timecard after payroll lock',
    integration: 'gusto',
    endpoint: '/api/webhooks/gusto',
    isError: true,
    payload: {
      event_type: 'timecard.updated',
      employee: {
        id: 'emp_9921',
        name: 'Mike Torres',
      },
      timecard: {
        id: 'tc_2024_0115_9921',
      },
      error_simulation: 'payroll_locked',
    },
  },
];
