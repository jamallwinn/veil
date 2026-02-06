import { describe, it, expect } from 'vitest';
import {
  XRPL_EVM_SIDECHAIN,
  XRPL_EVM_DEVNET,
  CHAIN_IDS,
  getChainConfig,
  isSupportedChain,
  getRpcUrl,
} from './chains';

describe('Chain Constants', () => {
  // ===========================================================================
  // CHAIN_IDS
  // ===========================================================================

  describe('CHAIN_IDS', () => {
    it('should have correct XRPL EVM Sidechain ID', () => {
      expect(CHAIN_IDS.XRPL_EVM_SIDECHAIN).toBe(1440002);
    });

    it('should have correct XRPL EVM Devnet ID', () => {
      // Note: XRPL_EVM_DEVNET is aliased to XRPL_EVM_SIDECHAIN (1440002)
      expect(CHAIN_IDS.XRPL_EVM_DEVNET).toBe(1440002);
    });
  });

  // ===========================================================================
  // XRPL_EVM_SIDECHAIN
  // ===========================================================================

  describe('XRPL_EVM_SIDECHAIN', () => {
    it('should have correct chain ID', () => {
      expect(XRPL_EVM_SIDECHAIN.chainId).toBe(1440002);
    });

    it('should have correct name', () => {
      expect(XRPL_EVM_SIDECHAIN.name).toBe('XRPL EVM Sidechain (Devnet)');
    });

    it('should have correct short name', () => {
      expect(XRPL_EVM_SIDECHAIN.shortName).toBe('xrpl-evm-devnet');
    });

    it('should have correct native currency', () => {
      expect(XRPL_EVM_SIDECHAIN.nativeCurrency).toEqual({
        name: 'XRP',
        symbol: 'XRP',
        decimals: 18,
      });
    });

    it('should have RPC URLs configured', () => {
      expect(XRPL_EVM_SIDECHAIN.rpcUrls.default).toBeDefined();
      expect(typeof XRPL_EVM_SIDECHAIN.rpcUrls.default).toBe('string');
    });

    it('should have block explorer configured', () => {
      expect(XRPL_EVM_SIDECHAIN.blockExplorer).toBeDefined();
      expect(XRPL_EVM_SIDECHAIN.blockExplorer?.name).toBe('XRPL EVM Devnet Explorer');
    });

    it('should be a testnet (devnet)', () => {
      expect(XRPL_EVM_SIDECHAIN.isTestnet).toBe(true);
    });
  });

  // ===========================================================================
  // XRPL_EVM_DEVNET
  // ===========================================================================

  describe('XRPL_EVM_DEVNET', () => {
    it('should have correct chain ID', () => {
      // XRPL_EVM_DEVNET is now aliased to testnet chain ID
      expect(XRPL_EVM_DEVNET.chainId).toBe(1449000);
    });

    it('should have correct name', () => {
      // XRPL_EVM_DEVNET is now aliased to testnet
      expect(XRPL_EVM_DEVNET.name).toBe('XRPL EVM Testnet');
    });

    it('should be a testnet', () => {
      expect(XRPL_EVM_DEVNET.isTestnet).toBe(true);
    });

    it('should have XRP native currency', () => {
      expect(XRPL_EVM_DEVNET.nativeCurrency.symbol).toBe('XRP');
      expect(XRPL_EVM_DEVNET.nativeCurrency.decimals).toBe(18);
    });
  });

  // ===========================================================================
  // getChainConfig
  // ===========================================================================

  describe('getChainConfig', () => {
    it('should return XRPL EVM Sidechain config for chain ID 1440002', () => {
      const config = getChainConfig(CHAIN_IDS.XRPL_EVM_SIDECHAIN);
      expect(config).toBe(XRPL_EVM_SIDECHAIN);
    });

    it('should return XRPL EVM Sidechain config for DEVNET alias (same chain ID)', () => {
      // XRPL_EVM_DEVNET chain ID is aliased to XRPL_EVM_SIDECHAIN
      const config = getChainConfig(CHAIN_IDS.XRPL_EVM_DEVNET);
      expect(config).toBe(XRPL_EVM_SIDECHAIN);
    });

    it('should return undefined for unsupported chain IDs', () => {
      expect(getChainConfig(1)).toBeUndefined();
      expect(getChainConfig(137)).toBeUndefined();
      expect(getChainConfig(0)).toBeUndefined();
    });
  });

  // ===========================================================================
  // isSupportedChain
  // ===========================================================================

  describe('isSupportedChain', () => {
    it('should return true for XRPL EVM Sidechain', () => {
      expect(isSupportedChain(CHAIN_IDS.XRPL_EVM_SIDECHAIN)).toBe(true);
    });

    it('should return true for XRPL EVM Devnet', () => {
      expect(isSupportedChain(CHAIN_IDS.XRPL_EVM_DEVNET)).toBe(true);
    });

    it('should return false for unsupported chains', () => {
      expect(isSupportedChain(1)).toBe(false); // Ethereum mainnet
      expect(isSupportedChain(137)).toBe(false); // Polygon
      expect(isSupportedChain(56)).toBe(false); // BSC
    });
  });

  // ===========================================================================
  // getRpcUrl
  // ===========================================================================

  describe('getRpcUrl', () => {
    it('should return default RPC URL for XRPL EVM Sidechain', () => {
      const rpcUrl = getRpcUrl(CHAIN_IDS.XRPL_EVM_SIDECHAIN);
      expect(rpcUrl).toBe(XRPL_EVM_SIDECHAIN.rpcUrls.default);
    });

    it('should return XRPL EVM Sidechain RPC URL for DEVNET alias', () => {
      // XRPL_EVM_DEVNET chain ID is aliased to XRPL_EVM_SIDECHAIN
      const rpcUrl = getRpcUrl(CHAIN_IDS.XRPL_EVM_DEVNET);
      expect(rpcUrl).toBe(XRPL_EVM_SIDECHAIN.rpcUrls.default);
    });

    it('should return undefined for unsupported chains', () => {
      expect(getRpcUrl(1)).toBeUndefined();
    });
  });
});
