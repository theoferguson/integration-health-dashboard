import type { SimulationScenario } from '../types.js';

export const procoreScenarios: SimulationScenario[] = [
  {
    name: 'Procore - Job Sync Success',
    description: 'Successfully synced job details from Procore',
    integration: 'procore',
    endpoint: '/api/webhooks/procore',
    isError: false,
    payload: {
      event_type: 'project.sync',
      resource: {
        type: 'project',
        id: 12847,
        project_id: 12847,
        job_id: 'JOB-4821',
      },
      data: {
        name: 'Downtown Office Tower - Phase 2',
        status: 'active',
        start_date: '2024-01-15',
        end_date: '2024-08-30',
      },
    },
  },
  {
    name: 'Procore - Cost Code Update',
    description: 'Cost code structure updated from Procore',
    integration: 'procore',
    endpoint: '/api/webhooks/procore',
    isError: false,
    payload: {
      event_type: 'cost_code.updated',
      resource: {
        type: 'cost_code',
        id: 'CC-03-100',
        project_id: 12847,
      },
      data: {
        code: '03-100',
        name: 'Concrete - Formwork',
        budget: 125000,
      },
    },
  },
  {
    name: 'Procore - Daily Log Sync',
    description: 'Daily log imported from Procore',
    integration: 'procore',
    endpoint: '/api/webhooks/procore',
    isError: false,
    payload: {
      event_type: 'daily_log.created',
      resource: {
        type: 'daily_log',
        id: 'DL-2024-0115',
        project_id: 12847,
      },
      data: {
        date: '2024-01-15',
        weather: 'Clear, 45°F',
        workers_on_site: 24,
        notes: 'Completed foundation pour for section A',
      },
    },
  },
  {
    name: 'Procore - Project Archived Error',
    description: 'Sync failed because project was archived in Procore',
    integration: 'procore',
    endpoint: '/api/webhooks/procore',
    isError: true,
    payload: {
      event_type: 'project.sync',
      resource: {
        type: 'project',
        id: 12847,
        project_id: 12847,
        job_id: 'JOB-4821',
      },
      error_simulation: 'project_archived',
    },
  },
  {
    name: 'Procore - Cost Code Mismatch',
    description: 'Cost code mapping failed between Procore and Miter',
    integration: 'procore',
    endpoint: '/api/webhooks/procore',
    isError: true,
    payload: {
      event_type: 'cost_code.sync',
      resource: {
        type: 'cost_code',
        id: 'CC-03-100',
        project_id: 12847,
      },
      error_simulation: 'cost_code_mismatch',
    },
  },
  {
    name: 'Procore - Auth Token Expired',
    description: 'OAuth token expired, re-authentication needed',
    integration: 'procore',
    endpoint: '/api/webhooks/procore',
    isError: true,
    payload: {
      event_type: 'project.sync',
      resource: {
        type: 'project',
        id: 12847,
      },
      error_simulation: 'auth_expired',
    },
  },
];
