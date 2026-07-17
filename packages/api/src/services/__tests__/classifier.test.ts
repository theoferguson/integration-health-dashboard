import { describe, it, expect } from 'vitest';
import { classifyError } from '../classifier.js';
import type { IntegrationEvent } from '../../types/index.js';

// Helper to create test events
function createFailureEvent(
  integration: IntegrationEvent['integration'],
  errorMessage: string,
  errorCode?: string,
  context?: Record<string, unknown>
): IntegrationEvent {
  return {
    id: 'test-event-id',
    integration,
    eventType: 'test.event',
    status: 'failure',
    timestamp: new Date(),
    payload: {},
    error: {
      message: errorMessage,
      code: errorCode,
      context,
    },
  };
}

describe('classifyError', () => {
  describe('spending/quota control errors', () => {
    it('should classify spending limit exceeded as spending_control', async () => {
      const event = createFailureEvent(
        'nyc-civic-finance',
        'Authorization declined: spending_limit_exceeded',
        'card_declined'
      );

      const result = await classifyError(event);

      expect(result.category).toBe('spending_control');
      expect(result.severity).toBe('high');
      expect(result.suggestedFix).toContain('limit');
    });

    it('should classify declined as spending_control', async () => {
      const event = createFailureEvent('nyc-civic-finance', 'Request declined by upstream', 'card_declined');

      const result = await classifyError(event);

      expect(result.category).toBe('spending_control');
    });
  });

  describe('auth errors', () => {
    it('should classify OAuth token expired as auth', async () => {
      const event = createFailureEvent(
        'nyt-news',
        'OAuth token expired. Re-authentication required.',
        '401'
      );

      const result = await classifyError(event);

      expect(result.category).toBe('auth');
      expect(result.severity).toBe('high');
      expect(result.suggestedFix).toContain('Re-authenticate');
    });

    it('should classify unauthorized as auth', async () => {
      const event = createFailureEvent('weather', 'Unauthorized access', '401');

      const result = await classifyError(event);

      expect(result.category).toBe('auth');
    });
  });

  describe('rate limit errors', () => {
    it('should classify rate limit exceeded as rate_limit', async () => {
      const event = createFailureEvent(
        'nyt-news',
        'Rate limit exceeded. Too many requests.',
        '429'
      );

      const result = await classifyError(event);

      expect(result.category).toBe('rate_limit');
      expect(result.severity).toBe('low');
      expect(result.suggestedFix).toContain('auto-resolve');
    });

    it('should classify 429 status code as rate_limit', async () => {
      const event = createFailureEvent('nyt-news', 'Too many requests', '429');

      const result = await classifyError(event);

      expect(result.category).toBe('rate_limit');
    });
  });

  describe('data validation errors', () => {
    it('should classify validation failures as data_validation', async () => {
      const event = createFailureEvent(
        'nyt-books',
        'Validation failed: list_name is required but was null',
        '400'
      );

      const result = await classifyError(event);

      expect(result.category).toBe('data_validation');
      expect(result.severity).toBe('medium');
    });

    it('should classify missing required fields as data_validation', async () => {
      const event = createFailureEvent('nyt-books', 'Missing required field: isbn', '400');

      const result = await classifyError(event);

      expect(result.category).toBe('data_validation');
    });
  });

  describe('data state mismatch errors', () => {
    it('should classify archived entities as data_state_mismatch', async () => {
      const event = createFailureEvent(
        'weather',
        'Entity not found: zone NYZ072 has been archived upstream',
        '404'
      );

      const result = await classifyError(event);

      expect(result.category).toBe('data_state_mismatch');
      expect(result.severity).toBe('medium');
    });

    it('should classify mapping failures as data_state_mismatch', async () => {
      const event = createFailureEvent(
        'nyc-civic-finance',
        'Candidate mapping failed: record not found',
        'ENTITY_NOT_FOUND'
      );

      const result = await classifyError(event);

      expect(result.category).toBe('data_state_mismatch');
    });
  });

  describe('unknown errors', () => {
    it('should classify unrecognized errors as unknown', async () => {
      const event = createFailureEvent(
        'weather',
        'An unexpected internal server error occurred',
        '500'
      );

      const result = await classifyError(event);

      expect(result.category).toBe('unknown');
      expect(result.severity).toBe('medium');
    });
  });

  describe('error handling', () => {
    it('should throw error for success events', async () => {
      const event: IntegrationEvent = {
        id: 'test-id',
        integration: 'weather',
        eventType: 'test.event',
        status: 'success',
        timestamp: new Date(),
        payload: {},
      };

      await expect(classifyError(event)).rejects.toThrow(
        'Event has no error to classify'
      );
    });

    it('should throw error for events without error object', async () => {
      const event: IntegrationEvent = {
        id: 'test-id',
        integration: 'weather',
        eventType: 'test.event',
        status: 'failure',
        timestamp: new Date(),
        payload: {},
        // no error object
      };

      await expect(classifyError(event)).rejects.toThrow(
        'Event has no error to classify'
      );
    });
  });

  describe('classification structure', () => {
    it('should return all required fields', async () => {
      const event = createFailureEvent('nyc-civic-finance', 'Authorization declined', 'card_declined');

      const result = await classifyError(event);

      expect(result).toHaveProperty('category');
      expect(result).toHaveProperty('severity');
      expect(result).toHaveProperty('cause');
      expect(result).toHaveProperty('suggestedFix');
      expect(result).toHaveProperty('affectedData');
      expect(result).toHaveProperty('businessImpact');
    });

    it('should return severity as one of valid values', async () => {
      const event = createFailureEvent('nyt-news', 'Rate limit exceeded', '429');

      const result = await classifyError(event);

      expect(['low', 'medium', 'high', 'critical']).toContain(result.severity);
    });
  });
});
