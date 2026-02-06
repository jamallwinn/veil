/**
 * Bridge Service Index
 *
 * Barrel exports for the Axelar bridge service and monitoring.
 * Provides cross-chain transfers between XRPL Mainnet and XRPL EVM Sidechain.
 */

// =============================================================================
// Axelar Bridge Service
// =============================================================================

// Service singleton and class
export { axelarBridgeService, AxelarBridgeService } from './axelar';

// Types
export type {
  BridgeDirection,
  BridgeStatusType,
  BridgeResult,
  BridgeStatus,
  BridgeEstimate,
  BridgeTransaction,
  BridgeServiceConfig,
  AxelarGMPStatus,
  AxelarDepositAddressResponse,
  AxelarStatusResponse,
} from './axelar';

// Constants
export {
  XRPL_EVM_CHAIN_ID,
  AXELAR_CHAIN_IDS,
  AXELAR_API,
  BRIDGE_CONFIG,
} from './axelar';

// Utilities (for testing)
export { bridgeUtils } from './axelar';

// =============================================================================
// Bridge Monitoring Service
// =============================================================================

// Service singleton and class
export { bridgeMonitorService, BridgeMonitorService } from './monitor';

// Types
export type {
  ConnectionHealth,
  MonitorConfig,
  MonitorEventType,
  MonitorEventPayload,
  MonitorEventListener,
  StatusUpdatePayload,
  TransactionCompletePayload,
  TransactionFailedPayload,
  HealthUpdatePayload,
  ConnectionEventPayload,
  ErrorEventPayload,
} from './monitor';

// Constants
export { MONITOR_ERROR_CODES } from './monitor';

// =============================================================================
// Squid Router Bridge Service
// =============================================================================

// Service singleton and class
export { squidRouterService, SquidRouterService } from './squidRouter';

// Types
export type {
  SquidRouteParams,
  SquidRouteResponse,
  SquidStatusParams,
  SquidTransactionStatus,
  SquidStatusResponse,
  SquidBridgeResult,
  SquidServiceConfig,
} from './squidRouter';

// Constants
export {
  SQUID_API,
  SQUID_CHAIN_IDS,
  SQUID_CONTRACTS,
  NATIVE_TOKEN_ADDRESS,
} from './squidRouter';
