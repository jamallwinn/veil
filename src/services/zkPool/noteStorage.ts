/**
 * Note Storage Service
 *
 * Securely stores and retrieves deposit notes using the Tauri keychain.
 * Notes contain sensitive information (nullifier, secret) that must be protected.
 *
 * Storage structure:
 * - Individual notes stored by commitment hash
 * - Index of all note commitments for enumeration
 * - Pool state (Merkle tree data)
 */

import { secureStorageService } from '@services/secure-storage';
import type { DepositNote, StoredDepositNote, StoredPoolState } from './types';
import { ZKPoolError, ZK_POOL_ERROR_CODES } from './types';

// =============================================================================
// Storage Keys
// =============================================================================

const STORAGE_KEYS = {
  /** Prefix for individual note storage */
  NOTE_PREFIX: 'zkpool_note_',
  /** Index of all stored note commitments */
  NOTE_INDEX: 'zkpool_note_index',
  /** Pool state (Merkle tree, used nullifiers) */
  POOL_STATE: 'zkpool_pool_state',
  /** Service configuration */
  CONFIG: 'zkpool_config',
} as const;

// =============================================================================
// Note Storage Service
// =============================================================================

/**
 * Service for secure deposit note storage
 *
 * SECURITY NOTES:
 * - All notes are stored in the OS keychain via Tauri
 * - Notes contain sensitive nullifier/secret that enable withdrawal
 * - Loss of notes means loss of funds (no recovery possible)
 * - Never log or expose note secrets
 */
class NoteStorageService {
  private inMemoryNotes: Map<string, DepositNote> = new Map();
  private inMemoryIndex: string[] = [];
  private inMemoryPoolState: StoredPoolState | null = null;
  private demoMode: boolean = true;

  /**
   * Set demo mode (uses in-memory storage instead of keychain)
   */
  setDemoMode(enabled: boolean): void {
    this.demoMode = enabled;
    if (enabled) {
      console.log('[NoteStorage] Running in demo mode (in-memory storage)');
    }
  }

  /**
   * Check if running in demo mode
   */
  isDemoMode(): boolean {
    return this.demoMode;
  }

  // ===========================================================================
  // Note Operations
  // ===========================================================================

  /**
   * Store a deposit note securely
   *
   * @param note - The deposit note to store
   * @throws ZKPoolError if storage fails
   */
  async storeNote(note: DepositNote): Promise<void> {
    const storedNote = this.serializeNote(note);
    const key = STORAGE_KEYS.NOTE_PREFIX + note.commitment;

    try {
      if (this.demoMode) {
        this.inMemoryNotes.set(note.commitment, note);
        if (!this.inMemoryIndex.includes(note.commitment)) {
          this.inMemoryIndex.push(note.commitment);
        }
        console.log(`[NoteStorage] Stored note (demo): ${note.commitment.slice(0, 16)}...`);
        return;
      }

      // Store the note
      await secureStorageService.storeJSON(key, storedNote);

      // Update the index
      const index = await this.getNoteIndex();
      if (!index.includes(note.commitment)) {
        index.push(note.commitment);
        await secureStorageService.storeJSON(STORAGE_KEYS.NOTE_INDEX, index);
      }

      console.log(`[NoteStorage] Stored note: ${note.commitment.slice(0, 16)}...`);
    } catch (error) {
      throw new ZKPoolError(
        ZK_POOL_ERROR_CODES.STORAGE_ERROR,
        `Failed to store note: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error
      );
    }
  }

  /**
   * Retrieve a deposit note by commitment
   *
   * @param commitment - The commitment hash of the note
   * @returns The deposit note, or null if not found
   */
  async getNote(commitment: string): Promise<DepositNote | null> {
    const key = STORAGE_KEYS.NOTE_PREFIX + commitment;

    try {
      if (this.demoMode) {
        return this.inMemoryNotes.get(commitment) || null;
      }

      const stored = await secureStorageService.getJSON<StoredDepositNote>(key);
      if (!stored) {
        return null;
      }

      return this.deserializeNote(stored);
    } catch (error) {
      throw new ZKPoolError(
        ZK_POOL_ERROR_CODES.STORAGE_ERROR,
        `Failed to retrieve note: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error
      );
    }
  }

  /**
   * Get all stored deposit notes
   *
   * @returns Array of all deposit notes
   */
  async getAllNotes(): Promise<DepositNote[]> {
    try {
      if (this.demoMode) {
        return Array.from(this.inMemoryNotes.values());
      }

      const index = await this.getNoteIndex();
      const notes: DepositNote[] = [];

      for (const commitment of index) {
        const note = await this.getNote(commitment);
        if (note) {
          notes.push(note);
        }
      }

      return notes;
    } catch (error) {
      throw new ZKPoolError(
        ZK_POOL_ERROR_CODES.STORAGE_ERROR,
        `Failed to retrieve notes: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error
      );
    }
  }

  /**
   * Delete a deposit note
   *
   * WARNING: Deleting a note before withdrawal means the funds are LOST.
   *
   * @param commitment - The commitment hash of the note to delete
   */
  async deleteNote(commitment: string): Promise<void> {
    const key = STORAGE_KEYS.NOTE_PREFIX + commitment;

    try {
      if (this.demoMode) {
        this.inMemoryNotes.delete(commitment);
        this.inMemoryIndex = this.inMemoryIndex.filter((c) => c !== commitment);
        console.log(`[NoteStorage] Deleted note (demo): ${commitment.slice(0, 16)}...`);
        return;
      }

      // Delete the note
      await secureStorageService.delete(key);

      // Update the index
      const index = await this.getNoteIndex();
      const newIndex = index.filter((c) => c !== commitment);
      await secureStorageService.storeJSON(STORAGE_KEYS.NOTE_INDEX, newIndex);

      console.log(`[NoteStorage] Deleted note: ${commitment.slice(0, 16)}...`);
    } catch (error) {
      throw new ZKPoolError(
        ZK_POOL_ERROR_CODES.STORAGE_ERROR,
        `Failed to delete note: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error
      );
    }
  }

  /**
   * Check if a note exists
   *
   * @param commitment - The commitment hash to check
   */
  async hasNote(commitment: string): Promise<boolean> {
    if (this.demoMode) {
      return this.inMemoryNotes.has(commitment);
    }

    const key = STORAGE_KEYS.NOTE_PREFIX + commitment;
    return secureStorageService.has(key);
  }

  /**
   * Get count of stored notes
   */
  async getNoteCount(): Promise<number> {
    if (this.demoMode) {
      return this.inMemoryNotes.size;
    }

    const index = await this.getNoteIndex();
    return index.length;
  }

  // ===========================================================================
  // Pool State Operations
  // ===========================================================================

  /**
   * Store the pool state (Merkle tree data)
   *
   * @param state - The pool state to store
   */
  async storePoolState(state: StoredPoolState): Promise<void> {
    try {
      if (this.demoMode) {
        this.inMemoryPoolState = state;
        console.log('[NoteStorage] Stored pool state (demo)');
        return;
      }

      await secureStorageService.storeJSON(STORAGE_KEYS.POOL_STATE, state);
      console.log('[NoteStorage] Stored pool state');
    } catch (error) {
      throw new ZKPoolError(
        ZK_POOL_ERROR_CODES.STORAGE_ERROR,
        `Failed to store pool state: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error
      );
    }
  }

  /**
   * Retrieve the pool state
   *
   * @returns The pool state, or null if not stored
   */
  async getPoolState(): Promise<StoredPoolState | null> {
    try {
      if (this.demoMode) {
        return this.inMemoryPoolState;
      }

      return await secureStorageService.getJSON<StoredPoolState>(STORAGE_KEYS.POOL_STATE);
    } catch (error) {
      throw new ZKPoolError(
        ZK_POOL_ERROR_CODES.STORAGE_ERROR,
        `Failed to retrieve pool state: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error
      );
    }
  }

  /**
   * Clear all pool state
   */
  async clearPoolState(): Promise<void> {
    try {
      if (this.demoMode) {
        this.inMemoryPoolState = null;
        console.log('[NoteStorage] Cleared pool state (demo)');
        return;
      }

      await secureStorageService.delete(STORAGE_KEYS.POOL_STATE);
      console.log('[NoteStorage] Cleared pool state');
    } catch (error) {
      throw new ZKPoolError(
        ZK_POOL_ERROR_CODES.STORAGE_ERROR,
        `Failed to clear pool state: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error
      );
    }
  }

  // ===========================================================================
  // Bulk Operations
  // ===========================================================================

  /**
   * Clear all stored data (notes, pool state)
   *
   * WARNING: This is destructive and cannot be undone!
   */
  async clearAll(): Promise<void> {
    try {
      if (this.demoMode) {
        this.inMemoryNotes.clear();
        this.inMemoryIndex = [];
        this.inMemoryPoolState = null;
        console.log('[NoteStorage] Cleared all data (demo)');
        return;
      }

      // Delete all notes
      const index = await this.getNoteIndex();
      for (const commitment of index) {
        const key = STORAGE_KEYS.NOTE_PREFIX + commitment;
        await secureStorageService.delete(key);
      }

      // Delete index and pool state
      await secureStorageService.delete(STORAGE_KEYS.NOTE_INDEX);
      await secureStorageService.delete(STORAGE_KEYS.POOL_STATE);
      await secureStorageService.delete(STORAGE_KEYS.CONFIG);

      console.log('[NoteStorage] Cleared all data');
    } catch (error) {
      throw new ZKPoolError(
        ZK_POOL_ERROR_CODES.STORAGE_ERROR,
        `Failed to clear data: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error
      );
    }
  }

  /**
   * Export all notes for backup
   *
   * WARNING: The exported data contains sensitive secrets.
   * Handle with extreme care!
   *
   * @returns Array of serialized notes
   */
  async exportNotes(): Promise<StoredDepositNote[]> {
    const notes = await this.getAllNotes();
    return notes.map((note) => this.serializeNote(note));
  }

  /**
   * Import notes from backup
   *
   * @param notes - Array of serialized notes to import
   */
  async importNotes(notes: StoredDepositNote[]): Promise<void> {
    for (const storedNote of notes) {
      const note = this.deserializeNote(storedNote);
      await this.storeNote(note);
    }
    console.log(`[NoteStorage] Imported ${notes.length} notes`);
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Get the index of all stored note commitments
   */
  private async getNoteIndex(): Promise<string[]> {
    if (this.demoMode) {
      return [...this.inMemoryIndex];
    }

    const index = await secureStorageService.getJSON<string[]>(STORAGE_KEYS.NOTE_INDEX);
    return index || [];
  }

  /**
   * Serialize a DepositNote for storage
   */
  private serializeNote(note: DepositNote): StoredDepositNote {
    return {
      commitment: note.commitment,
      nullifier: note.nullifier,
      secret: note.secret,
      nullifierHash: note.nullifierHash,
      leafIndex: note.leafIndex,
      amount: note.amount.toString(),
      timestamp: note.timestamp,
      depositTxHash: note.depositTxHash,
      blockNumber: note.blockNumber,
    };
  }

  /**
   * Deserialize a StoredDepositNote to DepositNote
   */
  private deserializeNote(stored: StoredDepositNote): DepositNote {
    return {
      commitment: stored.commitment,
      nullifier: stored.nullifier,
      secret: stored.secret,
      nullifierHash: stored.nullifierHash,
      leafIndex: stored.leafIndex,
      amount: BigInt(stored.amount),
      timestamp: stored.timestamp,
      depositTxHash: stored.depositTxHash,
      blockNumber: stored.blockNumber,
    };
  }
}

// =============================================================================
// Export
// =============================================================================

/** Singleton instance */
export const noteStorageService = new NoteStorageService();

/** Export class for testing */
export { NoteStorageService };
