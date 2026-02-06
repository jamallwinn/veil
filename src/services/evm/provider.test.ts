import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EVMProviderService, evmProviderService } from './provider';
import { CHAIN_IDS, XRPL_EVM_MAINNET } from '@constants/chains';

// Mock ethers
vi.mock('ethers', () => {
  const createMockProvider = () => ({
    getNetwork: vi.fn().mockResolvedValue({
      chainId: BigInt(1440000), // XRPL EVM Mainnet
      name: 'xrpl-evm',
    }),
    getBlockNumber: vi.fn().mockResolvedValue(12345678),
    getBalance: vi.fn().mockResolvedValue(BigInt('1000000000000000000')),
    destroy: vi.fn(),
  });

  return {
    JsonRpcProvider: vi.fn().mockImplementation(() => createMockProvider()),
    Network: {
      from: vi.fn().mockReturnValue({
        chainId: BigInt(1440000), // XRPL EVM Mainnet
        name: 'xrpl-evm',
      }),
    },
    formatUnits: vi.fn((value: bigint, decimals: number) => {
      return (Number(value) / Math.pow(10, decimals)).toString();
    }),
    parseUnits: vi.fn((value: string, decimals: number) => {
      return BigInt(Math.floor(parseFloat(value) * Math.pow(10, decimals)));
    }),
    isAddress: vi.fn((addr: string) => /^0x[a-fA-F0-9]{40}$/.test(addr)),
  };
});

describe('EVMProviderService', () => {
  let service: EVMProviderService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new EVMProviderService();
  });

  afterEach(() => {
    service.destroy();
  });

  // ===========================================================================
  // Constructor
  // ===========================================================================

  describe('constructor', () => {
    it('should create service with default XRPL EVM Mainnet config', () => {
      const config = service.getChainConfig();
      expect(config.chainId).toBe(CHAIN_IDS.XRPL_EVM_MAINNET);
      expect(config.name).toBe('XRPL EVM Mainnet');
    });

    it('should accept custom chain ID for XRPL EVM Devnet', () => {
      const devnetService = new EVMProviderService({
        chainId: CHAIN_IDS.XRPL_EVM_DEVNET,
      });
      // All chains fall back to mainnet config now
      expect(devnetService.getChainConfig().chainId).toBe(CHAIN_IDS.XRPL_EVM_MAINNET);
      devnetService.destroy();
    });

    it('should throw error for unsupported chain ID', () => {
      expect(() => new EVMProviderService({ chainId: 1 })).toThrow('Unsupported chain ID');
    });

    it('should accept custom RPC URL', () => {
      const customService = new EVMProviderService({
        chainId: CHAIN_IDS.XRPL_EVM_MAINNET,
        rpcUrl: 'https://custom-rpc.example.com',
      });
      expect(customService.getRpcUrl()).toBe('https://custom-rpc.example.com');
      customService.destroy();
    });
  });

  // ===========================================================================
  // getProvider
  // ===========================================================================

  describe('getProvider', () => {
    it('should return a JsonRpcProvider instance', () => {
      const provider = service.getProvider();
      expect(provider).toBeDefined();
      expect(typeof provider.getNetwork).toBe('function');
    });

    it('should return the same provider instance on multiple calls', () => {
      const provider1 = service.getProvider();
      const provider2 = service.getProvider();
      expect(provider1).toBe(provider2);
    });
  });

  // ===========================================================================
  // checkConnection
  // ===========================================================================

  describe('checkConnection', () => {
    it('should return connected status with chain ID and block number', async () => {
      const status = await service.checkConnection();

      expect(status.connected).toBe(true);
      expect(status.chainId).toBe(1440000); // XRPL EVM Mainnet
      expect(status.blockNumber).toBe(12345678);
      expect(status.error).toBeUndefined();
    });

    it('should include RPC URL in status', async () => {
      const status = await service.checkConnection();
      expect(status.rpcUrl).toBe(XRPL_EVM_MAINNET.rpcUrls.default);
    });

    it('should report chain ID mismatch', async () => {
      // Create a service and override the provider's getNetwork response
      const newService = new EVMProviderService();
      const provider = newService.getProvider();

      // Override the getNetwork mock for this specific provider
      (provider.getNetwork as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        chainId: BigInt(999),
        name: 'wrong-chain',
      });

      const status = await newService.checkConnection();

      expect(status.connected).toBe(false);
      expect(status.error).toContain('Chain ID mismatch');
      newService.destroy();
    });
  });

  // ===========================================================================
  // healthCheck
  // ===========================================================================

  describe('healthCheck', () => {
    it('should return true when connected', async () => {
      const healthy = await service.healthCheck();
      expect(healthy).toBe(true);
    });
  });

  // ===========================================================================
  // getBlockNumber
  // ===========================================================================

  describe('getBlockNumber', () => {
    it('should return current block number', async () => {
      const blockNumber = await service.getBlockNumber();
      expect(blockNumber).toBe(12345678);
    });
  });

  // ===========================================================================
  // getChainConfig
  // ===========================================================================

  describe('getChainConfig', () => {
    it('should return chain configuration', () => {
      const config = service.getChainConfig();

      expect(config.chainId).toBe(1440000); // XRPL EVM Mainnet
      expect(config.name).toBe('XRPL EVM Mainnet');
      expect(config.nativeCurrency.symbol).toBe('XRP');
      expect(config.nativeCurrency.decimals).toBe(18);
    });
  });

  // ===========================================================================
  // getRpcUrl
  // ===========================================================================

  describe('getRpcUrl', () => {
    it('should return current RPC URL', () => {
      const rpcUrl = service.getRpcUrl();
      expect(rpcUrl).toBe(XRPL_EVM_MAINNET.rpcUrls.default);
    });
  });

  // ===========================================================================
  // destroy
  // ===========================================================================

  describe('destroy', () => {
    it('should destroy provider and allow recreation', () => {
      const provider1 = service.getProvider();
      service.destroy();
      const provider2 = service.getProvider();

      // After destroy, a new provider should be created
      expect(provider1).not.toBe(provider2);
    });
  });

  // ===========================================================================
  // reconnect
  // ===========================================================================

  describe('reconnect', () => {
    it('should destroy and recreate provider', async () => {
      const provider1 = service.getProvider();
      const status = await service.reconnect();

      expect(status.connected).toBe(true);
      const provider2 = service.getProvider();
      expect(provider1).not.toBe(provider2);
    });
  });

  // ===========================================================================
  // switchRpcUrl
  // ===========================================================================

  describe('switchRpcUrl', () => {
    it('should switch to new RPC URL', async () => {
      const newUrl = 'https://new-rpc.example.com';
      await service.switchRpcUrl(newUrl);

      expect(service.getRpcUrl()).toBe(newUrl);
    });
  });

  // ===========================================================================
  // Singleton Export
  // ===========================================================================

  describe('Singleton', () => {
    it('should export singleton instance', () => {
      expect(evmProviderService).toBeInstanceOf(EVMProviderService);
    });

    it('should have all service methods', () => {
      expect(typeof evmProviderService.getProvider).toBe('function');
      expect(typeof evmProviderService.checkConnection).toBe('function');
      expect(typeof evmProviderService.healthCheck).toBe('function');
      expect(typeof evmProviderService.getBlockNumber).toBe('function');
      expect(typeof evmProviderService.getChainConfig).toBe('function');
      expect(typeof evmProviderService.getRpcUrl).toBe('function');
      expect(typeof evmProviderService.destroy).toBe('function');
      expect(typeof evmProviderService.reconnect).toBe('function');
      expect(typeof evmProviderService.switchRpcUrl).toBe('function');
    });
  });
});
