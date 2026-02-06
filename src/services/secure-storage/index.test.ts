import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SecureStorageError } from './index';

// Storage prefix used by the service
const STORAGE_PREFIX = 'veil_secure_';

// In-memory storage for testing
let mockStorage: Map<string, string>;

// Get the mocked localStorage from global setup
const getLocalStorageMock = () => window.localStorage as unknown as {
  getItem: ReturnType<typeof vi.fn>;
  setItem: ReturnType<typeof vi.fn>;
  removeItem: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
};

describe('SecureStorageService', () => {
  // Set up proper localStorage mock behavior before each test
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage = new Map();

    const localStorageMock = getLocalStorageMock();

    // Implement localStorage mock behavior
    localStorageMock.getItem.mockImplementation((key: string) => {
      return mockStorage.get(key) ?? null;
    });

    localStorageMock.setItem.mockImplementation((key: string, value: string) => {
      mockStorage.set(key, value);
    });

    localStorageMock.removeItem.mockImplementation((key: string) => {
      mockStorage.delete(key);
    });

    localStorageMock.clear.mockImplementation(() => {
      mockStorage.clear();
    });
  });

  afterEach(() => {
    mockStorage.clear();
  });

  // Test localStorage fallback path (runs when Tauri is not available)
  // In the test environment, window.__TAURI__ is not set, so localStorage is used
  describe('localStorage fallback (browser mode)', () => {
    // Import fresh instance for each test
    let secureStorageService: typeof import('./index').secureStorageService;

    beforeEach(async () => {
      // Dynamic import to get fresh instance
      const module = await import('./index');
      secureStorageService = module.secureStorageService;
    });

    describe('store', () => {
      it('should store value in localStorage', async () => {
        await secureStorageService.store('my-key', 'my-secret');

        expect(getLocalStorageMock().setItem).toHaveBeenCalledWith(
          STORAGE_PREFIX + 'my-key',
          'my-secret'
        );
        expect(mockStorage.get(STORAGE_PREFIX + 'my-key')).toBe('my-secret');
      });

      it('should overwrite existing value', async () => {
        await secureStorageService.store('my-key', 'first');
        await secureStorageService.store('my-key', 'second');

        expect(mockStorage.get(STORAGE_PREFIX + 'my-key')).toBe('second');
      });
    });

    describe('get', () => {
      it('should return stored value', async () => {
        mockStorage.set(STORAGE_PREFIX + 'my-key', 'my-secret');

        const result = await secureStorageService.get('my-key');

        expect(result).toBe('my-secret');
        expect(getLocalStorageMock().getItem).toHaveBeenCalledWith(
          STORAGE_PREFIX + 'my-key'
        );
      });

      it('should return null when key not found', async () => {
        const result = await secureStorageService.get('nonexistent-key');

        expect(result).toBeNull();
      });
    });

    describe('delete', () => {
      it('should remove value from localStorage', async () => {
        mockStorage.set(STORAGE_PREFIX + 'my-key', 'my-secret');

        await secureStorageService.delete('my-key');

        expect(getLocalStorageMock().removeItem).toHaveBeenCalledWith(
          STORAGE_PREFIX + 'my-key'
        );
        expect(mockStorage.has(STORAGE_PREFIX + 'my-key')).toBe(false);
      });

      it('should not throw when deleting nonexistent key', async () => {
        await expect(
          secureStorageService.delete('nonexistent-key')
        ).resolves.not.toThrow();
      });
    });

    describe('has', () => {
      it('should return true when key exists', async () => {
        mockStorage.set(STORAGE_PREFIX + 'my-key', 'my-secret');

        const result = await secureStorageService.has('my-key');

        expect(result).toBe(true);
      });

      it('should return false when key does not exist', async () => {
        const result = await secureStorageService.has('nonexistent-key');

        expect(result).toBe(false);
      });
    });

    describe('storeJSON', () => {
      it('should serialize object and store it', async () => {
        const data = { foo: 'bar', count: 42 };

        await secureStorageService.storeJSON('json-key', data);

        expect(mockStorage.get(STORAGE_PREFIX + 'json-key')).toBe(
          JSON.stringify(data)
        );
      });

      it('should handle arrays', async () => {
        const data = [1, 2, 3];

        await secureStorageService.storeJSON('array-key', data);

        expect(mockStorage.get(STORAGE_PREFIX + 'array-key')).toBe('[1,2,3]');
      });
    });

    describe('getJSON', () => {
      it('should retrieve and parse JSON object', async () => {
        const data = { foo: 'bar', count: 42 };
        mockStorage.set(STORAGE_PREFIX + 'json-key', JSON.stringify(data));

        const result = await secureStorageService.getJSON<typeof data>('json-key');

        expect(result).toEqual(data);
      });

      it('should return null when key not found', async () => {
        const result = await secureStorageService.getJSON('nonexistent-key');

        expect(result).toBeNull();
      });

      it('should throw SecureStorageError on invalid JSON', async () => {
        mockStorage.set(STORAGE_PREFIX + 'invalid-json-key', 'not valid json');

        await expect(
          secureStorageService.getJSON('invalid-json-key')
        ).rejects.toThrow(SecureStorageError);

        await expect(
          secureStorageService.getJSON('invalid-json-key')
        ).rejects.toMatchObject({
          operation: 'get',
        });
      });
    });
  });

  describe('SecureStorageError', () => {
    it('should have correct properties', () => {
      const error = new SecureStorageError('Test error', 'store');

      expect(error.name).toBe('SecureStorageError');
      expect(error.message).toBe('Test error');
      expect(error.operation).toBe('store');
    });

    it('should have correct properties for get operation', () => {
      const error = new SecureStorageError('Get failed', 'get');

      expect(error.operation).toBe('get');
    });

    it('should have correct properties for delete operation', () => {
      const error = new SecureStorageError('Delete failed', 'delete');

      expect(error.operation).toBe('delete');
    });

    it('should have correct properties for has operation', () => {
      const error = new SecureStorageError('Has failed', 'has');

      expect(error.operation).toBe('has');
    });
  });

  describe('integration tests', () => {
    let secureStorageService: typeof import('./index').secureStorageService;

    beforeEach(async () => {
      const module = await import('./index');
      secureStorageService = module.secureStorageService;
    });

    it('should store and retrieve value correctly', async () => {
      await secureStorageService.store('test-key', 'test-value');
      const result = await secureStorageService.get('test-key');

      expect(result).toBe('test-value');
    });

    it('should store, check existence, and delete correctly', async () => {
      await secureStorageService.store('lifecycle-key', 'lifecycle-value');

      expect(await secureStorageService.has('lifecycle-key')).toBe(true);

      await secureStorageService.delete('lifecycle-key');

      expect(await secureStorageService.has('lifecycle-key')).toBe(false);
      expect(await secureStorageService.get('lifecycle-key')).toBeNull();
    });

    it('should handle JSON round-trip correctly', async () => {
      const complexData = {
        name: 'test',
        nested: { value: 123 },
        array: [1, 2, 3],
      };

      await secureStorageService.storeJSON('complex-key', complexData);
      const result = await secureStorageService.getJSON<typeof complexData>('complex-key');

      expect(result).toEqual(complexData);
    });
  });
});
