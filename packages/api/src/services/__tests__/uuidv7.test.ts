import { describe, it, expect } from 'vitest';
import { uuidv7 } from '../uuidv7.js';

describe('uuidv7', () => {
  it('has the canonical UUID shape with version 7 and variant 10', () => {
    const id = uuidv7();
    // 8-4-4-4-12 hex, 13th hex char (version) = 7, 17th (variant) in [89ab]
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('is unique across many calls', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uuidv7()));
    expect(ids.size).toBe(1000);
  });

  it('sorts lexicographically by creation time', async () => {
    const a = uuidv7();
    await new Promise((r) => setTimeout(r, 5));
    const b = uuidv7();
    expect(a < b).toBe(true);
  });
});
