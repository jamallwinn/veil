/**
 * ZK Pool Service Tests
 *
 * Tests for the ZK Privacy Pool implementation.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  MerkleTree,
  computeCommitment,
  computeNullifierHash,
  randomFieldElement,
  poseidonHash,
  initPoseidon,
} from './merkleTree';
import { ZKPoolService, zkPoolUtils, noteStorageService } from './index';
import type { DepositNote } from './types';

// Initialize Poseidon before all tests
beforeAll(async () => {
  await initPoseidon();
});

// =============================================================================
// Merkle Tree Tests
// =============================================================================

describe('MerkleTree', () => {
  describe('constructor', () => {
    it('should create an empty tree with 20 levels by default', () => {
      const tree = new MerkleTree();
      expect(tree.getNextIndex()).toBe(0);
      expect(tree.getCommitments()).toHaveLength(0);
      expect(tree.getCapacity()).toBe(2 ** 20);
    });

    it('should create a tree with custom levels', () => {
      const tree = new MerkleTree(10);
      expect(tree.getCapacity()).toBe(2 ** 10);
    });

    it('should throw for invalid levels', () => {
      expect(() => new MerkleTree(0)).toThrow();
      expect(() => new MerkleTree(33)).toThrow();
    });
  });

  describe('insert', () => {
    it('should insert a commitment and return leaf index', () => {
      const tree = new MerkleTree(5);
      const commitment = '12345';

      const index = tree.insert(commitment);

      expect(index).toBe(0);
      expect(tree.getNextIndex()).toBe(1);
      expect(tree.getCommitments()).toContain(commitment);
    });

    it('should update root on each insert', () => {
      const tree = new MerkleTree(5);
      const root1 = tree.getRoot();

      tree.insert('123');
      const root2 = tree.getRoot();

      tree.insert('456');
      const root3 = tree.getRoot();

      expect(root1).not.toBe(root2);
      expect(root2).not.toBe(root3);
    });

    it('should throw when tree is full', () => {
      const tree = new MerkleTree(2); // Capacity of 4
      tree.insert('1');
      tree.insert('2');
      tree.insert('3');
      tree.insert('4');

      expect(() => tree.insert('5')).toThrow('tree is full');
    });
  });

  describe('getProof', () => {
    it('should generate a valid proof for a leaf', () => {
      const tree = new MerkleTree(5);
      tree.insert('111');
      tree.insert('222');
      tree.insert('333');

      const proof = tree.getProof(1);

      expect(proof.leafIndex).toBe(1);
      expect(proof.pathElements).toHaveLength(5);
      expect(proof.pathIndices).toHaveLength(5);
      expect(proof.root).toBe(tree.getRoot());
    });

    it('should throw for invalid leaf index', () => {
      const tree = new MerkleTree(5);
      tree.insert('123');

      expect(() => tree.getProof(-1)).toThrow();
      expect(() => tree.getProof(1)).toThrow(); // Only 0 is valid
    });
  });

  describe('verify', () => {
    it('should verify a valid proof', () => {
      const tree = new MerkleTree(5);
      const commitment = '999888777';
      tree.insert(commitment);

      const proof = tree.getProof(0);
      const isValid = tree.verify(commitment, proof);

      expect(isValid).toBe(true);
    });

    it('should reject an invalid commitment', () => {
      const tree = new MerkleTree(5);
      tree.insert('111222333');

      const proof = tree.getProof(0);
      const isValid = tree.verify('444555666', proof);

      expect(isValid).toBe(false);
    });
  });

  describe('serialization', () => {
    it('should export and restore tree state', () => {
      const tree = new MerkleTree(5);
      tree.insert('100');
      tree.insert('200');
      tree.insert('300');

      const state = tree.toStoredState();
      const restored = MerkleTree.fromStoredState(state, 5);

      expect(restored.getRoot()).toBe(tree.getRoot());
      expect(restored.getNextIndex()).toBe(tree.getNextIndex());
      expect(restored.getCommitments()).toEqual(tree.getCommitments());
    });
  });
});

// =============================================================================
// Hash Function Tests
// =============================================================================

describe('Hash Functions', () => {
  describe('poseidonHash', () => {
    it('should hash single input', () => {
      const hash = poseidonHash(['123456789']);
      expect(typeof hash).toBe('string');
      expect(hash.length).toBeGreaterThan(0);
    });

    it('should hash two inputs', () => {
      const hash = poseidonHash(['123', '456']);
      expect(typeof hash).toBe('string');
      expect(hash.length).toBeGreaterThan(0);
    });

    it('should be deterministic', () => {
      const hash1 = poseidonHash(['99999', '88888']);
      const hash2 = poseidonHash(['99999', '88888']);
      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different inputs', () => {
      const hash1 = poseidonHash(['11111']);
      const hash2 = poseidonHash(['22222']);
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('computeCommitment', () => {
    it('should compute commitment from nullifier and secret (as field elements)', () => {
      const nullifier = randomFieldElement();
      const secret = randomFieldElement();
      const commitment = computeCommitment(nullifier, secret);
      expect(typeof commitment).toBe('string');
      expect(commitment.length).toBeGreaterThan(0);
    });

    it('should be deterministic', () => {
      const nullifier = '123456789012345';
      const secret = '987654321098765';
      const c1 = computeCommitment(nullifier, secret);
      const c2 = computeCommitment(nullifier, secret);
      expect(c1).toBe(c2);
    });
  });

  describe('computeNullifierHash', () => {
    it('should compute nullifier hash from nullifier', () => {
      const nullifier = randomFieldElement();
      const hash = computeNullifierHash(nullifier);
      expect(typeof hash).toBe('string');
      expect(hash.length).toBeGreaterThan(0);
    });

    it('should be different from commitment', () => {
      const nullifier = randomFieldElement();
      const secret = randomFieldElement();
      const nullifierHash = computeNullifierHash(nullifier);
      const commitment = computeCommitment(nullifier, secret);
      expect(nullifierHash).not.toBe(commitment);
    });
  });

  describe('randomFieldElement', () => {
    it('should generate random field elements', () => {
      const element = randomFieldElement();
      expect(typeof element).toBe('string');
      expect(BigInt(element)).toBeGreaterThan(0n);
    });

    it('should generate different elements each time', () => {
      const e1 = randomFieldElement();
      const e2 = randomFieldElement();
      expect(e1).not.toBe(e2);
    });
  });
});

// =============================================================================
// ZK Pool Service Tests
// =============================================================================

describe('ZKPoolService', () => {
  let service: ZKPoolService;

  // Create a fresh service for each test to avoid state leakage
  beforeEach(async () => {
    // Clear all stored data to ensure test isolation
    noteStorageService.setDemoMode(true);
    await noteStorageService.clearAll();

    // Create a fresh service instance
    service = new ZKPoolService({ demoMode: true, treeLevels: 5 });
  });

  describe('initialization', () => {
    it('should initialize in demo mode', async () => {
      await service.initialize();
      expect(service.isReady()).toBe(true);
      expect(service.isDemoMode()).toBe(true);
    });

    it('should not reinitialize if already ready', async () => {
      await service.initialize();
      await service.initialize(); // Should not throw
      expect(service.isReady()).toBe(true);
    });
  });

  describe('createDepositNote', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    it('should create a valid deposit note', async () => {
      const amount = 1000000000000000000n; // 1 token
      const note = await service.createDepositNote(amount);

      expect(note.commitment).toBeTruthy();
      expect(note.nullifier).toBeTruthy();
      expect(note.secret).toBeTruthy();
      expect(note.nullifierHash).toBeTruthy();
      expect(note.amount).toBe(amount);
      expect(note.leafIndex).toBe(-1); // Not yet inserted
    });

    it('should reject zero amount', async () => {
      await expect(service.createDepositNote(0n)).rejects.toThrow();
    });

    it('should reject negative amount', async () => {
      await expect(service.createDepositNote(-1n)).rejects.toThrow();
    });
  });

  describe('confirmDeposit', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    it('should confirm a deposit and add to tree', async () => {
      const note = await service.createDepositNote(1000n);
      const confirmed = await service.confirmDeposit(note, '0xabc', 12345);

      expect(confirmed.leafIndex).toBe(0);
      expect(confirmed.depositTxHash).toBe('0xabc');
      expect(confirmed.blockNumber).toBe(12345);
      expect(service.getNextIndex()).toBe(1);
    });

    it('should update root after confirmation', async () => {
      const root1 = service.getRoot();
      const note = await service.createDepositNote(1000n);
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
      const result = await service.deposit(1000000000000000000n);

      expect(result.success).toBe(true);
      expect(result.note).toBeDefined();
      expect(result.note!.leafIndex).toBeGreaterThanOrEqual(0);
      expect(result.txHash).toBeDefined();
    });

    it('should track total balance from fresh deposits', async () => {
      // Fresh service, make 3 deposits
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
      const result = await service.deposit(1000000000000000000n);
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
      const undeposited = await service.createDepositNote(1000n);

      const result = await service.withdraw(
        undeposited,
        '0x1234567890123456789012345678901234567890'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('not been deposited');
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

      // Withdraw one
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
  });
});

// =============================================================================
// Utility Function Tests
// =============================================================================

describe('zkPoolUtils', () => {
  describe('formatAmount', () => {
    it('should format amount with default decimals', () => {
      const formatted = zkPoolUtils.formatAmount(1500000000000000000n);
      expect(formatted).toBe('1.500000');
    });

    it('should format small amounts', () => {
      const formatted = zkPoolUtils.formatAmount(1000000000000000n); // 0.001
      expect(formatted).toBe('0.001000');
    });

    it('should format large amounts', () => {
      const formatted = zkPoolUtils.formatAmount(1234567890123456789012n);
      expect(formatted).toBe('1234.567890');
    });
  });

  describe('parseAmount', () => {
    it('should parse amount with default decimals', () => {
      const parsed = zkPoolUtils.parseAmount('1.5');
      expect(parsed).toBe(1500000000000000000n);
    });

    it('should parse integer amounts', () => {
      const parsed = zkPoolUtils.parseAmount('100');
      expect(parsed).toBe(100000000000000000000n);
    });

    it('should handle small decimals', () => {
      const parsed = zkPoolUtils.parseAmount('0.000001');
      expect(parsed).toBe(1000000000000n);
    });
  });

  describe('addressToFieldElement', () => {
    it('should convert 0x address to field element', () => {
      const address = '0x1234567890123456789012345678901234567890';
      const field = zkPoolUtils.addressToFieldElement(address);
      expect(typeof field).toBe('string');
      expect(BigInt(field)).toBeGreaterThan(0n);
    });

    it('should pass through non-0x values', () => {
      const value = '12345';
      const field = zkPoolUtils.addressToFieldElement(value);
      expect(field).toBe('12345');
    });
  });
});
