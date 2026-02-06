/**
 * USDC ZK Pool Service Tests
 *
 * Tests for the USDC ZK Privacy Pool implementation.
 * Tests ERC-20 approval patterns unique to USDC flow.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  USDCZKPoolService,
  usdcZKPoolService,
  usdcPoolUtils,
  computeCommitment,
  computeNullifierHash,
  initPoseidon,
} from './usdcPool';
import { noteStorageService } from './noteStorage';
import { USDC_POOL_DENOMINATION, USDC_DECIMALS } from '@constants/usdc';
import type { DepositNote } from './types';

// Initialize Poseidon before all tests
beforeAll(async () => {
  await initPoseidon();
});

// =============================================================================
// USDC Pool Utils Tests
// =============================================================================

describe('usdcPoolUtils', () => {
  describe('formatAmount', () => {
    it('should format amount with 15 decimals', () => {
      const formatted = usdcPoolUtils.formatAmount(100000000000000000n); // 100 USDC
      expect(formatted).toBe('100.0');
    });

    it('should format small amounts', () => {
      const formatted = usdcPoolUtils.formatAmount(1000000000000000n); // 1 USDC
      expect(formatted).toBe('1.0');
    });

    it('should format large amounts', () => {
      const formatted = usdcPoolUtils.formatAmount(1234567890123456789n);
      expect(formatted).toBe('1234.567890123456789');
    });
  });

  describe('parseAmount', () => {
    it('should parse amount with 15 decimals', () => {
      const parsed = usdcPoolUtils.parseAmount('100');
      expect(parsed).toBe(100000000000000000n);
    });

    it('should parse decimal amounts', () => {
      const parsed = usdcPoolUtils.parseAmount('1.5');
      expect(parsed).toBe(1500000000000000n);
    });

    it('should handle small decimals', () => {
      const parsed = usdcPoolUtils.parseAmount('0.000001');
      expect(parsed).toBe(1000000000n);
    });
  });

  describe('getDenomination', () => {
    it('should return USDC pool denomination', () => {
      expect(usdcPoolUtils.getDenomination()).toBe(USDC_POOL_DENOMINATION);
      expect(usdcPoolUtils.getDenomination()).toBe(3000000000000000n); // 3 USDC
    });
  });

  describe('getDecimals', () => {
    it('should return USDC decimals', () => {
      expect(usdcPoolUtils.getDecimals()).toBe(USDC_DECIMALS);
      expect(usdcPoolUtils.getDecimals()).toBe(15);
    });
  });

  describe('getTokenAddress', () => {
    it('should return USDC token address', () => {
      const address = usdcPoolUtils.getTokenAddress();
      expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });
  });
});

// =============================================================================
// USDCZKPoolService Tests
// =============================================================================

describe('USDCZKPoolService', () => {
  let service: USDCZKPoolService;

  beforeEach(async () => {
    noteStorageService.setDemoMode(true);
    await noteStorageService.clearAll();

    service = new USDCZKPoolService({ demoMode: true, treeLevels: 5 });
  });

  describe('initialization', () => {
    it('should initialize in demo mode', async () => {
      await service.initialize();
      expect(service.isReady()).toBe(true);
      expect(service.isDemoMode()).toBe(true);
    });

    it('should not reinitialize if already ready', async () => {
      await service.initialize();
      await service.initialize();
      expect(service.isReady()).toBe(true);
    });

    it('should return correct status', async () => {
      expect(service.getStatus()).toBe('uninitialized');
      await service.initialize();
      expect(service.getStatus()).toBe('ready');
    });
  });

  describe('demo mode', () => {
    it('should be in demo mode by default', () => {
      expect(service.isDemoMode()).toBe(true);
    });

    it('should allow setting demo mode', () => {
      service.setDemoMode(false);
      expect(service.isDemoMode()).toBe(false);
      service.setDemoMode(true);
      expect(service.isDemoMode()).toBe(true);
    });
  });

  describe('denomination', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    it('should return correct denomination', () => {
      expect(service.getDenomination()).toBe(USDC_POOL_DENOMINATION);
    });

    it('should return human-readable denomination', () => {
      const display = service.getDenominationDisplay();
      expect(display).toBe('3.0');
    });
  });

  describe('ERC-20 approval (unique to USDC)', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    it('should check approval status in demo mode', async () => {
      const status = await service.checkApprovalStatus('0x1234567890123456789012345678901234567890');

      expect(status.needsApproval).toBe(false);
      expect(status.requiredAmount).toBe(USDC_POOL_DENOMINATION);
      expect(status.allowance).toBeGreaterThan(0n);
    });

    it('should return null for approval in demo mode', async () => {
      const result = await service.approveUSDC();
      expect(result).toBeNull();
    });
  });

  describe('USDC balance', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    it('should return mock balance in demo mode', async () => {
      const balance = await service.getUSDCBalance('0x1234567890123456789012345678901234567890');
      expect(balance).toBeGreaterThan(0n);
      expect(balance).toBe(USDC_POOL_DENOMINATION * 10n); // 1000 USDC mock
    });
  });

  describe('createDepositNote', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    it('should create a valid deposit note', async () => {
      const amount = USDC_POOL_DENOMINATION;
      const note = await service.createDepositNote(amount);

      expect(note.commitment).toBeTruthy();
      expect(note.nullifier).toBeTruthy();
      expect(note.secret).toBeTruthy();
      expect(note.nullifierHash).toBeTruthy();
      expect(note.amount).toBe(amount);
      expect(note.leafIndex).toBe(-1);
    });

    it('should reject zero amount', async () => {
      await expect(service.createDepositNote(0n)).rejects.toThrow();
    });

    it('should reject negative amount', async () => {
      await expect(service.createDepositNote(-1n)).rejects.toThrow();
    });

    it('should create unique notes', async () => {
      const note1 = await service.createDepositNote(USDC_POOL_DENOMINATION);
      const note2 = await service.createDepositNote(USDC_POOL_DENOMINATION);

      expect(note1.commitment).not.toBe(note2.commitment);
      expect(note1.nullifier).not.toBe(note2.nullifier);
    });
  });

  describe('confirmDeposit', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    it('should confirm a deposit and add to tree', async () => {
      const note = await service.createDepositNote(USDC_POOL_DENOMINATION);
      const confirmed = await service.confirmDeposit(note, '0xabc', 12345);

      expect(confirmed.leafIndex).toBe(0);
      expect(confirmed.depositTxHash).toBe('0xabc');
      expect(confirmed.blockNumber).toBe(12345);
      expect(service.getNextIndex()).toBe(1);
    });

    it('should update root after confirmation', async () => {
      const root1 = service.getRoot();
      const note = await service.createDepositNote(USDC_POOL_DENOMINATION);
      await service.confirmDeposit(note);
      const root2 = service.getRoot();

      expect(root1).not.toBe(root2);
    });
  });

  describe('deposit (full flow)', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    it('should perform a complete deposit in demo mode', async () => {
      const result = await service.deposit(USDC_POOL_DENOMINATION);

      expect(result.success).toBe(true);
      expect(result.note).toBeDefined();
      expect(result.note!.leafIndex).toBeGreaterThanOrEqual(0);
      expect(result.txHash).toBeDefined();
    });

    it('should track total balance from fresh deposits', async () => {
      await service.deposit(1000n);
      await service.deposit(2000n);
      await service.deposit(3000n);

      const balance = await service.getTotalBalance();
      expect(balance).toBe(6000n);
    });
  });

  describe('withdrawal', () => {
    let depositedNote: DepositNote;

    beforeEach(async () => {
      await service.initialize();
      const result = await service.deposit(USDC_POOL_DENOMINATION);
      depositedNote = result.note!;
    });

    it('should generate a withdrawal proof', async () => {
      const proof = await service.generateWithdrawProof(
        depositedNote,
        '0x1234567890123456789012345678901234567890'
      );

      expect(proof).toBeDefined();
      expect(proof.proof).toBeDefined();
      expect(proof.publicSignals).toHaveLength(6);
    });

    it('should verify a valid proof', async () => {
      const proof = await service.generateWithdrawProof(
        depositedNote,
        '0x1234567890123456789012345678901234567890'
      );

      const isValid = await service.verifyProof(proof);
      expect(isValid).toBe(true);
    });

    it('should perform a complete withdrawal in demo mode', async () => {
      const result = await service.withdraw(
        depositedNote,
        '0x1234567890123456789012345678901234567890'
      );

      expect(result.success).toBe(true);
      expect(result.proof).toBeDefined();
      expect(result.txHash).toBeDefined();
    });

    it('should mark nullifier as used after withdrawal', async () => {
      await service.withdraw(
        depositedNote,
        '0x1234567890123456789012345678901234567890'
      );

      expect(service.isNullifierUsed(depositedNote.nullifierHash)).toBe(true);
    });

    it('should prevent double withdrawal', async () => {
      await service.withdraw(
        depositedNote,
        '0x1234567890123456789012345678901234567890'
      );

      const result = await service.withdraw(
        depositedNote,
        '0x1234567890123456789012345678901234567890'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('already been withdrawn');
    });

    it('should reject undeposited note', async () => {
      const undeposited = await service.createDepositNote(USDC_POOL_DENOMINATION);

      const result = await service.withdraw(
        undeposited,
        '0x1234567890123456789012345678901234567890'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('not been deposited');
    });

    it('should reject invalid recipient address', async () => {
      await expect(
        service.generateWithdrawProof(depositedNote, 'invalid-address')
      ).rejects.toThrow('Invalid recipient');
    });
  });

  describe('note management', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    it('should track deposited notes', async () => {
      await service.deposit(1000n);
      await service.deposit(2000n);

      const notes = await service.getAllNotes();
      expect(notes).toHaveLength(2);
    });

    it('should separate unspent and spent notes', async () => {
      const result1 = await service.deposit(1000n);
      await service.deposit(2000n);

      await service.withdraw(result1.note!, '0x1234567890123456789012345678901234567890');

      const unspent = await service.getUnspentNotes();
      const spent = await service.getSpentNotes();

      expect(unspent).toHaveLength(1);
      expect(spent).toHaveLength(1);
      expect(unspent[0].amount).toBe(2000n);
      expect(spent[0].amount).toBe(1000n);
    });
  });

  describe('pool state', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    it('should provide pool state', async () => {
      await service.deposit(1000n);
      await service.deposit(2000n);

      const state = service.getPoolState();

      expect(state.nextIndex).toBe(2);
      expect(state.commitments).toHaveLength(2);
      expect(state.root).toBe(service.getRoot());
    });

    it('should reset to initial state', async () => {
      await service.deposit(1000n);
      await service.deposit(2000n);

      await service.reset();

      expect(service.getNextIndex()).toBe(0);
      expect(service.getCommitments()).toHaveLength(0);
    });

    it('should return capacity', () => {
      expect(service.getCapacity()).toBe(2 ** 5); // treeLevels = 5
    });
  });

  describe('singleton', () => {
    it('should export singleton instance', () => {
      expect(usdcZKPoolService).toBeInstanceOf(USDCZKPoolService);
    });

    it('should have all required methods', () => {
      expect(typeof usdcZKPoolService.initialize).toBe('function');
      expect(typeof usdcZKPoolService.deposit).toBe('function');
      expect(typeof usdcZKPoolService.withdraw).toBe('function');
      expect(typeof usdcZKPoolService.checkApprovalStatus).toBe('function');
      expect(typeof usdcZKPoolService.approveUSDC).toBe('function');
      expect(typeof usdcZKPoolService.getUSDCBalance).toBe('function');
      expect(typeof usdcZKPoolService.getDenomination).toBe('function');
      expect(typeof usdcZKPoolService.cleanup).toBe('function');
    });
  });
});

// =============================================================================
// Hash Function Consistency Tests
// =============================================================================

describe('USDC Hash Functions (consistency with XRP pool)', () => {
  describe('computeCommitment', () => {
    it('should compute commitment deterministically', () => {
      const nullifier = '123456789012345';
      const secret = '987654321098765';
      const c1 = computeCommitment(nullifier, secret);
      const c2 = computeCommitment(nullifier, secret);
      expect(c1).toBe(c2);
    });

    it('should produce different commitments for different inputs', () => {
      const c1 = computeCommitment('111', '222');
      const c2 = computeCommitment('333', '444');
      expect(c1).not.toBe(c2);
    });
  });

  describe('computeNullifierHash', () => {
    it('should compute nullifier hash deterministically', () => {
      const nullifier = '123456789';
      const h1 = computeNullifierHash(nullifier);
      const h2 = computeNullifierHash(nullifier);
      expect(h1).toBe(h2);
    });

    it('should produce different hashes for different nullifiers', () => {
      const h1 = computeNullifierHash('111');
      const h2 = computeNullifierHash('222');
      expect(h1).not.toBe(h2);
    });
  });
});
