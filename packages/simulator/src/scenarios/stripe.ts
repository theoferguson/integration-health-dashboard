import type { SimulationScenario } from '../types.js';

export const stripeScenarios: SimulationScenario[] = [
  {
    name: 'Stripe - Authorization Approved',
    description: 'Card purchase authorized at Home Depot',
    integration: 'stripe_issuing',
    endpoint: '/api/webhooks/stripe',
    isError: false,
    payload: {
      type: 'issuing_authorization.created',
      data: {
        object: {
          id: 'iauth_1NqJ...',
          amount: 342.87,
          currency: 'usd',
          approved: true,
          card: {
            id: 'ic_1NqJ...',
            last4: '4242',
          },
          cardholder: {
            id: 'ich_1Nq...',
            name: 'Mike Torres',
          },
          merchant_data: {
            name: 'Home Depot #4521',
            category: 'building_materials',
            city: 'Los Angeles',
          },
          metadata: {
            job_id: 'JOB-4821',
            cost_code: '03-100',
          },
        },
      },
    },
  },
  {
    name: 'Stripe - Transaction Captured',
    description: 'Purchase completed and captured',
    integration: 'stripe_issuing',
    endpoint: '/api/webhooks/stripe',
    isError: false,
    payload: {
      type: 'issuing_transaction.created',
      data: {
        object: {
          id: 'ipi_1Nq...',
          amount: 342.87,
          currency: 'usd',
          type: 'capture',
          card: {
            id: 'ic_1NqJ...',
          },
          cardholder: {
            name: 'Mike Torres',
          },
          merchant_data: {
            name: 'Home Depot #4521',
          },
          metadata: {
            job_id: 'JOB-4821',
          },
        },
      },
    },
  },
  {
    name: 'Stripe - Card Created',
    description: 'New virtual card created for field worker',
    integration: 'stripe_issuing',
    endpoint: '/api/webhooks/stripe',
    isError: false,
    payload: {
      type: 'issuing_card.created',
      data: {
        object: {
          id: 'ic_1Nq...',
          status: 'active',
          type: 'virtual',
          cardholder: {
            name: 'Sarah Chen',
            email: 'sarah.chen@example.com',
          },
          spending_controls: {
            spending_limits: [
              { amount: 1000, interval: 'daily' },
              { amount: 5000, interval: 'weekly' },
            ],
          },
        },
      },
    },
  },
  {
    name: 'Stripe - Spending Limit Exceeded',
    description: 'Card declined due to spending limit',
    integration: 'stripe_issuing',
    endpoint: '/api/webhooks/stripe',
    isError: true,
    payload: {
      type: 'issuing_authorization.request',
      data: {
        object: {
          amount: 847.32,
          card: {
            id: 'ic_1NqJ...',
          },
          cardholder: {
            name: 'Mike Torres',
          },
          merchant_data: {
            name: 'Home Depot #4521',
          },
          metadata: {
            job_id: 'JOB-4821',
          },
        },
      },
      error_simulation: 'spending_limit',
    },
  },
  {
    name: 'Stripe - Card Frozen',
    description: 'Transaction blocked on frozen card',
    integration: 'stripe_issuing',
    endpoint: '/api/webhooks/stripe',
    isError: true,
    payload: {
      type: 'issuing_authorization.request',
      data: {
        object: {
          amount: 156.00,
          card: {
            id: 'ic_1Nq...',
          },
          cardholder: {
            name: 'James Wilson',
          },
          merchant_data: {
            name: 'Lowes #2234',
          },
        },
      },
      error_simulation: 'card_frozen',
    },
  },
  {
    name: 'Stripe - Insufficient Funds',
    description: 'Issuing balance too low for transaction',
    integration: 'stripe_issuing',
    endpoint: '/api/webhooks/stripe',
    isError: true,
    payload: {
      type: 'issuing_authorization.request',
      data: {
        object: {
          amount: 2847.32,
          card: {
            id: 'ic_1Nq...',
          },
          cardholder: {
            name: 'David Martinez',
          },
          merchant_data: {
            name: 'Ferguson Plumbing Supply',
          },
          metadata: {
            job_id: 'JOB-4823',
          },
        },
      },
      error_simulation: 'insufficient_funds',
    },
  },
  {
    name: 'Stripe - Merchant Category Blocked',
    description: 'Merchant category not allowed',
    integration: 'stripe_issuing',
    endpoint: '/api/webhooks/stripe',
    isError: true,
    payload: {
      type: 'issuing_authorization.request',
      data: {
        object: {
          amount: 200.00,
          card: {
            id: 'ic_1Nq...',
          },
          cardholder: {
            name: 'Anonymous',
          },
          merchant_data: {
            name: 'Lucky Star Casino',
            category: 'gambling',
          },
        },
      },
      error_simulation: 'merchant_blocked',
    },
  },
];
