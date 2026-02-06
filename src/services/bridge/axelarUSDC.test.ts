/**
 * Axelar USDC Bridge Service Tests
 *
 * Tests for the USDC cross-chain bridge integration with Axelar ITS.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AxelarUSDCBridgeService,
  axelarUSDCBridgeService,
  usdcBridgeUtils,
  USDC_BRIDGE_CONFIG,
  USDC_AXELAR_CHAIN_IDS,
} from './axelarUSDC';

describe('AxelarUSDCBridgeService', () => {
  let service: AxelarUSDCBridgeService;

  beforeEach(() => {
    vi.useFakeTimers();
    service = new AxelarUSDCBridgeService();
    service.clearTransactions();
  });

  afterEach(() => {
    service.cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // ===========================================================================
  // Constants
  // ===========================================================================

  describe('Constants', () => {
    it('should export Axelar chain identifiers', () => {
      expect(USDC_AXELAR_CHAIN_IDS.XRPL).toBe('xrpl');
      expect(USDC_AXELAR_CHAIN_IDS.XRPL_EVM).toBe('xrpl-evm');
    });

    it('should have valid bridge config', () => {
      expect(USDC_BRIDGE_CONFIG.FEE_PERCENTAGE).toBe(0.001);
      expect(USDC_BRIDGE_CONFIG.MINIMUM_AMOUNT).toBe('3'); // 3 USDC minimum (matches pool denomination)
      expect(USDC_BRIDGE_CONFIG.REQUIRED_CONFIRMATIONS.toEVM).toBe(6);
      expect(USDC_BRIDGE_CONFIG.REQUIRED_CONFIRMATIONS.toXRPL).toBe(12);
    });

    it('should have valid service config', () => {
      const config = service.getConfig();
      expect(config.feePercentage).toBe(0.001);
      expect(config.minimumAmount).toBe('3'); // 3 USDC minimum (matches pool denomination)
      expect(config.decimals).toBe(15);
      expect(config.axelarChainIds).toBeDefined();
      expect(config.axelarEnvironment).toBe('mainnet');
    });
  });

  // ===========================================================================
  // usdcBridgeUtils
  // ===========================================================================

  describe('usdcBridgeUtils', () => {
    describe('isValidXRPLAddress', () => {
      it('should return true for valid XRPL addresses', () => {
        expect(usdcBridgeUtils.isValidXRPLAddress('rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe')).toBe(true);
        expect(usdcBridgeUtils.isValidXRPLAddress('rLHzPsX3oXdzU2qP17kHCH2Gpsqs6BNj5P')).toBe(true);
      });

      it('should return false for invalid XRPL addresses', () => {
        expect(usdcBridgeUtils.isValidXRPLAddress('')).toBe(false);
        expect(usdcBridgeUtils.isValidXRPLAddress('invalid')).toBe(false);
        expect(usdcBridgeUtils.isValidXRPLAddress('0x1234567890123456789012345678901234567890')).toBe(false);
        expect(usdcBridgeUtils.isValidXRPLAddress('xPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe')).toBe(false);
      });
    });

    describe('isValidEVMAddress', () => {
      it('should return true for valid EVM addresses', () => {
        expect(usdcBridgeUtils.isValidEVMAddress('0x1234567890123456789012345678901234567890')).toBe(true);
        expect(usdcBridgeUtils.isValidEVMAddress('0xAbCdEf1234567890123456789012345678901234')).toBe(true);
      });

      it('should return false for invalid EVM addresses', () => {
        expect(usdcBridgeUtils.isValidEVMAddress('')).toBe(false);
        expect(usdcBridgeUtils.isValidEVMAddress('invalid')).toBe(false);
        expect(usdcBridgeUtils.isValidEVMAddress('rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe')).toBe(false);
        expect(usdcBridgeUtils.isValidEVMAddress('0x123')).toBe(false);
        expect(usdcBridgeUtils.isValidEVMAddress('1234567890123456789012345678901234567890')).toBe(false);
      });
    });

    describe('calculateFee', () => {
      it('should calculate 0.1% fee correctly', () => {
        expect(usdcBridgeUtils.calculateFee('100')).toBe('0.100000');
        expect(usdcBridgeUtils.calculateFee('1000')).toBe('1.000000');
        expect(usdcBridgeUtils.calculateFee('50')).toBe('0.050000');
      });

      it('should return 0 for invalid amounts', () => {
        expect(usdcBridgeUtils.calculateFee('0')).toBe('0');
        expect(usdcBridgeUtils.calculateFee('-100')).toBe('0');
        expect(usdcBridgeUtils.calculateFee('invalid')).toBe('0');
      });
    });

    describe('mapAxelarStatusToBridgeStatus', () => {
      it('should map pending statuses correctly', () => {
        expect(usdcBridgeUtils.mapAxelarStatusToBridgeStatus('source_gateway_called')).toBe('pending');
        expect(usdcBridgeUtils.mapAxelarStatusToBridgeStatus('approving')).toBe('pending');
        expect(usdcBridgeUtils.mapAxelarStatusToBridgeStatus('confirmed')).toBe('pending');
      });

      it('should map confirming statuses correctly', () => {
        expect(usdcBridgeUtils.mapAxelarStatusToBridgeStatus('destination_gateway_approved')).toBe('confirming');
        expect(usdcBridgeUtils.mapAxelarStatusToBridgeStatus('executing')).toBe('confirming');
      });

      it('should map complete statuses correctly', () => {
        expect(usdcBridgeUtils.mapAxelarStatusToBridgeStatus('destination_executed')).toBe('complete');
        expect(usdcBridgeUtils.mapAxelarStatusToBridgeStatus('express_executed')).toBe('complete');
      });

      it('should map failed statuses correctly', () => {
        expect(usdcBridgeUtils.mapAxelarStatusToBridgeStatus('error')).toBe('failed');
        expect(usdcBridgeUtils.mapAxelarStatusToBridgeStatus('unknown_error')).toBe('failed');
        expect(usdcBridgeUtils.mapAxelarStatusToBridgeStatus('insufficient_fee')).toBe('failed');
      });

      it('should map cannot_fetch_status to pending', () => {
        expect(usdcBridgeUtils.mapAxelarStatusToBridgeStatus('cannot_fetch_status')).toBe('pending');
      });
    });

    describe('getAxelarscanUrl', () => {
      it('should generate mainnet URL correctly', () => {
        const url = usdcBridgeUtils.getAxelarscanUrl('0x123', 'mainnet');
        expect(url).toBe('https://axelarscan.io/gmp/0x123');
      });

      it('should generate testnet URL correctly', () => {
        const url = usdcBridgeUtils.getAxelarscanUrl('0x123', 'testnet');
        expect(url).toBe('https://testnet.axelarscan.io/gmp/0x123');
      });

      it('should default to mainnet', () => {
        const url = usdcBridgeUtils.getAxelarscanUrl('0x123');
        expect(url).toBe('https://axelarscan.io/gmp/0x123');
      });
    });
  });

  // ===========================================================================
  // validateAddress
  // ===========================================================================

  describe('validateAddress', () => {
    it('should validate XRPL addresses', () => {
      expect(service.validateAddress('rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe', 'xrpl')).toBe(true);
      expect(service.validateAddress('invalid', 'xrpl')).toBe(false);
    });

    it('should validate EVM addresses', () => {
      expect(service.validateAddress('0x1234567890123456789012345678901234567890', 'evm')).toBe(true);
      expect(service.validateAddress('invalid', 'evm')).toBe(false);
    });
  });

  // ===========================================================================
  // Demo Mode
  // ===========================================================================

  describe('Demo Mode', () => {
    it('should be in demo mode by default', () => {
      expect(service.isDemoMode()).toBe(true);
    });

    it('should allow disabling demo mode', () => {
      service.setDemoMode(false);
      expect(service.isDemoMode()).toBe(false);
      service.setDemoMode(true);
    });

    it('should allow re-enabling demo mode', () => {
      service.setDemoMode(true);
      expect(service.isDemoMode()).toBe(true);
    });
  });

  // ===========================================================================
  // Axelar Environment
  // ===========================================================================

  describe('Axelar Environment', () => {
    it('should default to mainnet', () => {
      const config = service.getConfig();
      expect(config.axelarEnvironment).toBe('mainnet');
    });

    it('should allow setting testnet environment', () => {
      service.setAxelarEnvironment('testnet');
      const config = service.getConfig();
      expect(config.axelarEnvironment).toBe('testnet');
    });
  });

  // ===========================================================================
  // bridgeToEVM
  // ===========================================================================

  describe('bridgeToEVM', () => {
    const validXRPLAddress = 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe';
    const validEVMAddress = '0x1234567890123456789012345678901234567890';

    it('should return success with txHash for valid inputs', async () => {
      const promise = service.bridgeToEVM('100', validXRPLAddress, validEVMAddress);
      await vi.advanceTimersByTimeAsync(1500);
      const result = await promise;

      // May fail randomly due to 2% failure rate
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('txHash');

      if (result.success) {
        expect(result.txHash).not.toBeNull();
        expect(typeof result.txHash).toBe('string');
        expect(result.depositAddress).toBeDefined();
      }
    });

    it('should reject invalid XRPL address', async () => {
      const result = await service.bridgeToEVM('100', 'invalid', validEVMAddress);

      expect(result.success).toBe(false);
      expect(result.txHash).toBeNull();
      expect(result.error).toBe('Invalid XRPL address format');
    });

    it('should reject invalid EVM address', async () => {
      const result = await service.bridgeToEVM('100', validXRPLAddress, 'invalid');

      expect(result.success).toBe(false);
      expect(result.txHash).toBeNull();
      expect(result.error).toBe('Invalid EVM address format');
    });

    it('should reject invalid amount', async () => {
      const result = await service.bridgeToEVM('invalid', validXRPLAddress, validEVMAddress);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid amount');
    });

    it('should reject zero amount', async () => {
      const result = await service.bridgeToEVM('0', validXRPLAddress, validEVMAddress);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid amount');
    });

    it('should reject negative amount', async () => {
      const result = await service.bridgeToEVM('-50', validXRPLAddress, validEVMAddress);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid amount');
    });

    it('should reject amount below minimum', async () => {
      const result = await service.bridgeToEVM('2', validXRPLAddress, validEVMAddress); // 2 < 3 USDC min

      expect(result.success).toBe(false);
      expect(result.error).toContain('Minimum bridge amount');
    });
  });

  // ===========================================================================
  // bridgeToXRPL
  // ===========================================================================

  describe('bridgeToXRPL', () => {
    const validXRPLAddress = 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe';
    const validEVMAddress = '0x1234567890123456789012345678901234567890';

    it('should return success with txHash for valid inputs', async () => {
      const promise = service.bridgeToXRPL('100', validEVMAddress, validXRPLAddress);
      await vi.advanceTimersByTimeAsync(2000);
      const result = await promise;

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('txHash');

      if (result.success) {
        expect(result.txHash).not.toBeNull();
        expect(typeof result.txHash).toBe('string');
      }
    });

    it('should reject invalid EVM address', async () => {
      const result = await service.bridgeToXRPL('100', 'invalid', validXRPLAddress);

      expect(result.success).toBe(false);
      expect(result.txHash).toBeNull();
      expect(result.error).toBe('Invalid EVM address format');
    });

    it('should reject invalid XRPL address', async () => {
      const result = await service.bridgeToXRPL('100', validEVMAddress, 'invalid');

      expect(result.success).toBe(false);
      expect(result.txHash).toBeNull();
      expect(result.error).toBe('Invalid XRPL address format');
    });

    it('should reject invalid amount', async () => {
      const result = await service.bridgeToXRPL('invalid', validEVMAddress, validXRPLAddress);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid amount');
    });

    it('should reject amount below minimum', async () => {
      const result = await service.bridgeToXRPL('2', validEVMAddress, validXRPLAddress); // 2 < 3 USDC min

      expect(result.success).toBe(false);
      expect(result.error).toContain('Minimum bridge amount');
    });
  });

  // ===========================================================================
  // getBridgeStatus
  // ===========================================================================

  describe('getBridgeStatus', () => {
    const validXRPLAddress = 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe';
    const validEVMAddress = '0x1234567890123456789012345678901234567890';

    it('should return failed status for unknown txHash', async () => {
      const status = await service.getBridgeStatus('unknown-hash');

      expect(status.status).toBe('failed');
      expect(status.confirmations).toBe(0);
      expect(status.requiredConfirmations).toBe(0);
    });

    it('should return pending status initially for toEVM', async () => {
      const bridgePromise = service.bridgeToEVM('100', validXRPLAddress, validEVMAddress);
      await vi.advanceTimersByTimeAsync(1500);
      const result = await bridgePromise;

      if (result.success && result.txHash) {
        const status = await service.getBridgeStatus(result.txHash);

        expect(status.status).toBe('pending');
        expect(status.confirmations).toBe(0);
        expect(status.requiredConfirmations).toBe(6);
      }
    });

    it('should return pending status initially for toXRPL', async () => {
      const bridgePromise = service.bridgeToXRPL('100', validEVMAddress, validXRPLAddress);
      await vi.advanceTimersByTimeAsync(2000);
      const result = await bridgePromise;

      if (result.success && result.txHash) {
        const status = await service.getBridgeStatus(result.txHash);

        expect(status.status).toBe('pending');
        expect(status.confirmations).toBe(0);
        expect(status.requiredConfirmations).toBe(12);
      }
    });

    it('should progress confirmations over time', async () => {
      const bridgePromise = service.bridgeToEVM('100', validXRPLAddress, validEVMAddress);
      await vi.advanceTimersByTimeAsync(1500);
      const result = await bridgePromise;

      if (result.success && result.txHash) {
        let status = await service.getBridgeStatus(result.txHash);
        expect(status.confirmations).toBe(0);

        await vi.advanceTimersByTimeAsync(2000);
        status = await service.getBridgeStatus(result.txHash);
        expect(status.confirmations).toBe(1);

        await vi.advanceTimersByTimeAsync(4000);
        status = await service.getBridgeStatus(result.txHash);
        expect(status.confirmations).toBe(3);
        expect(status.status).toBe('confirming');
      }
    });

    it('should reach complete status after all confirmations', async () => {
      const bridgePromise = service.bridgeToEVM('100', validXRPLAddress, validEVMAddress);
      await vi.advanceTimersByTimeAsync(1500);
      const result = await bridgePromise;

      if (result.success && result.txHash) {
        await vi.advanceTimersByTimeAsync(12000);

        const status = await service.getBridgeStatus(result.txHash);
        expect(status.status).toBe('complete');
        expect(status.confirmations).toBe(6);
      }
    });
  });

  // ===========================================================================
  // getEstimate
  // ===========================================================================

  describe('getEstimate', () => {
    it('should return correct estimate for toEVM', async () => {
      const estimate = await service.getEstimate('100', 'toEVM');

      expect(estimate.fee).toBe('0.100000');
      expect(estimate.estimatedTime).toBe(25);
      expect(estimate.minimumAmount).toBe('3'); // 3 USDC minimum (matches pool denomination)
    });

    it('should return correct estimate for toXRPL', async () => {
      const estimate = await service.getEstimate('100', 'toXRPL');

      expect(estimate.fee).toBe('0.100000');
      expect(estimate.estimatedTime).toBe(30);
      expect(estimate.minimumAmount).toBe('3'); // 3 USDC minimum (matches pool denomination)
    });

    it('should calculate fee correctly for different amounts', async () => {
      let estimate = await service.getEstimate('1000', 'toEVM');
      expect(estimate.fee).toBe('1.000000');

      estimate = await service.getEstimate('50', 'toXRPL');
      expect(estimate.fee).toBe('0.050000');
    });
  });

  // ===========================================================================
  // getConfig
  // ===========================================================================

  describe('getConfig', () => {
    it('should return bridge configuration', () => {
      const config = service.getConfig();

      expect(config.feePercentage).toBe(0.001);
      expect(config.minimumAmount).toBe('3'); // 3 USDC minimum (matches pool denomination)
      expect(config.decimals).toBe(15);
      expect(config.tokenId).toBeDefined();
      expect(config.itsContract).toBeDefined();
      expect(config.axelarChainIds).toBeDefined();
      expect(config.axelarEnvironment).toBe('mainnet');
    });
  });

  // ===========================================================================
  // getTransaction
  // ===========================================================================

  describe('getTransaction', () => {
    const validXRPLAddress = 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe';
    const validEVMAddress = '0x1234567890123456789012345678901234567890';

    it('should return undefined for unknown txHash', () => {
      const tx = service.getTransaction('unknown');
      expect(tx).toBeUndefined();
    });

    it('should return transaction for known txHash', async () => {
      const bridgePromise = service.bridgeToEVM('100', validXRPLAddress, validEVMAddress);
      await vi.advanceTimersByTimeAsync(1500);
      const result = await bridgePromise;

      if (result.success && result.txHash) {
        const tx = service.getTransaction(result.txHash);
        expect(tx).toBeDefined();
        expect(tx?.txHash).toBe(result.txHash);
        expect(tx?.direction).toBe('toEVM');
        expect(tx?.amount).toBe('100');
      }
    });
  });

  // ===========================================================================
  // getPendingTransactions
  // ===========================================================================

  describe('getPendingTransactions', () => {
    const validXRPLAddress = 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe';
    const validEVMAddress = '0x1234567890123456789012345678901234567890';

    it('should return empty array when no pending transactions', () => {
      const pending = service.getPendingTransactions();
      expect(pending).toEqual([]);
    });

    it('should return pending transactions', async () => {
      const bridgePromise = service.bridgeToEVM('100', validXRPLAddress, validEVMAddress);
      await vi.advanceTimersByTimeAsync(1500);
      const result = await bridgePromise;

      if (result.success) {
        const pending = service.getPendingTransactions();
        expect(pending.length).toBeGreaterThan(0);
        expect(pending.some((tx) => tx.status === 'pending' || tx.status === 'confirming')).toBe(true);
      }
    });

    it('should not include completed transactions', async () => {
      const bridgePromise = service.bridgeToEVM('100', validXRPLAddress, validEVMAddress);
      await vi.advanceTimersByTimeAsync(1500);
      const result = await bridgePromise;

      if (result.success && result.txHash) {
        await vi.advanceTimersByTimeAsync(12000);

        const pending = service.getPendingTransactions();
        expect(pending.find((tx) => tx.txHash === result.txHash)).toBeUndefined();
      }
    });
  });

  // ===========================================================================
  // cleanup
  // ===========================================================================

  describe('cleanup', () => {
    const validXRPLAddress = 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe';
    const validEVMAddress = '0x1234567890123456789012345678901234567890';

    it('should stop polling intervals', async () => {
      const bridgePromise = service.bridgeToEVM('100', validXRPLAddress, validEVMAddress);
      await vi.advanceTimersByTimeAsync(1500);
      const result = await bridgePromise;

      if (result.success && result.txHash) {
        service.cleanup();

        const statusBefore = await service.getBridgeStatus(result.txHash);
        await vi.advanceTimersByTimeAsync(10000);
        const statusAfter = await service.getBridgeStatus(result.txHash);

        expect(statusAfter.confirmations).toBe(statusBefore.confirmations);
      }
    });
  });

  // ===========================================================================
  // Singleton Export
  // ===========================================================================

  describe('Singleton', () => {
    it('should export singleton instance', () => {
      expect(axelarUSDCBridgeService).toBeInstanceOf(AxelarUSDCBridgeService);
    });

    it('should have all service methods', () => {
      expect(typeof axelarUSDCBridgeService.bridgeToEVM).toBe('function');
      expect(typeof axelarUSDCBridgeService.bridgeToXRPL).toBe('function');
      expect(typeof axelarUSDCBridgeService.getBridgeStatus).toBe('function');
      expect(typeof axelarUSDCBridgeService.getEstimate).toBe('function');
      expect(typeof axelarUSDCBridgeService.getConfig).toBe('function');
      expect(typeof axelarUSDCBridgeService.validateAddress).toBe('function');
      expect(typeof axelarUSDCBridgeService.cleanup).toBe('function');
      expect(typeof axelarUSDCBridgeService.isDemoMode).toBe('function');
      expect(typeof axelarUSDCBridgeService.setDemoMode).toBe('function');
      expect(typeof axelarUSDCBridgeService.getTransaction).toBe('function');
      expect(typeof axelarUSDCBridgeService.getPendingTransactions).toBe('function');
      expect(typeof axelarUSDCBridgeService.getITSContractAddress).toBe('function');
      expect(typeof axelarUSDCBridgeService.getTokenAddress).toBe('function');
    });
  });
});
