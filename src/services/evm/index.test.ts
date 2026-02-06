import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  EVMService,
  evmService,
  evmUtils,
  EVM_ERROR_CODES,
} from './index';

// Mock ethers
vi.mock('ethers', () => {
  const mockNetwork = {
    chainId: BigInt(1440000), // XRPL EVM Mainnet
    name: 'xrpl-evm',
  };

  const mockFeeData = {
    gasPrice: BigInt('1000000000'), // 1 gwei
    maxFeePerGas: null,
    maxPriorityFeePerGas: null,
  };

  const mockReceipt = {
    hash: '0x1234567890123456789012345678901234567890123456789012345678901234',
    status: 1,
    blockNumber: 12345678,
  };

  const mockProvider = {
    getNetwork: vi.fn().mockResolvedValue(mockNetwork),
    getBlockNumber: vi.fn().mockResolvedValue(12345678),
    getBalance: vi.fn().mockResolvedValue(BigInt('1000000000000000000')), // 1 wXRP
    estimateGas: vi.fn().mockResolvedValue(BigInt(21000)),
    getFeeData: vi.fn().mockResolvedValue(mockFeeData),
    waitForTransaction: vi.fn().mockResolvedValue(mockReceipt),
    getTransactionReceipt: vi.fn().mockResolvedValue(mockReceipt),
    destroy: vi.fn(),
  };

  return {
    JsonRpcProvider: vi.fn().mockImplementation(() => mockProvider),
    Network: {
      from: vi.fn().mockReturnValue(mockNetwork),
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

describe('EVMService', () => {
  let service: EVMService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new EVMService();
  });

  afterEach(() => {
    service.destroy();
  });

  // ===========================================================================
  // isValidAddress
  // ===========================================================================

  describe('isValidAddress', () => {
    it('should return true for valid EVM addresses', () => {
      expect(service.isValidAddress('0x1234567890123456789012345678901234567890')).toBe(true);
      expect(service.isValidAddress('0xAbCdEf1234567890123456789012345678901234')).toBe(true);
    });

    it('should return false for invalid EVM addresses', () => {
      expect(service.isValidAddress('')).toBe(false);
      expect(service.isValidAddress('invalid')).toBe(false);
      expect(service.isValidAddress('0x123')).toBe(false);
      expect(service.isValidAddress('rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe')).toBe(false);
    });
  });

  // ===========================================================================
  // getBalance
  // ===========================================================================

  describe('getBalance', () => {
    const validAddress = '0x1234567890123456789012345678901234567890';

    it('should return balance for valid address', async () => {
      const balance = await service.getBalance(validAddress);

      expect(balance.raw).toBe(BigInt('1000000000000000000'));
      expect(balance.formatted).toBe('1');
      expect(balance.symbol).toBe('XRP');
    });

    it('should throw error for invalid address', async () => {
      await expect(service.getBalance('invalid')).rejects.toEqual(
        expect.objectContaining({
          code: EVM_ERROR_CODES.INVALID_ADDRESS,
        })
      );
    });
  });

  // ===========================================================================
  // getFormattedBalance
  // ===========================================================================

  describe('getFormattedBalance', () => {
    const validAddress = '0x1234567890123456789012345678901234567890';

    it('should return formatted balance with default decimals', async () => {
      const balance = await service.getFormattedBalance(validAddress);
      expect(balance).toBe('1.000000');
    });

    it('should return formatted balance with custom decimals', async () => {
      const balance = await service.getFormattedBalance(validAddress, 2);
      expect(balance).toBe('1.00');
    });
  });

  // ===========================================================================
  // estimateGas
  // ===========================================================================

  describe('estimateGas', () => {
    it('should return gas estimate', async () => {
      const gas = await service.estimateGas({
        to: '0x1234567890123456789012345678901234567890',
        value: BigInt('1000000000000000000'),
      });

      expect(gas).toBe(BigInt(21000));
    });
  });

  // ===========================================================================
  // getGasPrice
  // ===========================================================================

  describe('getGasPrice', () => {
    it('should return current gas price', async () => {
      const gasPrice = await service.getGasPrice();
      expect(gasPrice).toBe(BigInt('1000000000'));
    });
  });

  // ===========================================================================
  // waitForTransaction
  // ===========================================================================

  describe('waitForTransaction', () => {
    it('should wait for transaction receipt', async () => {
      const txHash = '0x1234567890123456789012345678901234567890123456789012345678901234';
      const receipt = await service.waitForTransaction(txHash);

      expect(receipt).toBeDefined();
      expect(receipt?.status).toBe(1);
    });
  });

  // ===========================================================================
  // getTransactionReceipt
  // ===========================================================================

  describe('getTransactionReceipt', () => {
    it('should return transaction receipt', async () => {
      const txHash = '0x1234567890123456789012345678901234567890123456789012345678901234';
      const receipt = await service.getTransactionReceipt(txHash);

      expect(receipt).toBeDefined();
      expect(receipt?.blockNumber).toBe(12345678);
    });
  });

  // ===========================================================================
  // checkConnection
  // ===========================================================================

  describe('checkConnection', () => {
    it('should return connection status', async () => {
      const status = await service.checkConnection();

      expect(status.connected).toBe(true);
      expect(status.chainId).toBe(1440000); // XRPL EVM Mainnet
    });
  });

  // ===========================================================================
  // healthCheck
  // ===========================================================================

  describe('healthCheck', () => {
    it('should return health status', async () => {
      const healthy = await service.healthCheck();
      expect(healthy).toBe(true);
    });
  });

  // ===========================================================================
  // getChainConfig
  // ===========================================================================

  describe('getChainConfig', () => {
    it('should return chain configuration', () => {
      const config = service.getChainConfig();

      expect(config.chainId).toBe(1440000); // XRPL EVM Mainnet
      expect(config.nativeCurrency.symbol).toBe('XRP');
    });
  });

  // ===========================================================================
  // parseWXRP / formatWXRP
  // ===========================================================================

  describe('parseWXRP', () => {
    it('should parse wXRP amount to wei', () => {
      const wei = service.parseWXRP('1');
      expect(wei).toBe(BigInt('1000000000000000000'));
    });

    it('should handle decimal amounts', () => {
      const wei = service.parseWXRP('0.5');
      expect(wei).toBe(BigInt('500000000000000000'));
    });
  });

  describe('formatWXRP', () => {
    it('should format wei to wXRP', () => {
      const wxrp = service.formatWXRP(BigInt('1000000000000000000'));
      expect(wxrp).toBe('1');
    });
  });

  // ===========================================================================
  // destroy
  // ===========================================================================

  describe('destroy', () => {
    it('should cleanup provider resources', () => {
      // Just ensure it doesn't throw
      expect(() => service.destroy()).not.toThrow();
    });
  });

  // ===========================================================================
  // evmUtils
  // ===========================================================================

  describe('evmUtils', () => {
    it('should export isValidAddress', () => {
      expect(typeof evmUtils.isValidAddress).toBe('function');
      expect(evmUtils.isValidAddress('0x1234567890123456789012345678901234567890')).toBe(true);
    });

    it('should export parseWXRP', () => {
      expect(typeof evmUtils.parseWXRP).toBe('function');
      const wei = evmUtils.parseWXRP('1');
      expect(wei).toBe(BigInt('1000000000000000000'));
    });

    it('should export formatWXRP', () => {
      expect(typeof evmUtils.formatWXRP).toBe('function');
      const wxrp = evmUtils.formatWXRP(BigInt('1000000000000000000'));
      expect(wxrp).toBe('1');
    });
  });

  // ===========================================================================
  // EVM_ERROR_CODES
  // ===========================================================================

  describe('EVM_ERROR_CODES', () => {
    it('should export error code constants', () => {
      expect(EVM_ERROR_CODES.INVALID_ADDRESS).toBe('INVALID_ADDRESS');
      expect(EVM_ERROR_CODES.PROVIDER_ERROR).toBe('PROVIDER_ERROR');
      expect(EVM_ERROR_CODES.INSUFFICIENT_BALANCE).toBe('INSUFFICIENT_BALANCE');
      expect(EVM_ERROR_CODES.TRANSACTION_FAILED).toBe('TRANSACTION_FAILED');
      expect(EVM_ERROR_CODES.CONNECTION_ERROR).toBe('CONNECTION_ERROR');
    });
  });

  // ===========================================================================
  // Singleton Export
  // ===========================================================================

  describe('Singleton', () => {
    it('should export singleton instance', () => {
      expect(evmService).toBeInstanceOf(EVMService);
    });

    it('should have all service methods', () => {
      expect(typeof evmService.isValidAddress).toBe('function');
      expect(typeof evmService.getBalance).toBe('function');
      expect(typeof evmService.getFormattedBalance).toBe('function');
      expect(typeof evmService.estimateGas).toBe('function');
      expect(typeof evmService.getGasPrice).toBe('function');
      expect(typeof evmService.waitForTransaction).toBe('function');
      expect(typeof evmService.getTransactionReceipt).toBe('function');
      expect(typeof evmService.checkConnection).toBe('function');
      expect(typeof evmService.healthCheck).toBe('function');
      expect(typeof evmService.getChainConfig).toBe('function');
      expect(typeof evmService.parseWXRP).toBe('function');
      expect(typeof evmService.formatWXRP).toBe('function');
      expect(typeof evmService.destroy).toBe('function');
    });
  });
});
