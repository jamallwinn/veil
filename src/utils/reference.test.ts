/**
 * Reference ID Generation Tests
 */

import { describe, it, expect } from 'vitest';
import {
  generateReferenceId,
  isValidReferenceId,
  formatReferenceId,
  generateReferenceIdWithMetadata,
} from './reference';

describe('generateReferenceId', () => {
  it('should generate a valid reference ID', () => {
    const refId = generateReferenceId();
    expect(refId).toMatch(/^VEIL-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
  });

  it('should generate unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateReferenceId());
    }
    // All 100 IDs should be unique (extremely unlikely to collide)
    expect(ids.size).toBe(100);
  });

  it('should not include confusing characters (0, O, 1, I, l) in the variable part', () => {
    for (let i = 0; i < 50; i++) {
      const refId = generateReferenceId();
      // Check only the variable part after VEIL-
      const variablePart = refId.slice(5);
      expect(variablePart).not.toMatch(/[0OIl1]/);
    }
  });

  it('should always start with VEIL- prefix', () => {
    for (let i = 0; i < 20; i++) {
      const refId = generateReferenceId();
      expect(refId.startsWith('VEIL-')).toBe(true);
    }
  });

  it('should be exactly 11 characters long', () => {
    const refId = generateReferenceId();
    expect(refId.length).toBe(11); // VEIL- (5) + 6 chars
  });
});

describe('isValidReferenceId', () => {
  it('should return true for valid reference IDs', () => {
    expect(isValidReferenceId('VEIL-ABC234')).toBe(true);
    expect(isValidReferenceId('VEIL-XY9ZK8')).toBe(true);
    expect(isValidReferenceId('VEIL-234567')).toBe(true);
  });

  it('should return false for invalid reference IDs', () => {
    // Wrong prefix
    expect(isValidReferenceId('PRV-ABC234')).toBe(false);
    expect(isValidReferenceId('VEIL_ABC234')).toBe(false);

    // Wrong length
    expect(isValidReferenceId('VEIL-ABC')).toBe(false);
    expect(isValidReferenceId('VEIL-ABCDEFGH')).toBe(false);

    // Contains excluded characters
    expect(isValidReferenceId('VEIL-0BC234')).toBe(false);
    expect(isValidReferenceId('VEIL-OBC234')).toBe(false);
    expect(isValidReferenceId('VEIL-1BC234')).toBe(false);
    expect(isValidReferenceId('VEIL-IBC234')).toBe(false);
    expect(isValidReferenceId('VEIL-lBC234')).toBe(false);

    // Lower case
    expect(isValidReferenceId('VEIL-abc234')).toBe(false);

    // Null/undefined
    expect(isValidReferenceId(null as unknown as string)).toBe(false);
    expect(isValidReferenceId(undefined as unknown as string)).toBe(false);
    expect(isValidReferenceId('')).toBe(false);
  });
});

describe('formatReferenceId', () => {
  it('should return the reference ID unchanged', () => {
    const refId = 'VEIL-ABC234';
    expect(formatReferenceId(refId)).toBe(refId);
  });
});

describe('generateReferenceIdWithMetadata', () => {
  it('should return reference ID with timestamp', () => {
    const before = Date.now();
    const result = generateReferenceIdWithMetadata();
    const after = Date.now();

    expect(isValidReferenceId(result.referenceId)).toBe(true);
    expect(result.timestamp).toBeGreaterThanOrEqual(before);
    expect(result.timestamp).toBeLessThanOrEqual(after);
    expect(typeof result.formattedTime).toBe('string');
    expect(result.formattedTime.length).toBeGreaterThan(0);
  });

  it('should include a human-readable formatted time', () => {
    const result = generateReferenceIdWithMetadata();
    // Should contain some date-like content
    expect(result.formattedTime).toMatch(/\d/);
  });
});
