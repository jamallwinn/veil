import { describe, it, expect } from 'vitest';
import {
  calculateFees,
  calculateReceivedAmount,
  calculateRequiredAmount,
  formatXRP,
  parseXRP,
} from './fees';

// Expected EVM gas cost calculation (updated for XRPL EVM high gas costs):
// Total gas = 350,000 (deposit) + 500,000 (withdraw) + 200,000 (bridge) = 1,050,000
// Gas price = 400 gwei (XRPL EVM default - higher than other EVMs)
// Base gas cost = 1,050,000 * 400 * 10^9 / 10^18 = 0.42 XRP
// With 2.0x safety multiplier = 0.84 XRP
// MIN_EVM_GAS_BUFFER = 1.5 XRP, so result = max(0.84, 1.5) = 1.5 XRP
const EXPECTED_EVM_GAS = 1.5;
const EXPECTED_NETWORK_FEE = 0.000012;

describe('fees', () => {
  describe('calculateFees', () => {
    it('should calculate correct fees for 100 XRP', () => {
      const fees = calculateFees(100);

      expect(fees.bridge).toBe(0.3); // 0.15 * 2
      expect(fees.privacy).toBe(0.5); // 100 * 0.005
      expect(fees.evmGas).toBeCloseTo(EXPECTED_EVM_GAS, 2);
      expect(fees.network).toBe(EXPECTED_NETWORK_FEE);
      // Total: 0.3 + 0.5 + 1.5 + 0.000012 = 2.300012
      expect(fees.total).toBeCloseTo(2.300012, 4);
    });

    it('should calculate correct fees for 0 XRP', () => {
      const fees = calculateFees(0);

      expect(fees.bridge).toBe(0.3);
      expect(fees.privacy).toBe(0);
      expect(fees.evmGas).toBeCloseTo(EXPECTED_EVM_GAS, 2);
      expect(fees.network).toBe(EXPECTED_NETWORK_FEE);
      // Total: 0.3 + 0 + 1.5 + 0.000012 = 1.800012
      expect(fees.total).toBeCloseTo(1.800012, 4);
    });

    it('should calculate correct fees for 1000 XRP', () => {
      const fees = calculateFees(1000);

      expect(fees.bridge).toBe(0.3);
      expect(fees.privacy).toBe(5); // 1000 * 0.005
      expect(fees.evmGas).toBeCloseTo(EXPECTED_EVM_GAS, 2);
      expect(fees.network).toBe(EXPECTED_NETWORK_FEE);
      // Total: 0.3 + 5 + 1.5 + 0.000012 = 6.800012
      expect(fees.total).toBeCloseTo(6.800012, 4);
    });
  });

  describe('calculateReceivedAmount', () => {
    it('should calculate correct received amount', () => {
      const received = calculateReceivedAmount(100);

      // 100 - ~2.3 = ~97.7
      expect(received).toBeCloseTo(97.7, 1);
    });

    it('should return 0 for amounts where fees exceed amount', () => {
      const received = calculateReceivedAmount(0.1);

      // 0.1 - ~1.8 would be negative, should return 0
      expect(received).toBe(0);
    });
  });

  describe('calculateRequiredAmount', () => {
    it('should calculate amount needed to receive target', () => {
      // If I want recipient to get ~99 XRP, what do I need to send?
      const required = calculateRequiredAmount(99);

      // Verify by calculating received amount
      const received = calculateReceivedAmount(required);
      expect(received).toBeCloseTo(99, 0);
    });
  });

  describe('formatXRP', () => {
    it('should format with default 2 decimals', () => {
      expect(formatXRP(100.5678)).toBe('100.57');
      expect(formatXRP(0)).toBe('0.00');
      expect(formatXRP(1.1)).toBe('1.10');
    });

    it('should format with custom decimals', () => {
      expect(formatXRP(100.5678, 4)).toBe('100.5678');
      expect(formatXRP(100.5678, 0)).toBe('101');
    });
  });

  describe('parseXRP', () => {
    it('should parse valid numbers', () => {
      expect(parseXRP('100')).toBe(100);
      expect(parseXRP('100.50')).toBe(100.5);
      expect(parseXRP('0.01')).toBe(0.01);
    });

    it('should return 0 for invalid input', () => {
      expect(parseXRP('')).toBe(0);
      expect(parseXRP('abc')).toBe(0);
      expect(parseXRP('NaN')).toBe(0);
    });
  });
});
