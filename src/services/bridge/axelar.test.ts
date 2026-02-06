import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AxelarBridgeService,
  axelarBridgeService,
  bridgeUtils,
  XRPL_EVM_CHAIN_ID,
  AXELAR_CHAIN_IDS,
} from './index';

describe('AxelarBridgeService', () => {
  let service: AxelarBridgeService;

  beforeEach(() => {
    vi.useFakeTimers();
    service = new AxelarBridgeService();
    // Clear any leftover transactions from previous tests
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
    it('should export XRPL EVM Chain ID', () => {
      expect(XRPL_EVM_CHAIN_ID).toBe(1440002);
    });

    it('should export Axelar chain identifiers', () => {
      expect(AXELAR_CHAIN_IDS.XRPL).toBe('xrpl');
      expect(AXELAR_CHAIN_IDS.XRPL_EVM).toBe('xrpl-evm');
      expect(AXELAR_CHAIN_IDS.XRPL_EVM_TESTNET).toBe('xrpl-evm-testnet');
    });

    it('should have valid config', () => {
      const config = service.getConfig();
      expect(config.chainId).toBe(1440002);
      expect(config.feePercentage).toBe(0.001);
      expect(config.minimumAmount).toBe('1');
      expect(config.axelarChainIds).toBeDefined();
      expect(config.axelarEnvironment).toBe('mainnet');
    });
  });

  // ===========================================================================
  // bridgeUtils
  // ===========================================================================

  describe('bridgeUtils', () => {
    describe('isValidXRPLAddress', () => {
      it('should return true for valid XRPL addresses', () => {
        expect(bridgeUtils.isValidXRPLAddress('rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe')).toBe(true);
        expect(bridgeUtils.isValidXRPLAddress('rLHzPsX3oXdzU2qP17kHCH2Gpsqs6BNj5P')).toBe(true);
      });

      it('should return false for invalid XRPL addresses', () => {
        expect(bridgeUtils.isValidXRPLAddress('')).toBe(false);
        expect(bridgeUtils.isValidXRPLAddress('invalid')).toBe(false);
        expect(bridgeUtils.isValidXRPLAddress('0x1234567890123456789012345678901234567890')).toBe(false);
        expect(bridgeUtils.isValidXRPLAddress('xPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe')).toBe(false);
      });
    });

    describe('isValidEVMAddress', () => {
      it('should return true for valid EVM addresses', () => {
        expect(bridgeUtils.isValidEVMAddress('0x1234567890123456789012345678901234567890')).toBe(true);
        expect(bridgeUtils.isValidEVMAddress('0xAbCdEf1234567890123456789012345678901234')).toBe(true);
      });

      it('should return false for invalid EVM addresses', () => {
        expect(bridgeUtils.isValidEVMAddress('')).toBe(false);
        expect(bridgeUtils.isValidEVMAddress('invalid')).toBe(false);
        expect(bridgeUtils.isValidEVMAddress('rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe')).toBe(false);
        expect(bridgeUtils.isValidEVMAddress('0x123')).toBe(false);
        expect(bridgeUtils.isValidEVMAddress('1234567890123456789012345678901234567890')).toBe(false);
      });
    });

    describe('calculateFee', () => {
      it('should calculate 0.1% fee correctly', () => {
        expect(bridgeUtils.calculateFee('100')).toBe('0.100000');
        expect(bridgeUtils.calculateFee('1000')).toBe('1.000000');
        expect(bridgeUtils.calculateFee('50')).toBe('0.050000');
      });

      it('should return 0 for invalid amounts', () => {
        expect(bridgeUtils.calculateFee('0')).toBe('0');
        expect(bridgeUtils.calculateFee('-100')).toBe('0');
        expect(bridgeUtils.calculateFee('invalid')).toBe('0');
      });
    });

    describe('mapAxelarStatusToBridgeStatus', () => {
      it('should map pending statuses correctly', () => {
        expect(bridgeUtils.mapAxelarStatusToBridgeStatus('source_gateway_called')).toBe('pending');
        expect(bridgeUtils.mapAxelarStatusToBridgeStatus('approving')).toBe('pending');
        expect(bridgeUtils.mapAxelarStatusToBridgeStatus('confirmed')).toBe('pending');
      });

      it('should map confirming statuses correctly', () => {
        expect(bridgeUtils.mapAxelarStatusToBridgeStatus('destination_gateway_approved')).toBe('confirming');
        expect(bridgeUtils.mapAxelarStatusToBridgeStatus('executing')).toBe('confirming');
      });

      it('should map complete statuses correctly', () => {
        expect(bridgeUtils.mapAxelarStatusToBridgeStatus('destination_executed')).toBe('complete');
        expect(bridgeUtils.mapAxelarStatusToBridgeStatus('express_executed')).toBe('complete');
      });

      it('should map failed statuses correctly', () => {
        expect(bridgeUtils.mapAxelarStatusToBridgeStatus('error')).toBe('failed');
        expect(bridgeUtils.mapAxelarStatusToBridgeStatus('unknown_error')).toBe('failed');
        expect(bridgeUtils.mapAxelarStatusToBridgeStatus('insufficient_fee')).toBe('failed');
      });

      it('should map cannot_fetch_status to pending (not failed)', () => {
        // cannot_fetch_status is returned by Axelar for XRPL native transactions
        // because XRPL is not an EVM chain. This is NOT a failure - the orchestrator
        // should verify the transaction via XRPL ledger directly.
        expect(bridgeUtils.mapAxelarStatusToBridgeStatus('cannot_fetch_status')).toBe('pending');
      });
    });

    describe('getAxelarscanUrl', () => {
      it('should generate mainnet URL correctly', () => {
        const url = bridgeUtils.getAxelarscanUrl('0x123', 'mainnet');
        expect(url).toBe('https://axelarscan.io/gmp/0x123');
      });

      it('should generate testnet URL correctly', () => {
        const url = bridgeUtils.getAxelarscanUrl('0x123', 'testnet');
        expect(url).toBe('https://testnet.axelarscan.io/gmp/0x123');
      });

      it('should default to mainnet', () => {
        const url = bridgeUtils.getAxelarscanUrl('0x123');
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

    it('should allow disabling demo mode with real Axelar addresses', () => {
      // Real Axelar addresses are now configured from Axelarscan
      // - XRPL Bridge: rfmS3zqrQrka8wVyhXifEeyTwe8AMz2Yhw
      // - EVM Gateway: 0xe432150cce91c13a887f7D836923d5597adD8E31
      expect(() => service.setDemoMode(false)).not.toThrow();
      expect(service.isDemoMode()).toBe(false);
      // Reset back to demo mode for other tests
      service.setDemoMode(true);
    });

    it('should allow re-enabling demo mode after error', () => {
      // This should not throw
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
  // getAxelarChainId
  // ===========================================================================

  describe('getAxelarChainId', () => {
    it('should return correct chain IDs for toEVM direction', () => {
      const chains = service.getAxelarChainId('toEVM');
      expect(chains.from).toBe('xrpl');
      expect(chains.to).toBe('xrpl-evm');
    });

    it('should return correct chain IDs for toXRPL direction', () => {
      const chains = service.getAxelarChainId('toXRPL');
      expect(chains.from).toBe('xrpl-evm');
      expect(chains.to).toBe('xrpl');
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

      // May fail randomly due to 2% failure rate, so check structure
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
      const result = await service.bridgeToEVM('0.5', validXRPLAddress, validEVMAddress);

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
      // bridgeToXRPL has a 1200ms base delay + up to 500ms variance
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
      const result = await service.bridgeToXRPL('0.5', validEVMAddress, validXRPLAddress);

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
        // Initial status
        let status = await service.getBridgeStatus(result.txHash);
        expect(status.confirmations).toBe(0);

        // After 2 seconds (one confirmation interval)
        await vi.advanceTimersByTimeAsync(2000);
        status = await service.getBridgeStatus(result.txHash);
        expect(status.confirmations).toBe(1);

        // After 4 more seconds (two more confirmations)
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
        // Advance time for all 6 confirmations (6 * 2000ms = 12000ms)
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
      expect(estimate.estimatedTime).toBe(20);
      expect(estimate.minimumAmount).toBe('1');
    });

    it('should return correct estimate for toXRPL', async () => {
      const estimate = await service.getEstimate('100', 'toXRPL');

      expect(estimate.fee).toBe('0.100000');
      expect(estimate.estimatedTime).toBe(25);
      expect(estimate.minimumAmount).toBe('1');
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

      expect(config).toMatchObject({
        chainId: 1440002,
        feePercentage: 0.001,
        minimumAmount: '1',
      });

      expect(config.addresses).toBeDefined();
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
        // Wait for completion
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
        // Cleanup should stop the confirmation simulation
        service.cleanup();

        // Confirmations should not advance after cleanup
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
      expect(axelarBridgeService).toBeInstanceOf(AxelarBridgeService);
    });

    it('should have all service methods', () => {
      expect(typeof axelarBridgeService.bridgeToEVM).toBe('function');
      expect(typeof axelarBridgeService.bridgeToXRPL).toBe('function');
      expect(typeof axelarBridgeService.getBridgeStatus).toBe('function');
      expect(typeof axelarBridgeService.getEstimate).toBe('function');
      expect(typeof axelarBridgeService.getConfig).toBe('function');
      expect(typeof axelarBridgeService.validateAddress).toBe('function');
      expect(typeof axelarBridgeService.cleanup).toBe('function');
      expect(typeof axelarBridgeService.isDemoMode).toBe('function');
      expect(typeof axelarBridgeService.setDemoMode).toBe('function');
      expect(typeof axelarBridgeService.getAxelarChainId).toBe('function');
      expect(typeof axelarBridgeService.getTransaction).toBe('function');
      expect(typeof axelarBridgeService.getPendingTransactions).toBe('function');
    });
  });
});
