/**
 * Secure Storage Service
 *
 * Provides secure keychain storage via Tauri backend commands.
 * Uses OS native credential managers:
 * - macOS: Keychain
 * - Windows: Credential Manager
 * - Linux: Secret Service (libsecret)
 *
 * Falls back to localStorage when running in browser (dev mode without Tauri).
 * NOTE: localStorage is NOT secure - only use for development/testing!
 */

// Check if running in Tauri environment
const isTauri = typeof window !== 'undefined' && '__TAURI__' in window;

// Dynamically import Tauri API only when available
let tauriInvoke: typeof import('@tauri-apps/api/core').invoke | null = null;

if (isTauri) {
  import('@tauri-apps/api/core').then((module) => {
    tauriInvoke = module.invoke;
  }).catch(() => {
    console.warn('[SecureStorage] Failed to load Tauri API, using localStorage fallback');
  });
}

// localStorage fallback for browser dev mode
const STORAGE_PREFIX = 'veil_secure_';

function localStorageFallback() {
  return {
    async store(key: string, value: string): Promise<void> {
      localStorage.setItem(STORAGE_PREFIX + key, value);
    },
    async get(key: string): Promise<string | null> {
      return localStorage.getItem(STORAGE_PREFIX + key);
    },
    async delete(key: string): Promise<void> {
      localStorage.removeItem(STORAGE_PREFIX + key);
    },
    async has(key: string): Promise<boolean> {
      return localStorage.getItem(STORAGE_PREFIX + key) !== null;
    },
  };
}

/**
 * Error types for secure storage operations
 */
export class SecureStorageError extends Error {
  constructor(
    message: string,
    public readonly operation: 'store' | 'get' | 'delete' | 'has'
  ) {
    super(message);
    this.name = 'SecureStorageError';
  }
}

/**
 * Secure Storage Service Class
 *
 * Wraps Tauri invoke calls for secure keychain operations.
 * All secrets are stored in the OS native credential manager under
 * the service name "veil-app".
 *
 * Falls back to localStorage in browser dev mode (NOT secure - for testing only).
 */
class SecureStorageService {
  private fallback = localStorageFallback();

  /**
   * Check if Tauri is available
   */
  private isTauriAvailable(): boolean {
    return isTauri && tauriInvoke !== null;
  }

  /**
   * Store a secret in the OS keychain
   *
   * @param key - The key/account name for the secret
   * @param value - The secret value to store
   * @throws SecureStorageError if storage fails
   */
  async store(key: string, value: string): Promise<void> {
    try {
      if (this.isTauriAvailable()) {
        await tauriInvoke!('store_secret', { key, value });
      } else {
        await this.fallback.store(key, value);
      }
    } catch (error) {
      throw new SecureStorageError(
        `Failed to store secret: ${error}`,
        'store'
      );
    }
  }

  /**
   * Retrieve a secret from the OS keychain
   *
   * @param key - The key/account name for the secret
   * @returns The secret value, or null if not found
   * @throws SecureStorageError if retrieval fails (other than not found)
   */
  async get(key: string): Promise<string | null> {
    try {
      if (this.isTauriAvailable()) {
        const result = await tauriInvoke!<string | null>('get_secret', { key });
        return result;
      } else {
        return await this.fallback.get(key);
      }
    } catch (error) {
      throw new SecureStorageError(
        `Failed to get secret: ${error}`,
        'get'
      );
    }
  }

  /**
   * Delete a secret from the OS keychain
   *
   * @param key - The key/account name for the secret to delete
   * @throws SecureStorageError if deletion fails
   */
  async delete(key: string): Promise<void> {
    try {
      if (this.isTauriAvailable()) {
        await tauriInvoke!('delete_secret', { key });
      } else {
        await this.fallback.delete(key);
      }
    } catch (error) {
      throw new SecureStorageError(
        `Failed to delete secret: ${error}`,
        'delete'
      );
    }
  }

  /**
   * Check if a secret exists in the OS keychain
   *
   * @param key - The key/account name to check
   * @returns true if secret exists, false otherwise
   * @throws SecureStorageError if check fails
   */
  async has(key: string): Promise<boolean> {
    try {
      if (this.isTauriAvailable()) {
        const result = await tauriInvoke!<boolean>('has_secret', { key });
        return result;
      } else {
        return await this.fallback.has(key);
      }
    } catch (error) {
      throw new SecureStorageError(
        `Failed to check secret: ${error}`,
        'has'
      );
    }
  }

  /**
   * Store a JSON-serializable object in the OS keychain
   *
   * @param key - The key/account name for the secret
   * @param value - The object to store (will be JSON serialized)
   * @throws SecureStorageError if storage fails
   */
  async storeJSON<T>(key: string, value: T): Promise<void> {
    const serialized = JSON.stringify(value);
    await this.store(key, serialized);
  }

  /**
   * Retrieve and parse a JSON object from the OS keychain
   *
   * @param key - The key/account name for the secret
   * @returns The parsed object, or null if not found
   * @throws SecureStorageError if retrieval or parsing fails
   */
  async getJSON<T>(key: string): Promise<T | null> {
    const value = await this.get(key);
    if (value === null) {
      return null;
    }
    try {
      return JSON.parse(value) as T;
    } catch {
      throw new SecureStorageError(
        `Failed to parse stored JSON for key "${key}"`,
        'get'
      );
    }
  }
}

// Export singleton instance
export const secureStorageService = new SecureStorageService();

// Export class for testing
export { SecureStorageService };
