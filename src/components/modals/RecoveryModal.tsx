/**
 * Recovery Modal Component
 *
 * Displayed when the app detects a pending transaction on launch.
 * Allows the user to resume or abandon the transaction.
 */

import { useState } from 'react';
import { useOrchestratorStore } from '@stores/orchestratorStore';
import { transactionPersistenceService } from '@services/orchestrator';
import { ClockIcon, PlayIcon } from '@components/common/Icons';
import type { OrchestratorTransaction } from '@services/orchestrator';

// =============================================================================
// Types
// =============================================================================

interface RecoveryModalProps {
  isOpen: boolean;
  onResume: () => void;
  onAbandon: () => void;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Format an XRPL address for display (rABC...xyz)
 */
function formatAddress(address: string): string {
  if (!address || address.length <= 12) return address || 'Unknown';
  return `${address.slice(0, 5)}...${address.slice(-5)}`;
}

/**
 * Format a timestamp as relative time (e.g., "5 minutes ago")
 */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days} day${days > 1 ? 's' : ''} ago`;
  }
  if (hours > 0) {
    return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  }
  if (minutes > 0) {
    return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  }
  return 'Just now';
}

/**
 * Get user-friendly phase name
 */
function getPhaseName(phase: OrchestratorTransaction['currentPhase']): string {
  const phaseNames: Record<string, string> = {
    INITIATE: 'Initiation',
    BRIDGE_TO_EVM: 'Bridge to EVM',
    DEPOSIT: 'Deposit',
    WAIT: 'Waiting',
    PROVE: 'Proof Generation',
    WITHDRAW: 'Withdrawal',
    BRIDGE_TO_XRPL: 'Bridge to XRPL',
    COMPLETE: 'Complete',
    FAILED: 'Failed',
  };
  return phaseNames[phase] || phase;
}

// =============================================================================
// Component
// =============================================================================

export function RecoveryModal({ isOpen, onResume, onAbandon }: RecoveryModalProps) {
  const { recoveryTransaction } = useOrchestratorStore();
  const [isResuming, setIsResuming] = useState(false);
  const [isAbandoning, setIsAbandoning] = useState(false);

  // Handle resume click
  const handleResume = async () => {
    setIsResuming(true);
    try {
      onResume();
    } catch {
      setIsResuming(false);
    }
  };

  // Handle abandon click
  const handleAbandon = async () => {
    setIsAbandoning(true);
    try {
      // Clear the pending transaction
      await transactionPersistenceService.clearActiveTransaction();
      onAbandon();
    } catch (error) {
      console.error('Failed to abandon transaction:', error);
    } finally {
      setIsAbandoning(false);
    }
  };

  // Don't render if not open or no transaction
  if (!isOpen || !recoveryTransaction) {
    return null;
  }

  const tx = recoveryTransaction;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-obsidian/90 backdrop-blur-sm"
        onClick={() => {}} // Prevent closing on backdrop click
      />

      {/* Modal */}
      <div className="relative w-full max-w-md bg-charcoal border border-slate rounded-xl shadow-2xl animate-scale-in">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-slate">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center bg-gold/10 border border-gold/30 rounded-full">
              <ClockIcon className="w-5 h-5 text-gold" />
            </div>
            <div>
              <h2 className="font-display text-lg font-medium text-platinum">
                Pending Transaction Found
              </h2>
              <p className="text-sm text-platinum-dim">
                A transaction was interrupted
              </p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {/* Transaction details */}
          <div className="space-y-3">
            <DetailRow label="Amount" value={`${tx.params.amount} XRP`} />
            <DetailRow
              label="Recipient"
              value={formatAddress(tx.params.recipient)}
              mono
            />
            <DetailRow
              label="Last Phase"
              value={getPhaseName(tx.currentPhase)}
              highlight
            />
            <DetailRow
              label="Started"
              value={formatRelativeTime(tx.startedAt)}
            />
            {tx.retryCount > 0 && (
              <DetailRow
                label="Retry Attempts"
                value={`${tx.retryCount}/${tx.maxRetries}`}
              />
            )}
          </div>

          {/* Info message */}
          <div className="p-3 bg-slate/30 border border-slate rounded-lg">
            <p className="text-sm text-platinum-dim leading-relaxed">
              Your transaction can be resumed from where it left off. All progress
              has been saved.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 pt-2 flex gap-3">
          <button
            onClick={handleAbandon}
            disabled={isResuming || isAbandoning}
            className={`
              flex-1 px-4 py-3 rounded-lg font-medium text-sm
              border border-slate text-platinum-dim
              hover:border-platinum-dim hover:text-platinum
              transition-all duration-200
              disabled:opacity-50 disabled:cursor-not-allowed
            `}
          >
            {isAbandoning ? (
              <span className="flex items-center justify-center gap-2">
                <span className="spinner" />
                Clearing...
              </span>
            ) : (
              'Start Fresh'
            )}
          </button>

          <button
            onClick={handleResume}
            disabled={isResuming || isAbandoning}
            className={`
              flex-1 px-4 py-3 rounded-lg font-medium text-sm
              bg-gold text-obsidian
              hover:bg-gold-bright
              transition-all duration-200
              disabled:opacity-50 disabled:cursor-not-allowed
            `}
          >
            {isResuming ? (
              <span className="flex items-center justify-center gap-2">
                <span className="spinner" />
                Resuming...
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <PlayIcon className="w-4 h-4" />
                Resume
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Sub-components
// =============================================================================

interface DetailRowProps {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: boolean;
}

function DetailRow({ label, value, mono, highlight }: DetailRowProps) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-sm text-platinum-dim">{label}</span>
      <span
        className={`
          text-sm
          ${mono ? 'font-mono' : ''}
          ${highlight ? 'text-teal-bright font-medium' : 'text-platinum'}
        `}
      >
        {value}
      </span>
    </div>
  );
}

export default RecoveryModal;
