import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  RailgunService,
  railgunService,
  railgunUtils,
  shieldService,
  shieldUtils,
  XRPL_EVM_CHAIN_ID,
  RAILGUN_CONTRACTS,
  RAILGUN_ERROR_CODES,
} from './index';
import type { ShieldParams } from './types';

// Mock EVM provider service
vi.mock('@services/evm/provider', () => ({
  evmProviderService: {
    getProvider: vi.fn().mockReturnValue({
      getCode: vi.fn().mockResolvedValue('0x'),
      getBlockNumber: vi.fn().mockResolvedValue(1000000),
    }),
    checkConnection: vi.fn().mockResolvedValue({
      connected: true,
      chainId: 1440002,
      blockNumber: 1000000,
      rpcUrl: 'https://rpc-evm-sidechain.xrpl.org',
    }),
    getBlockNumber: vi.fn().mockResolvedValue(1000000),
  },
}));

// Mock secure storage service
vi.mock('@services/secure-storage', () => ({
  secureStorageService: {
    store: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    storeJSON: vi.fn().mockResolvedValue(undefined),
    getJSON: vi.fn().mockResolvedValue(null),
    has: vi.fn().mockResolvedValue(false),
    delete: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('RailgunService', () => {
  let service: RailgunService;

  beforeEach(() => {
    vi.useFakeTimers();
    service = new RailgunService();
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

    it('should export RAILGUN contract addresses', () => {
      expect(RAILGUN_CONTRACTS).toHaveProperty('PROXY');
      expect(RAILGUN_CONTRACTS).toHaveProperty('RELAY_ADAPT');
    });

    it('should export error codes', () => {
      expect(RAILGUN_ERROR_CODES.ENGINE_NOT_INITIALIZED).toBe('ENGINE_NOT_INITIALIZED');
      expect(RAILGUN_ERROR_CODES.WALLET_NOT_LOADED).toBe('WALLET_NOT_LOADED');
      expect(RAILGUN_ERROR_CODES.INVALID_ZK_ADDRESS).toBe('INVALID_ZK_ADDRESS');
    });
  });

  // ===========================================================================
  // Engine Lifecycle
  // ===========================================================================

  describe('Engine Lifecycle', () => {
    it('should start with uninitialized status', () => {
      expect(service.getEngineStatus()).toBe('uninitialized');
      expect(service.isEngineReady()).toBe(false);
    });

    it('should initialize engine successfully', async () => {
      const initPromise = service.initializeEngine();
      await vi.advanceTimersByTimeAsync(1000);
      await initPromise;

      expect(service.getEngineStatus()).toBe('ready');
      expect(service.isEngineReady()).toBe(true);
    });

    it('should not re-initialize if already ready', async () => {
      // First initialization
      const init1 = service.initializeEngine();
      await vi.advanceTimersByTimeAsync(1000);
      await init1;

      // Second initialization should be a no-op
      const init2 = service.initializeEngine();
      await vi.advanceTimersByTimeAsync(1000);
      await init2;

      expect(service.isEngineReady()).toBe(true);
    });

    it('should be in demo mode by default', async () => {
      expect(service.isDemoMode()).toBe(true);
    });

    it('should toggle demo mode', () => {
      service.setDemoMode(false);
      expect(service.isDemoMode()).toBe(false);

      service.setDemoMode(true);
      expect(service.isDemoMode()).toBe(true);
    });
  });

  // ===========================================================================
  // Wallet Management
  // ===========================================================================

  describe('Wallet Management', () => {
    beforeEach(async () => {
      const init = service.initializeEngine();
      await vi.advanceTimersByTimeAsync(1000);
      await init;
    });

    it('should throw if creating wallet without engine initialized', async () => {
      const uninitService = new RailgunService();
      await expect(uninitService.createWallet('password123')).rejects.toMatchObject({
        code: 'ENGINE_NOT_INITIALIZED',
      });
    });

    it('should throw for short encryption key', async () => {
      await expect(service.createWallet('short')).rejects.toMatchObject({
        code: 'ENCRYPTION_ERROR',
      });
    });

    it('should create demo wallet with valid encryption key', async () => {
      const wallet = await service.createWallet('my-secure-password');

      expect(wallet).toHaveProperty('id');
      expect(wallet).toHaveProperty('zkAddress');
      expect(wallet.zkAddress).toMatch(/^0zk[a-fA-F0-9]{120,}$/);
      expect(wallet.isLoaded).toBe(true);
      expect(wallet.createdAt).toBeGreaterThan(0);
    });

    it('should get current wallet after creation', async () => {
      await service.createWallet('my-secure-password');
      const wallet = service.getCurrentWallet();

      expect(wallet).not.toBeNull();
      expect(wallet?.zkAddress).toMatch(/^0zk/);
    });

    it('should unload wallet', async () => {
      await service.createWallet('my-secure-password');
      expect(service.getCurrentWallet()).not.toBeNull();

      service.unloadWallet();
      expect(service.getCurrentWallet()).toBeNull();
    });

    it('should check for stored wallet', async () => {
      const hasWallet = await service.hasStoredWallet();
      expect(typeof hasWallet).toBe('boolean');
    });
  });

  // ===========================================================================
  // Balance & Scanning
  // ===========================================================================

  describe('Balance & Scanning', () => {
    beforeEach(async () => {
      const init = service.initializeEngine();
      await vi.advanceTimersByTimeAsync(1000);
      await init;
      await service.createWallet('my-secure-password');
    });

    it('should throw if getting balance without wallet', async () => {
      service.unloadWallet();
      await expect(
        service.getShieldedBalance('0x0000000000000000000000000000000000000000')
      ).rejects.toMatchObject({
        code: 'WALLET_NOT_LOADED',
      });
    });

    it('should return zero balance initially', async () => {
      const balance = await service.getShieldedBalance(
        '0x0000000000000000000000000000000000000000'
      );
      expect(balance).toBe(BigInt(0));
    });

    it('should get all shielded balances', () => {
      const balances = service.getAllShieldedBalances();
      expect(Array.isArray(balances)).toBe(true);
    });

    it('should get scan progress', () => {
      const progress = service.getScanProgress();
      expect(progress).toHaveProperty('status');
      expect(progress).toHaveProperty('progress');
      expect(progress).toHaveProperty('lastScannedBlock');
    });

    it('should scan balances in demo mode', async () => {
      const scanPromise = service.scanBalances();
      await vi.advanceTimersByTimeAsync(2000);
      await scanPromise;

      const progress = service.getScanProgress();
      expect(progress.status).toBe('complete');
      expect(progress.progress).toBe(100);
    });
  });

  // ===========================================================================
  // UTXO Management
  // ===========================================================================

  describe('UTXO Management', () => {
    beforeEach(async () => {
      const init = service.initializeEngine();
      await vi.advanceTimersByTimeAsync(1000);
      await init;
      await service.createWallet('my-secure-password');
    });

    it('should get empty UTXOs initially', () => {
      const utxos = service.getUTXOs();
      expect(Array.isArray(utxos)).toBe(true);
      expect(utxos.length).toBe(0);
    });

    it('should get UTXOs for specific token', () => {
      const utxos = service.getUTXOsForToken('0x0000000000000000000000000000000000000000');
      expect(Array.isArray(utxos)).toBe(true);
    });
  });

  // ===========================================================================
  // Configuration
  // ===========================================================================

  describe('Configuration', () => {
    it('should get service configuration', () => {
      const config = service.getConfig();
      expect(config).toHaveProperty('network');
      expect(config).toHaveProperty('debugMode');
      expect(config).toHaveProperty('pollingInterval');
      expect(config).toHaveProperty('requiredConfirmations');
    });

    it('should get network configuration', () => {
      const network = service.getNetworkConfig();
      expect(network.chainId).toBe(1440002);
      expect(network.networkName).toBe('XRPL EVM Sidechain');
    });

    it('should check connection', async () => {
      const isConnected = await service.checkConnection();
      expect(typeof isConnected).toBe('boolean');
    });
  });

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  describe('Cleanup', () => {
    it('should cleanup resources', async () => {
      const init = service.initializeEngine();
      await vi.advanceTimersByTimeAsync(1000);
      await init;
      await service.createWallet('my-secure-password');

      service.cleanup();

      expect(service.getEngineStatus()).toBe('uninitialized');
      expect(service.getCurrentWallet()).toBeNull();
    });
  });

  // ===========================================================================
  // Singleton Export
  // ===========================================================================

  describe('Singleton', () => {
    it('should export singleton instance', () => {
      expect(railgunService).toBeInstanceOf(RailgunService);
    });

    it('should have all service methods', () => {
      expect(typeof railgunService.initializeEngine).toBe('function');
      expect(typeof railgunService.createWallet).toBe('function');
      expect(typeof railgunService.loadWallet).toBe('function');
      expect(typeof railgunService.getShieldedBalance).toBe('function');
      expect(typeof railgunService.scanBalances).toBe('function');
      expect(typeof railgunService.cleanup).toBe('function');
    });
  });
});

// =============================================================================
// Shield Service Tests
// =============================================================================

describe('ShieldService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    shieldService.cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // ===========================================================================
  // shieldUtils
  // ===========================================================================

  describe('shieldUtils', () => {
    describe('isValidZkAddress', () => {
      it('should return true for valid 0zk addresses', () => {
        const validAddress = '0zk' + 'a'.repeat(128);
        expect(shieldUtils.isValidZkAddress(validAddress)).toBe(true);
      });

      it('should return false for invalid addresses', () => {
        expect(shieldUtils.isValidZkAddress('')).toBe(false);
        expect(shieldUtils.isValidZkAddress('invalid')).toBe(false);
        expect(shieldUtils.isValidZkAddress('0x1234')).toBe(false);
        expect(shieldUtils.isValidZkAddress('0zk' + 'a'.repeat(10))).toBe(false); // Too short
      });
    });

    describe('formatShieldAmount', () => {
      it('should format amount correctly', () => {
        const amount = BigInt('1000000000000000000'); // 1 wXRP
        expect(shieldUtils.formatShieldAmount(amount)).toBe('1.0');
      });
    });

    describe('parseShieldAmount', () => {
      it('should parse amount correctly', () => {
        const amount = shieldUtils.parseShieldAmount('1.5');
        expect(amount).toBe(BigInt('1500000000000000000'));
      });
    });

    describe('meetsMinimumAmount', () => {
      it('should return true for amounts >= 0.1 wXRP', () => {
        const amount = shieldUtils.parseShieldAmount('0.1');
        expect(shieldUtils.meetsMinimumAmount(amount)).toBe(true);
      });

      it('should return false for amounts < 0.1 wXRP', () => {
        const amount = shieldUtils.parseShieldAmount('0.05');
        expect(shieldUtils.meetsMinimumAmount(amount)).toBe(false);
      });
    });
  });

  // ===========================================================================
  // Shield Validation
  // ===========================================================================

  describe('Shield Validation', () => {
    const validParams: ShieldParams = {
      tokenAddress: '0x0000000000000000000000000000000000000000',
      amount: BigInt('1000000000000000000'), // 1 wXRP
      recipientAddress: '0zk' + 'a'.repeat(128),
    };

    it('should validate valid shield params', () => {
      const error = shieldService.validateShieldParams(validParams);
      expect(error).toBeNull();
    });

    it('should reject invalid token address', () => {
      const error = shieldService.validateShieldParams({
        ...validParams,
        tokenAddress: 'invalid',
      });
      expect(error).not.toBeNull();
      expect(error?.code).toBe('INVALID_TOKEN_ADDRESS');
    });

    it('should reject zero amount', () => {
      const error = shieldService.validateShieldParams({
        ...validParams,
        amount: BigInt(0),
      });
      expect(error).not.toBeNull();
      expect(error?.code).toBe('INSUFFICIENT_BALANCE');
    });

    it('should reject amount below minimum', () => {
      const error = shieldService.validateShieldParams({
        ...validParams,
        amount: BigInt('10000000000000000'), // 0.01 wXRP
      });
      expect(error).not.toBeNull();
      expect(error?.code).toBe('INSUFFICIENT_BALANCE');
    });

    it('should reject invalid 0zk address', () => {
      const error = shieldService.validateShieldParams({
        ...validParams,
        recipientAddress: 'invalid-address',
      });
      expect(error).not.toBeNull();
      expect(error?.code).toBe('INVALID_ZK_ADDRESS');
    });
  });

  // ===========================================================================
  // Shield Operation
  // ===========================================================================

  describe('Shield Operation', () => {
    const validParams: ShieldParams = {
      tokenAddress: '0x0000000000000000000000000000000000000000',
      amount: BigInt('1000000000000000000'),
      recipientAddress: '0zk' + 'a'.repeat(128),
    };

    it('should be in demo mode by default', () => {
      expect(shieldService.isDemoMode()).toBe(true);
    });

    it('should simulate shield in demo mode', async () => {
      const shieldPromise = shieldService.shield(validParams);
      await vi.advanceTimersByTimeAsync(3000);
      const result = await shieldPromise;

      // May succeed or fail (98% success rate)
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('txHash');

      if (result.success) {
        expect(result.txHash).toMatch(/^0x[a-f0-9]{64}$/);
      }
    });

    it('should return error for invalid params', async () => {
      const result = await shieldService.shield({
        ...validParams,
        tokenAddress: 'invalid',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid token address');
    });

    it('should track shield transactions', async () => {
      const shieldPromise = shieldService.shield(validParams);
      await vi.advanceTimersByTimeAsync(3000);
      const result = await shieldPromise;

      if (result.success && result.txHash) {
        const tracked = shieldService.getShieldTransaction(result.txHash);
        expect(tracked).not.toBeNull();
        expect(tracked?.status).toMatch(/pending|confirming/);
      }
    });

    it('should get all active transactions', async () => {
      const transactions = shieldService.getActiveTransactions();
      expect(Array.isArray(transactions)).toBe(true);
    });
  });

  // ===========================================================================
  // Gas Estimation
  // ===========================================================================

  describe('Gas Estimation', () => {
    const validParams: ShieldParams = {
      tokenAddress: '0x0000000000000000000000000000000000000000',
      amount: BigInt('1000000000000000000'),
      recipientAddress: '0zk' + 'a'.repeat(128),
    };

    it('should estimate gas for valid params', async () => {
      const gas = await shieldService.estimateShieldGas(validParams);
      expect(gas).toBeGreaterThan(BigInt(0));
    });

    it('should throw for invalid params', async () => {
      await expect(
        shieldService.estimateShieldGas({
          ...validParams,
          tokenAddress: 'invalid',
        })
      ).rejects.toMatchObject({ code: 'INVALID_TOKEN_ADDRESS' });
    });
  });

  // ===========================================================================
  // Contract Deployment Check
  // ===========================================================================

  describe('Contract Deployment', () => {
    it('should check if contract is deployed', async () => {
      const isDeployed = await shieldService.isContractDeployed();
      // Should return false since placeholder address is zero address
      expect(isDeployed).toBe(false);
    });
  });
});

// =============================================================================
// Utility Functions Tests
// =============================================================================

describe('railgunUtils', () => {
  it('should validate 0zk addresses', () => {
    expect(railgunUtils.isValidZkAddress('0zk' + 'a'.repeat(128))).toBe(true);
    expect(railgunUtils.isValidZkAddress('invalid')).toBe(false);
  });

  it('should format wXRP', () => {
    const formatted = railgunUtils.formatWXRP(BigInt('1000000000000000000'));
    expect(formatted).toBe('1.0');
  });

  it('should parse wXRP', () => {
    const parsed = railgunUtils.parseWXRP('1.0');
    expect(parsed).toBe(BigInt('1000000000000000000'));
  });

  it('should get chain ID', () => {
    expect(railgunUtils.getChainId()).toBe(1440002);
  });

  it('should check RAILGUN availability', async () => {
    const isAvailable = await railgunUtils.isRailgunAvailable();
    expect(typeof isAvailable).toBe('boolean');
  });
});
