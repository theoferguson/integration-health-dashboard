export type IntegrationType =
  | 'procore'
  | 'gusto'
  | 'quickbooks'
  | 'stripe_issuing'
  | 'certified_payroll';

export type IntegrationStatus = 'healthy' | 'degraded' | 'down';

export interface Integration {
  id: IntegrationType;
  name: string;
  description: string;
  status: IntegrationStatus;
  lastSync: Date | null;
  successRate: number; // 0-100
  eventsLast24h: number;
  errorsLast24h: number;
}

export const INTEGRATIONS: Record<IntegrationType, Omit<Integration, 'status' | 'lastSync' | 'successRate' | 'eventsLast24h' | 'errorsLast24h'>> = {
  procore: {
    id: 'procore',
    name: 'Procore',
    description: 'Project management - jobs, cost codes, daily logs',
  },
  gusto: {
    id: 'gusto',
    name: 'Gusto',
    description: 'Payroll - employee data, timecards, payroll runs',
  },
  quickbooks: {
    id: 'quickbooks',
    name: 'QuickBooks',
    description: 'Accounting - job costs, invoices, GL entries',
  },
  stripe_issuing: {
    id: 'stripe_issuing',
    name: 'Stripe Issuing',
    description: 'Payments - virtual cards, authorizations, transactions',
  },
  certified_payroll: {
    id: 'certified_payroll',
    name: 'Certified Payroll',
    description: 'Compliance - LCPtracker, WH-347 reports, prevailing wage',
  },
};
