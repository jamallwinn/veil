import { describe, it, expect, vi, beforeEach } from 'vitest';
import { gemWalletService } from './index';
import * as gemwalletApi from '@gemwallet/api';

// Mock the @gemwallet/api module
vi.mock('@gemwallet/api');

describe('GemWalletService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isInstalled', () => {
    it('should return true when GemWallet is installed', async () => {
      vi.mocked(gemwalletApi.isInstalled).mockResolvedValue({
        type: 'response',
        result: { isInstalled: true },
      } as any);

      const result = await gemWalletService.isInstalled();

      expect(result).toBe(true);
      expect(gemwalletApi.isInstalled).toHaveBeenCalled();
    });

    it('should return false when GemWallet is not installed', async () => {
      vi.mocked(gemwalletApi.isInstalled).mockResolvedValue({
        type: 'response',
        result: { isInstalled: false },
      } as any);

      const result = await gemWalletService.isInstalled();

      expect(result).toBe(false);
    });

    it('should return false on timeout', async () => {
      // Use fake timers to test timeout behavior
      vi.useFakeTimers();

      // Create a promise that never resolves (simulates infinite delay)
      vi.mocked(gemwalletApi.isInstalled).mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      const resultPromise = gemWalletService.isInstalled();

      // Advance time past the 3-second timeout
      await vi.advanceTimersByTimeAsync(3100);

      const result = await resultPromise;

      expect(result).toBe(false);

      vi.useRealTimers();
    });

    it('should return false on error', async () => {
      vi.mocked(gemwalletApi.isInstalled).mockRejectedValue(new Error('Test error'));

      const result = await gemWalletService.isInstalled();

      expect(result).toBe(false);
    });
  });

  describe('getNetwork', () => {
    it('should return mainnet when connected to mainnet', async () => {
      vi.mocked(gemwalletApi.getNetwork).mockResolvedValue({
        type: 'response',
        result: { network: 'Mainnet' as any },
      } as any);

      const result = await gemWalletService.getNetwork();

      expect(result).toBe('mainnet');
    });

    it('should return testnet when connected to testnet', async () => {
      vi.mocked(gemwalletApi.getNetwork).mockResolvedValue({
        type: 'response',
        result: { network: 'Testnet' as any },
      } as any);

      const result = await gemWalletService.getNetwork();

      expect(result).toBe('testnet');
    });

    it('should return null on error', async () => {
      vi.mocked(gemwalletApi.getNetwork).mockRejectedValue(new Error('Test error'));

      const result = await gemWalletService.getNetwork();

      expect(result).toBeNull();
    });
  });

  describe('connect', () => {
    it('should return address on successful connection', async () => {
      vi.mocked(gemwalletApi.getAddress).mockResolvedValue({
        type: 'response',
        result: { address: 'rTestAddress123' },
      } as any);

      const result = await gemWalletService.connect();

      expect(result).toBe('rTestAddress123');
    });

    it('should return null on connection failure', async () => {
      vi.mocked(gemwalletApi.getAddress).mockRejectedValue(new Error('Connection failed'));

      const result = await gemWalletService.connect();

      expect(result).toBeNull();
    });
  });

  describe('isValidAddress', () => {
    it('should return true for valid XRPL addresses', () => {
      expect(gemWalletService.isValidAddress('rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe')).toBe(true);
      expect(gemWalletService.isValidAddress('rLHzPsX3oXdzU2qP17kHCH2Gpsqs6BNj5P')).toBe(true);
    });

    it('should return false for invalid addresses', () => {
      expect(gemWalletService.isValidAddress('')).toBe(false);
      expect(gemWalletService.isValidAddress('invalid')).toBe(false);
      expect(gemWalletService.isValidAddress('0x123')).toBe(false); // Ethereum format
      expect(gemWalletService.isValidAddress('xPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe')).toBe(false); // Wrong prefix
    });

    it('should return false for addresses with invalid characters', () => {
      // XRPL addresses don't use 0, O, I, l
      expect(gemWalletService.isValidAddress('r0123456789')).toBe(false);
      expect(gemWalletService.isValidAddress('rOOOOOOOOO')).toBe(false);
      expect(gemWalletService.isValidAddress('rIIIIIIIII')).toBe(false);
      expect(gemWalletService.isValidAddress('rlllllllll')).toBe(false);
    });
  });

  describe('sendPayment', () => {
    it('should return hash on successful payment', async () => {
      vi.mocked(gemwalletApi.sendPayment).mockResolvedValue({
        type: 'response',
        result: { hash: 'TEST_TX_HASH_123' },
      } as any);

      const result = await gemWalletService.sendPayment({
        amount: '100',
        destination: 'rTestDestination123',
      });

      expect(result.hash).toBe('TEST_TX_HASH_123');
      expect(result.status).toBe('success');
    });

    it('should throw on payment failure', async () => {
      vi.mocked(gemwalletApi.sendPayment).mockRejectedValue(new Error('Payment failed'));

      await expect(
        gemWalletService.sendPayment({
          amount: '100',
          destination: 'rTestDestination123',
        })
      ).rejects.toThrow('Payment failed');
    });
  });

  describe('getTrustlineBalance', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn());
    });

    it('should return balance when trustline exists', async () => {
      vi.mocked(fetch).mockResolvedValue({
        json: () => Promise.resolve({
          result: {
            lines: [
              { currency: 'USD', account: 'rGm7WCVp9gb4jZHWTEtGUr4dd74z2XuWhE', balance: '150.5' },
              { currency: 'EUR', account: 'rOtherIssuer', balance: '100' },
            ],
          },
        }),
      } as Response);

      const result = await gemWalletService.getTrustlineBalance(
        'rTestAddress',
        'USD',
        'rGm7WCVp9gb4jZHWTEtGUr4dd74z2XuWhE'
      );

      expect(result).toBe('150.5');
      expect(fetch).toHaveBeenCalledWith(
        'https://xrplcluster.com/',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('account_lines'),
        })
      );
    });

    it('should return 0 when trustline does not exist', async () => {
      vi.mocked(fetch).mockResolvedValue({
        json: () => Promise.resolve({
          result: {
            lines: [
              { currency: 'EUR', account: 'rOtherIssuer', balance: '100' },
            ],
          },
        }),
      } as Response);

      const result = await gemWalletService.getTrustlineBalance(
        'rTestAddress',
        'USD',
        'rGm7WCVp9gb4jZHWTEtGUr4dd74z2XuWhE'
      );

      expect(result).toBe('0');
    });

    it('should return null on fetch error', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

      const result = await gemWalletService.getTrustlineBalance(
        'rTestAddress',
        'USD',
        'rGm7WCVp9gb4jZHWTEtGUr4dd74z2XuWhE'
      );

      expect(result).toBeNull();
    });
  });

  describe('getUSDCBalance', () => {
    // USDC on XRPL uses hex-encoded currency code "USDC" (not "USD")
    // "USDC" in hex = 55534443, padded to 40 chars
    const USDC_CURRENCY_HEX = '5553444300000000000000000000000000000000';
    const USDC_ISSUER = 'rGm7WCVp9gb4jZHWTEtGUr4dd74z2XuWhE';

    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn());
    });

    it('should return USDC balance using correct hex currency code and issuer', async () => {
      vi.mocked(fetch).mockResolvedValue({
        json: () => Promise.resolve({
          result: {
            lines: [
              { currency: USDC_CURRENCY_HEX, account: USDC_ISSUER, balance: '250.00' },
            ],
          },
        }),
      } as Response);

      const result = await gemWalletService.getUSDCBalance('rTestAddress');

      expect(result).toBe('250.00');
    });

    it('should return 0 when no USDC trustline', async () => {
      vi.mocked(fetch).mockResolvedValue({
        json: () => Promise.resolve({
          result: {
            lines: [],
          },
        }),
      } as Response);

      const result = await gemWalletService.getUSDCBalance('rTestAddress');

      expect(result).toBe('0');
    });

    it('should not match USD (3-char code) - only hex-encoded USDC', async () => {
      // This tests that we use the correct hex currency code, not "USD"
      vi.mocked(fetch).mockResolvedValue({
        json: () => Promise.resolve({
          result: {
            lines: [
              // Standard 3-char "USD" should NOT be matched
              { currency: 'USD', account: USDC_ISSUER, balance: '100.00' },
            ],
          },
        }),
      } as Response);

      const result = await gemWalletService.getUSDCBalance('rTestAddress');

      // Should return '0' because we look for hex USDC, not "USD"
      expect(result).toBe('0');
    });
  });
});
