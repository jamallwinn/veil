/**
 * Bridge Monitoring Service
 *
 * Provides real-time monitoring of Axelar bridge transactions and connection health.
 * Supports event-based status updates with callbacks for UI integration.
 *
 * Features:
 * - Real-time transaction status polling from Axelar API
 * - Connection health monitoring (EVM provider, GemWallet, Axelar API)
 * - Event-driven architecture with typed callbacks
 * - Automatic reconnection and retry logic
 * - Heartbeat mechanism for connection health
 *
 * @see https://docs.axelar.dev/dev/axelarjs-sdk/tx-status-query-recovery
 */

import {
  axelarBridgeService,
  type BridgeTransaction,
  type BridgeStatus,
  type BridgeStatusType,
  AXELAR_API,
} from './axelar';

// =============================================================================
// Types & Interfaces
// =============================================================================

/**
 * Connection health status
 */
export interface ConnectionHealth {
  evmProvider: {
    connected: boolean;
    chainId: number | null;
    lastCheck: number;
    error?: string;
  };
  gemWallet: {
    installed: boolean;
    lastCheck: number;
    error?: string;
  };
  axelarApi: {
    reachable: boolean;
    latency: number | null; // ms
    lastCheck: number;
    error?: string;
  };
}

/**
 * Monitor configuration
 */
export interface MonitorConfig {
  /** Status polling interval in ms (default: 3000) */
  statusPollInterval?: number;
  /** Health check interval in ms (default: 30000) */
  healthCheckInterval?: number;
  /** Enable automatic health monitoring (default: true) */
  autoHealthCheck?: boolean;
  /** Axelar environment (default: 'mainnet') */
  axelarEnvironment?: 'mainnet' | 'testnet';
}

/**
 * Event types for monitor callbacks
 */
export type MonitorEventType =
  | 'status_update'
  | 'transaction_complete'
  | 'transaction_failed'
  | 'health_update'
  | 'connection_lost'
  | 'connection_restored'
  | 'error';

/**
 * Base event payload
 */
interface BaseEventPayload {
  timestamp: number;
}

/**
 * Status update event payload
 */
export interface StatusUpdatePayload extends BaseEventPayload {
  txHash: string;
  status: BridgeStatus;
  previousStatus?: BridgeStatusType;
}

/**
 * Transaction complete event payload
 */
export interface TransactionCompletePayload extends BaseEventPayload {
  txHash: string;
  transaction: BridgeTransaction;
  duration: number; // ms
}

/**
 * Transaction failed event payload
 */
export interface TransactionFailedPayload extends BaseEventPayload {
  txHash: string;
  transaction: BridgeTransaction;
  error?: string;
}

/**
 * Health update event payload
 */
export interface HealthUpdatePayload extends BaseEventPayload {
  health: ConnectionHealth;
  previousHealth?: ConnectionHealth;
}

/**
 * Connection event payload
 */
export interface ConnectionEventPayload extends BaseEventPayload {
  component: 'evmProvider' | 'gemWallet' | 'axelarApi';
  connected: boolean;
  error?: string;
}

/**
 * Error event payload
 */
export interface ErrorEventPayload extends BaseEventPayload {
  code: string;
  message: string;
  context?: string;
}

/**
 * Event payload union type
 */
export type MonitorEventPayload =
  | StatusUpdatePayload
  | TransactionCompletePayload
  | TransactionFailedPayload
  | HealthUpdatePayload
  | ConnectionEventPayload
  | ErrorEventPayload;

/**
 * Event listener callback type
 */
export type MonitorEventListener<T extends MonitorEventPayload = MonitorEventPayload> = (
  payload: T
) => void;

/**
 * Tracked transaction state
 */
interface TrackedTransaction {
  txHash: string;
  transaction: BridgeTransaction;
  lastStatus: BridgeStatusType;
  startTime: number;
  pollCount: number;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_CONFIG: Required<MonitorConfig> = {
  statusPollInterval: 3000,
  healthCheckInterval: 30000,
  autoHealthCheck: true,
  axelarEnvironment: 'mainnet',
};

const MONITOR_ERROR_CODES = {
  POLLING_FAILED: 'MONITOR_POLLING_FAILED',
  HEALTH_CHECK_FAILED: 'MONITOR_HEALTH_CHECK_FAILED',
  API_UNREACHABLE: 'MONITOR_API_UNREACHABLE',
  TRANSACTION_NOT_FOUND: 'MONITOR_TX_NOT_FOUND',
} as const;

// =============================================================================
// BridgeMonitorService Class
// =============================================================================

class BridgeMonitorService {
  private config: Required<MonitorConfig>;
  private trackedTransactions: Map<string, TrackedTransaction> = new Map();
  private listeners: Map<MonitorEventType, Set<MonitorEventListener>> = new Map();
  private statusPollInterval: NodeJS.Timeout | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private lastHealth: ConnectionHealth | null = null;
  private isRunning: boolean = false;

  constructor(config?: MonitorConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize listener maps
    this.listeners.set('status_update', new Set());
    this.listeners.set('transaction_complete', new Set());
    this.listeners.set('transaction_failed', new Set());
    this.listeners.set('health_update', new Set());
    this.listeners.set('connection_lost', new Set());
    this.listeners.set('connection_restored', new Set());
    this.listeners.set('error', new Set());
  }

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Start the monitoring service
   */
  start(): void {
    if (this.isRunning) {
      console.warn('[BridgeMonitor] Already running');
      return;
    }

    this.isRunning = true;
    console.log('[BridgeMonitor] Starting monitoring service');

    // Start status polling
    this.startStatusPolling();

    // Start health checks if enabled
    if (this.config.autoHealthCheck) {
      this.startHealthMonitoring();
    }
  }

  /**
   * Stop the monitoring service
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    console.log('[BridgeMonitor] Stopping monitoring service');

    // Stop polling intervals
    if (this.statusPollInterval) {
      clearInterval(this.statusPollInterval);
      this.statusPollInterval = null;
    }

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Check if monitor is running
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Track a transaction for status updates
   */
  trackTransaction(txHash: string): void {
    if (this.trackedTransactions.has(txHash)) {
      console.warn(`[BridgeMonitor] Transaction ${txHash} already tracked`);
      return;
    }

    const transaction = axelarBridgeService.getTransaction(txHash);
    if (!transaction) {
      this.emitError(
        MONITOR_ERROR_CODES.TRANSACTION_NOT_FOUND,
        `Transaction ${txHash} not found in bridge service`,
        'trackTransaction'
      );
      return;
    }

    this.trackedTransactions.set(txHash, {
      txHash,
      transaction,
      lastStatus: transaction.status,
      startTime: Date.now(),
      pollCount: 0,
    });

    console.log(`[BridgeMonitor] Now tracking transaction: ${txHash}`);
  }

  /**
   * Stop tracking a transaction
   */
  untrackTransaction(txHash: string): void {
    if (this.trackedTransactions.delete(txHash)) {
      console.log(`[BridgeMonitor] Stopped tracking transaction: ${txHash}`);
    }
  }

  /**
   * Get all tracked transactions
   */
  getTrackedTransactions(): BridgeTransaction[] {
    return Array.from(this.trackedTransactions.values()).map((t) => t.transaction);
  }

  /**
   * Get current connection health
   */
  async getHealth(): Promise<ConnectionHealth> {
    return await this.checkConnectionHealth();
  }

  /**
   * Subscribe to monitor events
   */
  on<T extends MonitorEventPayload>(
    event: MonitorEventType,
    listener: MonitorEventListener<T>
  ): () => void {
    const listeners = this.listeners.get(event);
    if (listeners) {
      listeners.add(listener as MonitorEventListener);
    }

    // Return unsubscribe function
    return () => {
      listeners?.delete(listener as MonitorEventListener);
    };
  }

  /**
   * Remove all listeners for an event type
   */
  off(event: MonitorEventType): void {
    this.listeners.get(event)?.clear();
  }

  /**
   * Remove all listeners
   */
  removeAllListeners(): void {
    for (const listeners of this.listeners.values()) {
      listeners.clear();
    }
  }

  /**
   * Manually trigger a status check for a specific transaction
   */
  async checkTransactionStatus(txHash: string): Promise<BridgeStatus | null> {
    try {
      return await axelarBridgeService.getBridgeStatus(txHash);
    } catch (error) {
      console.error(`[BridgeMonitor] Failed to check status for ${txHash}:`, error);
      return null;
    }
  }

  /**
   * Update monitor configuration
   */
  updateConfig(config: Partial<MonitorConfig>): void {
    const wasRunning = this.isRunning;

    if (wasRunning) {
      this.stop();
    }

    this.config = { ...this.config, ...config };

    if (wasRunning) {
      this.start();
    }
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Start status polling for tracked transactions
   */
  private startStatusPolling(): void {
    this.statusPollInterval = setInterval(async () => {
      await this.pollTrackedTransactions();
    }, this.config.statusPollInterval);

    // Immediate first poll
    this.pollTrackedTransactions();
  }

  /**
   * Poll status for all tracked transactions
   */
  private async pollTrackedTransactions(): Promise<void> {
    for (const [txHash, tracked] of this.trackedTransactions) {
      try {
        const status = await axelarBridgeService.getBridgeStatus(txHash);
        tracked.pollCount++;

        // Check for status change
        if (status.status !== tracked.lastStatus) {
          const previousStatus = tracked.lastStatus;
          tracked.lastStatus = status.status;

          // Update transaction reference
          const updatedTx = axelarBridgeService.getTransaction(txHash);
          if (updatedTx) {
            tracked.transaction = updatedTx;
          }

          // Emit status update event
          this.emit('status_update', {
            timestamp: Date.now(),
            txHash,
            status,
            previousStatus,
          });

          // Check for terminal states
          if (status.status === 'complete') {
            this.emit('transaction_complete', {
              timestamp: Date.now(),
              txHash,
              transaction: tracked.transaction,
              duration: Date.now() - tracked.startTime,
            });

            // Auto-untrack completed transactions
            this.trackedTransactions.delete(txHash);
          } else if (status.status === 'failed') {
            this.emit('transaction_failed', {
              timestamp: Date.now(),
              txHash,
              transaction: tracked.transaction,
              error: 'Transaction failed',
            });

            // Auto-untrack failed transactions
            this.trackedTransactions.delete(txHash);
          }
        }
      } catch (error) {
        this.emitError(
          MONITOR_ERROR_CODES.POLLING_FAILED,
          `Failed to poll status for ${txHash}`,
          'pollTrackedTransactions'
        );
      }
    }
  }

  /**
   * Start health monitoring
   */
  private startHealthMonitoring(): void {
    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthCheck();
    }, this.config.healthCheckInterval);

    // Immediate first check
    this.performHealthCheck();
  }

  /**
   * Perform health check on all connections
   */
  private async performHealthCheck(): Promise<void> {
    try {
      const health = await this.checkConnectionHealth();
      const previousHealth = this.lastHealth;

      // Check for connection state changes
      if (previousHealth) {
        // EVM Provider
        if (previousHealth.evmProvider.connected !== health.evmProvider.connected) {
          this.emitConnectionEvent('evmProvider', health.evmProvider.connected, health.evmProvider.error);
        }

        // GemWallet
        if (previousHealth.gemWallet.installed !== health.gemWallet.installed) {
          this.emitConnectionEvent('gemWallet', health.gemWallet.installed, health.gemWallet.error);
        }

        // Axelar API
        if (previousHealth.axelarApi.reachable !== health.axelarApi.reachable) {
          this.emitConnectionEvent('axelarApi', health.axelarApi.reachable, health.axelarApi.error);
        }
      }

      this.lastHealth = health;

      // Emit health update
      this.emit('health_update', {
        timestamp: Date.now(),
        health,
        previousHealth: previousHealth ?? undefined,
      });
    } catch (error) {
      this.emitError(
        MONITOR_ERROR_CODES.HEALTH_CHECK_FAILED,
        'Health check failed',
        'performHealthCheck'
      );
    }
  }

  /**
   * Check connection health for all components
   */
  private async checkConnectionHealth(): Promise<ConnectionHealth> {
    const now = Date.now();

    // Check EVM provider
    let evmProviderHealth: ConnectionHealth['evmProvider'] = {
      connected: false,
      chainId: null,
      lastCheck: now,
    };

    try {
      const evmStatus = await axelarBridgeService.checkEVMConnection();
      if (evmStatus) {
        evmProviderHealth = {
          connected: evmStatus.connected,
          chainId: evmStatus.chainId,
          lastCheck: now,
        };
      }
    } catch (error) {
      evmProviderHealth.error = error instanceof Error ? error.message : 'Unknown error';
    }

    // Check GemWallet
    let gemWalletHealth: ConnectionHealth['gemWallet'] = {
      installed: false,
      lastCheck: now,
    };

    try {
      const gemWalletInstalled = await axelarBridgeService.checkGemWalletConnection();
      gemWalletHealth = {
        installed: gemWalletInstalled,
        lastCheck: now,
      };
    } catch (error) {
      gemWalletHealth.error = error instanceof Error ? error.message : 'Unknown error';
    }

    // Check Axelar API
    let axelarApiHealth: ConnectionHealth['axelarApi'] = {
      reachable: false,
      latency: null,
      lastCheck: now,
    };

    try {
      const apiResult = await this.pingAxelarApi();
      axelarApiHealth = {
        reachable: apiResult.reachable,
        latency: apiResult.latency,
        lastCheck: now,
      };
    } catch (error) {
      axelarApiHealth.error = error instanceof Error ? error.message : 'Unknown error';
    }

    return {
      evmProvider: evmProviderHealth,
      gemWallet: gemWalletHealth,
      axelarApi: axelarApiHealth,
    };
  }

  /**
   * Ping Axelar API to check reachability
   */
  private async pingAxelarApi(): Promise<{ reachable: boolean; latency: number | null }> {
    const apiBase = this.config.axelarEnvironment === 'mainnet'
      ? AXELAR_API.MAINNET
      : AXELAR_API.TESTNET;

    const startTime = performance.now();

    try {
      // Use a simple health endpoint or just check if API responds
      const response = await fetch(`${apiBase}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000), // 5 second timeout
      });

      const latency = Math.round(performance.now() - startTime);

      return {
        reachable: response.ok,
        latency,
      };
    } catch {
      // If /health doesn't exist, try root
      try {
        const response = await fetch(apiBase, {
          method: 'HEAD',
          signal: AbortSignal.timeout(5000),
        });

        const latency = Math.round(performance.now() - startTime);

        return {
          reachable: response.ok,
          latency,
        };
      } catch {
        return {
          reachable: false,
          latency: null,
        };
      }
    }
  }

  /**
   * Emit an event to all registered listeners
   */
  private emit<T extends MonitorEventPayload>(event: MonitorEventType, payload: T): void {
    const listeners = this.listeners.get(event);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(payload);
        } catch (error) {
          console.error(`[BridgeMonitor] Error in ${event} listener:`, error);
        }
      }
    }
  }

  /**
   * Emit a connection event
   */
  private emitConnectionEvent(
    component: ConnectionEventPayload['component'],
    connected: boolean,
    error?: string
  ): void {
    const eventType = connected ? 'connection_restored' : 'connection_lost';
    this.emit(eventType, {
      timestamp: Date.now(),
      component,
      connected,
      error,
    });
  }

  /**
   * Emit an error event
   */
  private emitError(code: string, message: string, context?: string): void {
    console.error(`[BridgeMonitor] ${code}: ${message}`, context);
    this.emit('error', {
      timestamp: Date.now(),
      code,
      message,
      context,
    });
  }
}

// =============================================================================
// Export
// =============================================================================

// Export singleton instance
export const bridgeMonitorService = new BridgeMonitorService();

// Export class for testing and custom configurations
export { BridgeMonitorService };

// Export error codes
export { MONITOR_ERROR_CODES };
