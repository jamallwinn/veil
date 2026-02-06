import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock constants - must be defined before mocks that use them
const mockWalletAddress = '0x1234567890123456789012345678901234567890';
const mockPrivateKey = '0x1234567890123456789012345678901234567890123456789012345678901234';
const mockSignedTx = '0xsignedtransaction';
const mockSignature = '0xsignature';

// Mock secure storage service object
const mockSecureStorage = {
  store: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
  has: vi.fn(),
};

// Aliases for compatibility
const mockStore = mockSecureStorage.store;
const mockGet = mockSecureStorage.get;
const mockDelete = mockSecureStorage.delete;
const mockHas = mockSecureStorage.has;

// Mock secure storage service
vi.mock('@services/secure-storage', () => ({
  secureStorageService: {
    store: (...args: unknown[]) => mockSecureStorage.store(...args),
    get: (...args: unknown[]) => mockSecureStorage.get(...args),
    delete: (...args: unknown[]) => mockSecureStorage.delete(...args),
    has: (...args: unknown[]) => mockSecureStorage.has(...args),
  },
}));

// Mock wallet methods
const mockSignTransaction = vi.fn();
const mockSignMessage = vi.fn();
const mockSendTransaction = vi.fn();
const mockConnect = vi.fn();

// Mock wallet object (accessible for assertions)
const mockWallet = {
  address: '0x1234567890123456789012345678901234567890',
  privateKey: '0x1234567890123456789012345678901234567890123456789012345678901234',
  signTransaction: mockSignTransaction,
  signMessage: mockSignMessage,
  sendTransaction: mockSendTransaction,
  connect: (...args: unknown[]) => {
    mockConnect(...args);
    return mockWallet;
  },
};

// Mock ethers Wallet
vi.mock('ethers', () => {
  // Create a function that returns a fresh wallet-like object each time
  const createWalletInstance = () => {
    const instance = {
      address: '0x1234567890123456789012345678901234567890',
      privateKey: '0x1234567890123456789012345678901234567890123456789012345678901234',
      signTransaction: (...args: unknown[]) => mockSignTransaction(...args),
      signMessage: (...args: unknown[]) => mockSignMessage(...args),
      sendTransaction: (...args: unknown[]) => mockSendTransaction(...args),
      connect: (...args: unknown[]) => {
        mockConnect(...args);
        return instance;
      },
    };
    return instance;
  };

  // Mock constructor that returns the wallet instance
  function MockWallet() {
    return createWalletInstance();
  }
  MockWallet.createRandom = () => createWalletInstance();

  return {
    Wallet: MockWallet,
  };
});

// Mock provider service
vi.mock('./provider', () => ({
  evmProviderService: {
    getProvider: vi.fn().mockReturnValue({
      getNetwork: vi.fn(),
      getBlockNumber: vi.fn(),
    }),
  },
}));

// Import after mocks are set up
import {
  EVMSignerServiceImpl,
  evmSignerService,
  SIGNER_ERROR_CODES,
  SIGNER_STORAGE_KEYS,
} from './signer';

describe('EVMSignerService', () => {
  let service: EVMSignerServiceImpl;

  const mockTxResponse = {
    hash: '0xtxhash',
    wait: vi.fn().mockResolvedValue({ status: 1 }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new EVMSignerServiceImpl();

    // Reset mock implementations
    mockSignTransaction.mockResolvedValue(mockSignedTx);
    mockSignMessage.mockResolvedValue(mockSignature);
    mockSendTransaction.mockResolvedValue(mockTxResponse);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  // ===========================================================================
  // hasWallet
  // ===========================================================================

  describe('hasWallet', () => {
    it('should return true when wallet exists', async () => {
      mockHas.mockResolvedValue(true);

      const result = await service.hasWallet();

      expect(result).toBe(true);
      expect(mockHas).toHaveBeenCalledWith(SIGNER_STORAGE_KEYS.PRIVATE_KEY);
    });

    it('should return false when wallet does not exist', async () => {
      mockHas.mockResolvedValue(false);

      const result = await service.hasWallet();

      expect(result).toBe(false);
    });

    it('should return false on storage error', async () => {
      mockHas.mockRejectedValue(new Error('Storage error'));

      const result = await service.hasWallet();

      expect(result).toBe(false);
    });
  });

  // ===========================================================================
  // createWallet
  // ===========================================================================

  describe('createWallet', () => {
    it('should create a new wallet and store it', async () => {
      mockHas.mockResolvedValue(false);
      mockStore.mockResolvedValue(undefined);

      const result = await service.createWallet();

      expect(result.address).toBe(mockWalletAddress);
      expect(mockStore).toHaveBeenCalledWith(
        SIGNER_STORAGE_KEYS.PRIVATE_KEY,
        mockPrivateKey
      );
      expect(mockStore).toHaveBeenCalledWith(
        SIGNER_STORAGE_KEYS.ADDRESS,
        mockWalletAddress
      );
    });

    it('should throw error if wallet already exists', async () => {
      mockHas.mockResolvedValue(true);

      await expect(service.createWallet()).rejects.toEqual(
        expect.objectContaining({
          code: SIGNER_ERROR_CODES.WALLET_EXISTS,
        })
      );
    });

    it('should cleanup on storage error', async () => {
      mockHas.mockResolvedValue(false);
      mockStore.mockRejectedValue(new Error('Storage failed'));
      mockDelete.mockResolvedValue(undefined);

      await expect(service.createWallet()).rejects.toEqual(
        expect.objectContaining({
          code: SIGNER_ERROR_CODES.STORAGE_ERROR,
        })
      );

      expect(mockDelete).toHaveBeenCalledWith(SIGNER_STORAGE_KEYS.PRIVATE_KEY);
      expect(mockDelete).toHaveBeenCalledWith(SIGNER_STORAGE_KEYS.ADDRESS);
    });
  });

  // ===========================================================================
  // importWallet
  // ===========================================================================

  describe('importWallet', () => {
    const validPrivateKey = '0x1234567890123456789012345678901234567890123456789012345678901234';

    it('should import a wallet with 0x prefix', async () => {
      mockHas.mockResolvedValue(false);
      mockStore.mockResolvedValue(undefined);

      const result = await service.importWallet(validPrivateKey);

      expect(result.address).toBe(mockWalletAddress);
      expect(mockStore).toHaveBeenCalledWith(
        SIGNER_STORAGE_KEYS.PRIVATE_KEY,
        validPrivateKey
      );
    });

    it('should import a wallet without 0x prefix', async () => {
      mockHas.mockResolvedValue(false);
      mockStore.mockResolvedValue(undefined);

      const keyWithoutPrefix = validPrivateKey.slice(2);
      const result = await service.importWallet(keyWithoutPrefix);

      expect(result.address).toBe(mockWalletAddress);
    });

    it('should throw error if wallet already exists', async () => {
      mockHas.mockResolvedValue(true);

      await expect(service.importWallet(validPrivateKey)).rejects.toEqual(
        expect.objectContaining({
          code: SIGNER_ERROR_CODES.WALLET_EXISTS,
        })
      );
    });

    it('should throw error for invalid private key format', async () => {
      mockHas.mockResolvedValue(false);

      await expect(service.importWallet('invalid')).rejects.toEqual(
        expect.objectContaining({
          code: SIGNER_ERROR_CODES.INVALID_PRIVATE_KEY,
        })
      );
    });

    it('should throw error for private key with wrong length', async () => {
      mockHas.mockResolvedValue(false);

      await expect(service.importWallet('0x123')).rejects.toEqual(
        expect.objectContaining({
          code: SIGNER_ERROR_CODES.INVALID_PRIVATE_KEY,
        })
      );
    });
  });

  // ===========================================================================
  // deleteWallet
  // ===========================================================================

  describe('deleteWallet', () => {
    it('should delete wallet from storage', async () => {
      mockDelete.mockResolvedValue(undefined);

      await service.deleteWallet();

      expect(mockDelete).toHaveBeenCalledWith(SIGNER_STORAGE_KEYS.PRIVATE_KEY);
      expect(mockDelete).toHaveBeenCalledWith(SIGNER_STORAGE_KEYS.ADDRESS);
    });

    it('should throw error on storage failure', async () => {
      mockDelete.mockRejectedValue(new Error('Delete failed'));

      await expect(service.deleteWallet()).rejects.toEqual(
        expect.objectContaining({
          code: SIGNER_ERROR_CODES.STORAGE_ERROR,
        })
      );
    });
  });

  // ===========================================================================
  // getAddress
  // ===========================================================================

  describe('getAddress', () => {
    it('should return cached address if available', async () => {
      mockGet.mockResolvedValue(mockWalletAddress);

      const result = await service.getAddress();

      expect(result).toBe(mockWalletAddress);
      expect(mockGet).toHaveBeenCalledWith(SIGNER_STORAGE_KEYS.ADDRESS);
    });

    it('should derive address from private key if not cached', async () => {
      // First call returns null (no cached address), second returns private key
      mockGet
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockPrivateKey);
      mockStore.mockResolvedValue(undefined);

      const result = await service.getAddress();

      expect(result).toBe(mockWalletAddress);
    });

    it('should return null if no wallet exists', async () => {
      mockGet.mockResolvedValue(null);

      const result = await service.getAddress();

      expect(result).toBeNull();
    });
  });

  // ===========================================================================
  // signTransaction
  // ===========================================================================

  describe('signTransaction', () => {
    const mockTx = {
      to: '0x1234567890123456789012345678901234567890',
      value: BigInt('1000000000000000000'),
    };

    it('should sign a transaction', async () => {
      mockGet.mockResolvedValue(mockPrivateKey);

      const result = await service.signTransaction(mockTx);

      expect(result).toBe(mockSignedTx);
      expect(mockConnect).toHaveBeenCalled();
      expect(mockSignTransaction).toHaveBeenCalledWith(mockTx);
    });

    it('should throw error if no wallet exists', async () => {
      mockGet.mockResolvedValue(null);

      await expect(service.signTransaction(mockTx)).rejects.toEqual(
        expect.objectContaining({
          code: SIGNER_ERROR_CODES.NO_WALLET,
        })
      );
    });

    it('should throw error if signing fails', async () => {
      mockGet.mockResolvedValue(mockPrivateKey);
      mockSignTransaction.mockRejectedValueOnce(new Error('Sign failed'));

      await expect(service.signTransaction(mockTx)).rejects.toEqual(
        expect.objectContaining({
          code: SIGNER_ERROR_CODES.SIGNING_FAILED,
        })
      );
    });
  });

  // ===========================================================================
  // signMessage
  // ===========================================================================

  describe('signMessage', () => {
    it('should sign a message', async () => {
      mockSecureStorage.get.mockResolvedValue(mockPrivateKey);

      const result = await service.signMessage('Hello, World!');

      expect(result).toBe(mockSignature);
      expect(mockWallet.signMessage).toHaveBeenCalledWith('Hello, World!');
    });

    it('should throw error if no wallet exists', async () => {
      mockSecureStorage.get.mockResolvedValue(null);

      await expect(service.signMessage('Hello')).rejects.toEqual(
        expect.objectContaining({
          code: SIGNER_ERROR_CODES.NO_WALLET,
        })
      );
    });

    it('should throw error if signing fails', async () => {
      mockSecureStorage.get.mockResolvedValue(mockPrivateKey);
      mockWallet.signMessage.mockRejectedValueOnce(new Error('Sign failed'));

      await expect(service.signMessage('Hello')).rejects.toEqual(
        expect.objectContaining({
          code: SIGNER_ERROR_CODES.SIGNING_FAILED,
        })
      );
    });
  });

  // ===========================================================================
  // sendTransaction
  // ===========================================================================

  describe('sendTransaction', () => {
    const mockTx = {
      to: '0x1234567890123456789012345678901234567890',
      value: BigInt('1000000000000000000'),
    };

    it('should send a transaction', async () => {
      mockSecureStorage.get.mockResolvedValue(mockPrivateKey);

      const result = await service.sendTransaction(mockTx);

      expect(result).toBe(mockTxResponse);
      expect(mockConnect).toHaveBeenCalled();
      expect(mockSendTransaction).toHaveBeenCalledWith(mockTx);
    });

    it('should throw error if no wallet exists', async () => {
      mockSecureStorage.get.mockResolvedValue(null);

      await expect(service.sendTransaction(mockTx)).rejects.toEqual(
        expect.objectContaining({
          code: SIGNER_ERROR_CODES.NO_WALLET,
        })
      );
    });

    it('should throw error if transaction fails', async () => {
      mockSecureStorage.get.mockResolvedValue(mockPrivateKey);
      mockWallet.sendTransaction.mockRejectedValueOnce(new Error('TX failed'));

      await expect(service.sendTransaction(mockTx)).rejects.toEqual(
        expect.objectContaining({
          code: SIGNER_ERROR_CODES.TRANSACTION_FAILED,
        })
      );
    });
  });

  // ===========================================================================
  // SIGNER_ERROR_CODES
  // ===========================================================================

  describe('SIGNER_ERROR_CODES', () => {
    it('should export error code constants', () => {
      expect(SIGNER_ERROR_CODES.NO_WALLET).toBe('NO_WALLET');
      expect(SIGNER_ERROR_CODES.WALLET_EXISTS).toBe('WALLET_EXISTS');
      expect(SIGNER_ERROR_CODES.INVALID_PRIVATE_KEY).toBe('INVALID_PRIVATE_KEY');
      expect(SIGNER_ERROR_CODES.SIGNING_FAILED).toBe('SIGNING_FAILED');
      expect(SIGNER_ERROR_CODES.STORAGE_ERROR).toBe('STORAGE_ERROR');
      expect(SIGNER_ERROR_CODES.TRANSACTION_FAILED).toBe('TRANSACTION_FAILED');
    });
  });

  // ===========================================================================
  // SIGNER_STORAGE_KEYS
  // ===========================================================================

  describe('SIGNER_STORAGE_KEYS', () => {
    it('should export storage key constants', () => {
      expect(SIGNER_STORAGE_KEYS.PRIVATE_KEY).toBe('evm_private_key');
      expect(SIGNER_STORAGE_KEYS.ADDRESS).toBe('evm_address');
    });
  });

  // ===========================================================================
  // Singleton Export
  // ===========================================================================

  describe('Singleton', () => {
    it('should export singleton instance', () => {
      expect(evmSignerService).toBeInstanceOf(EVMSignerServiceImpl);
    });

    it('should have all service methods', () => {
      expect(typeof evmSignerService.hasWallet).toBe('function');
      expect(typeof evmSignerService.createWallet).toBe('function');
      expect(typeof evmSignerService.importWallet).toBe('function');
      expect(typeof evmSignerService.deleteWallet).toBe('function');
      expect(typeof evmSignerService.getAddress).toBe('function');
      expect(typeof evmSignerService.signTransaction).toBe('function');
      expect(typeof evmSignerService.signMessage).toBe('function');
      expect(typeof evmSignerService.sendTransaction).toBe('function');
    });
  });
});
