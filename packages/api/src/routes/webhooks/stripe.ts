import { Router } from 'express';
import { createEvent } from '../../services/eventStore.js';
import type { CreateEventInput } from '../../types/index.js';

const router = Router();

// Stripe Issuing webhook receiver
// Handles: card authorizations, transactions, card status changes
router.post('/', (req, res) => {
  const { type, data, error_simulation } = req.body;

  const card = data?.object?.card || {};
  const cardholder = data?.object?.cardholder || {};
  const authorization = data?.object || {};

  const input: CreateEventInput = {
    integration: 'stripe_issuing',
    eventType: type || 'unknown',
    status: error_simulation ? 'failure' : 'success',
    payload: {
      card_id: card.id,
      cardholder_name: cardholder.name,
      merchant: authorization.merchant_data?.name,
      amount: authorization.amount,
      currency: authorization.currency,
      job_id: authorization.metadata?.job_id,
      ...req.body,
    },
  };

  if (error_simulation) {
    switch (error_simulation) {
      case 'spending_limit':
        input.error = {
          message: 'Authorization declined: spending_limit_exceeded',
          code: 'card_declined',
          context: {
            card_id: card.id || 'ic_1NqJ...',
            cardholder: cardholder.name || 'Mike Torres',
            merchant: authorization.merchant_data?.name || 'Home Depot #4521',
            amount: authorization.amount || 847.32,
            job_id: authorization.metadata?.job_id || 'JOB-4821',
            current_limit: 500,
            requested_amount: 847.32,
          },
        };
        break;
      case 'card_frozen':
        input.error = {
          message: 'Card is frozen and cannot process transactions',
          code: 'card_inactive',
          context: {
            card_id: card.id || 'ic_1NqJ...',
            frozen_at: new Date(Date.now() - 86400000).toISOString(),
            frozen_reason: 'suspected_fraud',
            cardholder: cardholder.name || 'Mike Torres',
          },
        };
        break;
      case 'insufficient_funds':
        input.error = {
          message: 'Insufficient funds in issuing balance',
          code: 'insufficient_funds',
          context: {
            available_balance: 1250.00,
            requested_amount: 2847.32,
            merchant: authorization.merchant_data?.name || 'Ferguson Plumbing Supply',
          },
        };
        break;
      case 'merchant_blocked':
        input.error = {
          message: 'Merchant category blocked by spending controls',
          code: 'merchant_blocked',
          context: {
            merchant: authorization.merchant_data?.name || 'Casino & Gaming',
            mcc: '7995',
            blocked_categories: ['gambling', 'adult_entertainment'],
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
