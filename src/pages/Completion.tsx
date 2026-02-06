import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTransactionStore } from '@stores/transactionStore';
import { useOrchestratorStore } from '@stores/orchestratorStore';
import { useUsdcTransactionStore } from '@stores/usdcTransactionStore';
import { useAppStore } from '@stores/appStore';
import { CheckIcon, LockIcon, CopyIcon } from '@components/common/Icons';
import { generateReferenceId } from '@utils/reference';

function Completion() {
  const navigate = useNavigate();

  // Legacy transaction store
  const { currentTransaction, clearTransaction } = useTransactionStore();

  // New orchestrator store
  const {
    transaction: orchestratorTx,
    currentPhase: orchestratorPhase,
    clearTransaction: clearOrchestratorTx,
  } = useOrchestratorStore();

  // USDC transaction store
  const {
    currentTransaction: usdcTx,
    currentPhase: usdcPhase,
    clearTransaction: clearUsdcTx,
  } = useUsdcTransactionStore();

  const { isDemo, exitDemo } = useAppStore();

  // Determine which transaction system is being used (priority: USDC > Orchestrator > Legacy)
  const isUsingUsdc = usdcTx !== null && usdcPhase === 'COMPLETE';
  const isUsingOrchestrator = !isUsingUsdc && orchestratorTx !== null;
  const activeTx = isUsingUsdc ? usdcTx : isUsingOrchestrator ? orchestratorTx : currentTransaction;
  const activePhase = isUsingUsdc ? usdcPhase : isUsingOrchestrator ? orchestratorPhase : currentTransaction?.phase;

  // Generate stable reference ID for this transaction
  // Use useMemo to ensure the same ID is generated for the same transaction
  const referenceId = useMemo(() => {
    if (!activeTx) return '';
    // Generate a new non-linking reference ID
    // This is NOT derived from any on-chain data for privacy
    return generateReferenceId();
  }, [activeTx?.id]); // Only regenerate if transaction ID changes

  // Copy state for reference ID
  const [copied, setCopied] = useState(false);

  // Copy reference ID to clipboard
  const copyReferenceId = useCallback(async () => {
    if (!referenceId) return;
    try {
      await navigator.clipboard.writeText(referenceId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [referenceId]);

  // Redirect if no completed transaction
  useEffect(() => {
    if (!activeTx || activePhase !== 'COMPLETE') {
      navigate('/');
    }
  }, [activeTx, activePhase, navigate]);

  const handleSendAnother = () => {
    if (isUsingUsdc) {
      clearUsdcTx();
      navigate('/send-usdc');
    } else if (isUsingOrchestrator) {
      clearOrchestratorTx();
      navigate('/send');
    } else {
      clearTransaction();
      navigate('/send');
    }
  };

  const handleBackToHome = () => {
    if (isUsingUsdc) {
      clearUsdcTx();
    } else if (isUsingOrchestrator) {
      clearOrchestratorTx();
    } else {
      clearTransaction();
    }
    if (isDemo) {
      exitDemo();
    }
    navigate('/');
  };

  if (!activeTx) return null;

  // Get transaction details based on which system is being used
  const amount = isUsingUsdc
    ? parseFloat(usdcTx!.amount)
    : isUsingOrchestrator
      ? parseFloat(orchestratorTx!.params.amount)
      : parseFloat(currentTransaction!.amount);

  // The delivered amount is the payment amount (denomination), NOT amount minus fees.
  // Fees are paid by the sender during bridging, not deducted from recipient.
  // For privacy pool transactions, the recipient receives the full denomination.
  // The sender pays: amount + bridge fees + gas costs.
  // The recipient receives: amount (the denomination).
  const delivered = amount;
  const recipient = isUsingUsdc
    ? usdcTx!.recipient
    : isUsingOrchestrator
      ? orchestratorTx!.params.recipient
      : currentTransaction!.recipient;
  const truncatedRecipient = `${recipient.slice(0, 8)}...${recipient.slice(-4)}`;

  // Determine asset type
  const assetSymbol = isUsingUsdc ? 'USDC' : 'XRP';

  // Get completion time
  const completedAt = isUsingUsdc
    ? usdcTx!.completedAt
    : isUsingOrchestrator
      ? orchestratorTx!.completedAt
      : currentTransaction!.completedAt;

  // Format completion time with date
  const completionTime = completedAt
    ? new Date(completedAt).toLocaleString([], {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : 'Just now';

  // Calculate transaction duration (for orchestrator or USDC)
  const duration = isUsingUsdc && usdcTx!.completedAt
    ? Math.round((usdcTx!.completedAt - usdcTx!.startedAt) / 1000)
    : isUsingOrchestrator && orchestratorTx!.completedAt
      ? Math.round((orchestratorTx!.completedAt - orchestratorTx!.startedAt) / 1000)
      : null;

  const formatDuration = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  };

  return (
    <div className="flex-1 flex items-start justify-center px-4 py-8">
      <div className="w-full max-w-md text-center">
        {/* Success Icon */}
        <div className="w-20 h-20 mx-auto mb-8 flex items-center justify-center bg-gradient-to-br from-gold to-gold-dim rounded-full animate-scale-in">
          <CheckIcon className="w-10 h-10 text-obsidian" />
        </div>

        {/* Title */}
        <h2 className="font-display text-3xl font-medium mb-2">Payment Complete</h2>
        <p className="text-lg text-platinum-dim mb-8">
          <strong className="text-platinum font-semibold">{delivered.toFixed(2)} {assetSymbol}</strong> delivered
        </p>

        {/* Details Card */}
        <div className="card p-5 mb-6 text-left">
          <div className="flex justify-between items-center py-3 border-b border-slate">
            <span className="text-sm text-platinum-dim">Recipient</span>
            <span className="font-display text-sm text-platinum">{truncatedRecipient}</span>
          </div>
          <div className="flex justify-between items-center py-3 border-b border-slate">
            <span className="text-sm text-platinum-dim">Completed</span>
            <span className="font-display text-sm text-platinum">{completionTime}</span>
          </div>
          <div className="flex justify-between items-center py-3 border-b border-slate">
            <span className="text-sm text-platinum-dim">Reference</span>
            <button
              onClick={copyReferenceId}
              className="flex items-center gap-1.5 group"
              title="Copy reference ID"
            >
              <span className="font-display text-sm text-gold font-medium">
                {referenceId}
              </span>
              <CopyIcon
                className={`w-3.5 h-3.5 transition-colors ${
                  copied
                    ? 'text-teal-bright'
                    : 'text-platinum-dim group-hover:text-platinum'
                }`}
              />
              {copied && (
                <span className="text-xs text-teal-bright ml-1">Copied!</span>
              )}
            </button>
          </div>
          {duration && (
            <div className="flex justify-between items-center py-3">
              <span className="text-sm text-platinum-dim">Duration</span>
              <span className="font-display text-sm text-platinum">{formatDuration(duration)}</span>
            </div>
          )}
        </div>

        {/* Privacy Confirmation */}
        <div className="flex items-center justify-center gap-2 p-4 bg-teal/10 border border-teal rounded-md mb-8">
          <LockIcon className="w-4 h-4 text-teal-bright" />
          <span className="text-sm text-teal-bright">
            No link exists between you and this payment
          </span>
        </div>

        {/* Transaction Details (Expandable) - For USDC transactions */}
        {isUsingUsdc && usdcTx && (
          <details className="mb-6 text-left">
            <summary className="text-xs text-platinum-dim cursor-pointer hover:text-platinum">
              View Transaction Details
            </summary>
            <div className="mt-2 p-3 bg-slate/20 rounded-md text-xs font-mono">
              {usdcTx.txHashes.xrplBridge && (
                <div className="mb-2">
                  <div className="text-platinum-dim">USDC Bridge TX (XRPL → EVM):</div>
                  <div className="text-teal-bright break-all">{usdcTx.txHashes.xrplBridge}</div>
                </div>
              )}
              {usdcTx.txHashes.approval && (
                <div className="mb-2">
                  <div className="text-platinum-dim">ERC-20 Approval TX:</div>
                  <div className="text-teal-bright break-all">{usdcTx.txHashes.approval}</div>
                </div>
              )}
              {usdcTx.txHashes.deposit && (
                <div className="mb-2">
                  <div className="text-platinum-dim">Privacy Pool Deposit TX:</div>
                  <div className="text-teal-bright break-all">{usdcTx.txHashes.deposit}</div>
                </div>
              )}
              {usdcTx.txHashes.withdraw && (
                <div className="mb-2">
                  <div className="text-platinum-dim">Privacy Pool Withdraw TX:</div>
                  <div className="text-teal-bright break-all">{usdcTx.txHashes.withdraw}</div>
                </div>
              )}
              {usdcTx.txHashes.evmBridge && (
                <div>
                  <div className="text-platinum-dim">USDC Bridge TX (EVM → XRPL):</div>
                  <div className="text-teal-bright break-all">{usdcTx.txHashes.evmBridge}</div>
                </div>
              )}
              {usdcTx.depositData && (
                <div className="mt-3 pt-3 border-t border-slate">
                  <div className="text-platinum-dim">Privacy Pool Leaf Index:</div>
                  <div className="text-platinum">#{usdcTx.depositData.leafIndex}</div>
                </div>
              )}
            </div>
          </details>
        )}

        {/* Transaction Details (Expandable) - For XRP orchestrator transactions */}
        {isUsingOrchestrator && orchestratorTx && (
          <details className="mb-6 text-left">
            <summary className="text-xs text-platinum-dim cursor-pointer hover:text-platinum">
              View Transaction Details
            </summary>
            <div className="mt-2 p-3 bg-slate/20 rounded-md text-xs font-mono">
              {orchestratorTx.txHashes.xrplBridge && (
                <div className="mb-2">
                  <div className="text-platinum-dim">XRPL Bridge TX:</div>
                  <div className="text-teal-bright break-all">{orchestratorTx.txHashes.xrplBridge}</div>
                </div>
              )}
              {orchestratorTx.txHashes.deposit && (
                <div className="mb-2">
                  <div className="text-platinum-dim">Deposit TX:</div>
                  <div className="text-teal-bright break-all">{orchestratorTx.txHashes.deposit}</div>
                </div>
              )}
              {orchestratorTx.txHashes.withdraw && (
                <div className="mb-2">
                  <div className="text-platinum-dim">Withdraw TX:</div>
                  <div className="text-teal-bright break-all">{orchestratorTx.txHashes.withdraw}</div>
                </div>
              )}
              {orchestratorTx.txHashes.evmBridge && (
                <div>
                  <div className="text-platinum-dim">EVM Bridge TX:</div>
                  <div className="text-teal-bright break-all">{orchestratorTx.txHashes.evmBridge}</div>
                </div>
              )}
              {orchestratorTx.depositData && (
                <div className="mt-3 pt-3 border-t border-slate">
                  <div className="text-platinum-dim">Privacy Pool Leaf Index:</div>
                  <div className="text-platinum">#{orchestratorTx.depositData.leafIndex}</div>
                </div>
              )}
            </div>
          </details>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-3">
          <button onClick={handleSendAnother} className="btn btn-primary w-full">
            Send Another Payment
          </button>
          <button onClick={handleBackToHome} className="btn btn-ghost w-full">
            Back to Home
          </button>
        </div>
      </div>
    </div>
  );
}

export default Completion;
