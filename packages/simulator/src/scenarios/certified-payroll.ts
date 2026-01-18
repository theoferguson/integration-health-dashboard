import type { SimulationScenario } from '../types.js';

export const certifiedPayrollScenarios: SimulationScenario[] = [
  {
    name: 'Certified Payroll - WH-347 Generated',
    description: 'Weekly certified payroll report generated successfully',
    integration: 'certified_payroll',
    endpoint: '/api/webhooks/certified-payroll',
    isError: false,
    payload: {
      event_type: 'report.generated',
      report: {
        type: 'WH-347',
        id: 'CPR-2024-0115',
        pay_period: '2024-01-08 to 2024-01-14',
      },
      job: {
        id: 'JOB-4821',
        name: 'Downtown Office Tower - Phase 2',
        contract_type: 'federal_davis_bacon',
      },
      data: {
        workers_included: 24,
        total_hours: 892,
        prevailing_wage_compliant: true,
      },
    },
  },
  {
    name: 'Certified Payroll - LCPtracker Export',
    description: 'Report successfully exported to LCPtracker',
    integration: 'certified_payroll',
    endpoint: '/api/webhooks/certified-payroll',
    isError: false,
    payload: {
      event_type: 'export.completed',
      report: {
        type: 'LCPtracker',
        id: 'LCP-2024-0115',
        pay_period: '2024-01-08 to 2024-01-14',
      },
      job: {
        id: 'JOB-4821',
        name: 'Downtown Office Tower',
      },
      data: {
        records_exported: 47,
        status: 'accepted',
        confirmation_number: 'LCP-CONF-887432',
      },
    },
  },
  {
    name: 'Certified Payroll - Prevailing Wage Verified',
    description: 'All workers paid at or above prevailing wage',
    integration: 'certified_payroll',
    endpoint: '/api/webhooks/certified-payroll',
    isError: false,
    payload: {
      event_type: 'compliance.verified',
      report: {
        type: 'wage_verification',
        id: 'WV-2024-0115',
      },
      job: {
        id: 'JOB-4821',
      },
      data: {
        workers_verified: 24,
        classifications_checked: 8,
        all_compliant: true,
      },
    },
  },
  {
    name: 'Certified Payroll - Missing Wage Rate',
    description: 'Prevailing wage rate not configured for classification',
    integration: 'certified_payroll',
    endpoint: '/api/webhooks/certified-payroll',
    isError: true,
    payload: {
      event_type: 'report.generation_failed',
      report: {
        type: 'WH-347',
        pay_period: '2024-01-15 to 2024-01-21',
      },
      job: {
        id: 'JOB-4821',
        name: 'Downtown Office Tower',
      },
      error_simulation: 'missing_wage_rate',
    },
  },
  {
    name: 'Certified Payroll - Incomplete Worker Data',
    description: 'Missing apprentice registration information',
    integration: 'certified_payroll',
    endpoint: '/api/webhooks/certified-payroll',
    isError: true,
    payload: {
      event_type: 'report.validation_failed',
      report: {
        type: 'WH-347',
        pay_period: '2024-01-15 to 2024-01-21',
      },
      job: {
        id: 'JOB-4822',
        name: 'Highway 101 Bridge Repair',
      },
      error_simulation: 'incomplete_worker_data',
    },
  },
  {
    name: 'Certified Payroll - LCPtracker Auth Failed',
    description: 'Invalid API credentials for LCPtracker',
    integration: 'certified_payroll',
    endpoint: '/api/webhooks/certified-payroll',
    isError: true,
    payload: {
      event_type: 'export.failed',
      report: {
        type: 'LCPtracker',
      },
      error_simulation: 'lcptracker_auth',
    },
  },
  {
    name: 'Certified Payroll - Fringe Calculation Error',
    description: 'Fringe benefit rate mismatch with wage determination',
    integration: 'certified_payroll',
    endpoint: '/api/webhooks/certified-payroll',
    isError: true,
    payload: {
      event_type: 'compliance.validation_failed',
      report: {
        type: 'fringe_verification',
      },
      job: {
        id: 'JOB-4821',
      },
      error_simulation: 'fringe_calculation_error',
    },
  },
];
