/**
 * Integration Types
 * Shared type definitions for integrations across the platform
 */

export type IntegrationType =
  | 'procore'
  | 'gusto'
  | 'quickbooks'
  | 'stripe_issuing'
  | 'certified_payroll';

export type IntegrationStatus = 'healthy' | 'degraded' | 'down';

export interface IntegrationBase {
  id: IntegrationType;
  name: string;
  description: string;
}

export interface Integration extends IntegrationBase {
  status: IntegrationStatus;
  lastSync: Date | string | null;
  successRate: number;
  eventsLast24h: number;
  errorsLast24h: number;
}

/**
 * Static integration definitions
 */
export const INTEGRATIONS: Record<IntegrationType, IntegrationBase> = {
  procore: {
    id: 'procore',
    name: 'Procore',
    description: 'Project management and construction data',
  },
  gusto: {
    id: 'gusto',
    name: 'Gusto',
    description: 'Payroll and HR management',
  },
  quickbooks: {
    id: 'quickbooks',
    name: 'QuickBooks',
    description: 'Accounting and invoicing',
  },
  stripe_issuing: {
    id: 'stripe_issuing',
    name: 'Stripe Issuing',
    description: 'Virtual cards and spend management',
  },
  certified_payroll: {
    id: 'certified_payroll',
    name: 'Certified Payroll',
    description: 'Prevailing wage compliance reporting',
  },
};

export const INTEGRATION_IDS = Object.keys(INTEGRATIONS) as IntegrationType[];
