import '@testing-library/jest-dom';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Mock fetch
global.fetch = vi.fn();

// Mock GemWallet API
vi.mock('@gemwallet/api', () => ({
  isInstalled: vi.fn(() => Promise.resolve({ result: { isInstalled: true } })),
  getNetwork: vi.fn(() => Promise.resolve({ result: { network: 'Mainnet' } })),
  getAddress: vi.fn(() => Promise.resolve({ result: { address: 'rTestAddress123' } })),
  sendPayment: vi.fn(() => Promise.resolve({ result: { hash: 'TEST_HASH_123' } })),
}));

// Mock Tauri API (for secure storage tests)
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});
