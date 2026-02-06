import { useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTransactionStore, phaseToStage, UserStage } from '@stores/transactionStore';
import { useOrchestratorStore, getStageIndex } from '@stores/orchestratorStore';
import { useAppStore } from '@stores/appStore';
import { useBridgeStore, getBridgeProgress } from '@stores/bridgeStore';
import { CheckIcon } from '@components/common/Icons';

// Stage configuration
const stages: { id: UserStage; name: string; description: string; time: string }[] = [
  { id: 'securing', name: 'Securing Payment', description: 'Initiating bridge transfer', time: '~2 min' },
  { id: 'privacy', name: 'Privacy Layer', description: 'Adding zero-knowledge protection', time: '~3 min' },
  { id: 'delivery', name: 'Delivery', description: 'Completing settlement', time: '~2 min' },
];

function Progress() {
  const navigate = useNavigate();

  // Legacy transaction store (for demo mode compatibility)
  const { currentTransaction, simulateProgress, setPhase, setTxHash } = useTransactionStore();

  // New orchestrator store
  const {
    transaction: orchestratorTx,
    currentPhase: orchestratorPhase,
    currentStage: orchestratorStage,
    progress: orchestratorProgress,
    statusMessage,
    error: orchestratorError,
    isStarting: orchestratorStarting,
  } = useOrchestratorStore();

  const { isDemo } = useAppStore();
  const bridgeState = useBridgeStore();
  const {
    txHash: bridgeTxHash,
    confirmations,
    requiredConfirmations,
    status: bridgeStatus,
    error: bridgeError,
    pollBridgeStatus,
    reset: resetBridge,
  } = bridgeState;

  // Track if bridge polling has been started
  const bridgePollingRef = useRef<(() => void) | null>(null);

  // Track if demo simulation has been started (prevent multiple calls)
  const simulationStartedRef = useRef(false);

  // Use orchestrator state if available, otherwise fall back to legacy
  const isUsingOrchestrator = orchestratorTx !== null;
  const currentPhase = isUsingOrchestrator
    ? orchestratorPhase
    : currentTransaction?.phase || 'IDLE';
  const currentStage = isUsingOrchestrator
    ? orchestratorStage
    : currentTransaction
      ? phaseToStage[currentTransaction.phase]
      : null;
  const displayError = isUsingOrchestrator ? orchestratorError : bridgeError;

  // Redirect if no transaction (but not if orchestrator is starting up)
  useEffect(() => {
    if (!currentTransaction && !orchestratorTx && !orchestratorStarting) {
      navigate('/');
    }
  }, [currentTransaction, orchestratorTx, orchestratorStarting, navigate]);

  // Start simulation in demo mode (legacy behavior)
  // Use ref to prevent multiple simulateProgress calls when currentTransaction updates
  useEffect(() => {
    if (isDemo && currentTransaction && !orchestratorTx && !simulationStartedRef.current) {
      simulationStartedRef.current = true;
      simulateProgress();
    }
  }, [isDemo, currentTransaction, orchestratorTx, simulateProgress]);

  // Reset simulation ref when transaction is cleared
  useEffect(() => {
    if (!currentTransaction) {
      simulationStartedRef.current = false;
    }
  }, [currentTransaction]);

  // Navigate to completion when done
  useEffect(() => {
    if (currentPhase === 'COMPLETE') {
      navigate('/complete');
    }
  }, [currentPhase, navigate]);

  // Handle bridge completion callback (legacy)
  const handleBridgeComplete = useCallback(() => {
    if (!isUsingOrchestrator) {
      // When bridge completes during BRIDGE_TO_EVM phase, advance to SHIELD
      if (currentPhase === 'BRIDGE_TO_EVM') {
        setPhase('SHIELD');
      }
      // When bridge completes during BRIDGE_TO_XRPL phase, complete transaction
      else if (currentPhase === 'BRIDGE_TO_XRPL') {
        setPhase('COMPLETE');
      }
    }
    // Orchestrator handles its own phase transitions
  }, [currentPhase, setPhase, isUsingOrchestrator]);

  // Handle bridge error callback (legacy)
  const handleBridgeError = useCallback((error: string) => {
    console.error('Bridge error:', error);
    // Error state is already set in the bridge store or orchestrator
  }, []);

  // Start bridge polling when we have a transaction hash and are in a bridge phase (legacy)
  useEffect(() => {
    if (isUsingOrchestrator) {
      // Orchestrator handles its own polling
      return;
    }

    const isBridgePhase = currentPhase === 'BRIDGE_TO_EVM' || currentPhase === 'BRIDGE_TO_XRPL';

    if (bridgeTxHash && isBridgePhase && !bridgePollingRef.current) {
      // Store the transaction hash in the transaction store
      if (currentPhase === 'BRIDGE_TO_EVM') {
        setTxHash('xrplBridge', bridgeTxHash);
      } else if (currentPhase === 'BRIDGE_TO_XRPL') {
        setTxHash('evmBridge', bridgeTxHash);
      }

      // Start polling
      bridgePollingRef.current = pollBridgeStatus(
        bridgeTxHash,
        handleBridgeComplete,
        handleBridgeError
      );
    }

    // Cleanup polling when phase changes or component unmounts
    return () => {
      if (bridgePollingRef.current) {
        bridgePollingRef.current();
        bridgePollingRef.current = null;
      }
    };
  }, [
    bridgeTxHash,
    currentPhase,
    pollBridgeStatus,
    handleBridgeComplete,
    handleBridgeError,
    setTxHash,
    isUsingOrchestrator,
  ]);

  // Clean up bridge state when transaction completes or component unmounts
  useEffect(() => {
    return () => {
      resetBridge();
    };
  }, [resetBridge]);

  // Calculate progress percentage
  const getProgress = (): number => {
    if (isUsingOrchestrator) {
      return orchestratorProgress;
    }

    const phaseProgress: Record<string, number> = {
      INITIATE: 5,
      BRIDGE_TO_EVM: 20,
      SHIELD: 35,
      PRIVATE_STATE: 50,
      ZK_PROOF: 65,
      UNSHIELD: 80,
      BRIDGE_TO_XRPL: 95,
      COMPLETE: 100,
    };
    return phaseProgress[currentPhase as string] || 0;
  };

  const progress = getProgress();
  const circumference = 2 * Math.PI * 108; // radius = 108
  const strokeDashoffset = circumference * (1 - progress / 100);

  // Get stage status
  const getStageStatus = (stageId: UserStage): 'pending' | 'active' | 'complete' => {
    const stageOrder: UserStage[] = ['securing', 'privacy', 'delivery'];
    const currentStageIndex = currentStage ? stageOrder.indexOf(currentStage) : -1;
    const stageIndex = stageOrder.indexOf(stageId);

    if (stageIndex < currentStageIndex) return 'complete';
    if (stageIndex === currentStageIndex) return 'active';
    return 'pending';
  };

  // Get current status message with bridge details
  const getStatusMessage = (): string => {
    // Show starting message while orchestrator initializes
    if (orchestratorStarting) {
      return 'Initializing privacy services...';
    }

    // If using orchestrator, use its status message
    if (isUsingOrchestrator && statusMessage) {
      return statusMessage;
    }

    // Show bridge confirmation progress for bridge phases
    if (currentPhase === 'BRIDGE_TO_EVM' || currentPhase === 'BRIDGE_TO_XRPL') {
      if (bridgeError) {
        return 'Bridge error';
      }
      if (bridgeStatus === 'confirming' || bridgeStatus === 'pending') {
        return `Confirming (${confirmations}/${requiredConfirmations})`;
      }
      if (bridgeStatus === 'complete') {
        return 'Bridge complete';
      }
    }

    const messages: Record<string, string> = {
      INITIATE: 'Preparing transaction...',
      BRIDGE_TO_EVM: 'Bridging to EVM...',
      DEPOSIT: 'Depositing to privacy pool...',
      SHIELD: 'Entering privacy pool...',
      WAIT: 'Waiting for privacy...',
      PRIVATE_STATE: 'Waiting for privacy...',
      PROVE: 'Generating ZK proof...',
      ZK_PROOF: 'Generating ZK proof...',
      WITHDRAW: 'Withdrawing from privacy pool...',
      UNSHIELD: 'Exiting privacy pool...',
      BRIDGE_TO_XRPL: 'Bridging to XRPL...',
    };
    return messages[currentPhase as string] || 'Processing...';
  };

  // Get the bridge progress for display
  const bridgeProgress = getBridgeProgress(bridgeState);

  // Get stage index for display
  const stageIndex = isUsingOrchestrator
    ? getStageIndex({ currentStage: orchestratorStage } as Parameters<typeof getStageIndex>[0])
    : (currentStage ? stages.findIndex(s => s.id === currentStage) + 1 : 1);

  // Get transaction data
  const txData = isUsingOrchestrator ? orchestratorTx : currentTransaction;

  // Get the appropriate tx hash based on current phase
  const getTxHashForPhase = (): string | undefined => {
    if (!isUsingOrchestrator) {
      return bridgeTxHash || undefined;
    }
    if (!orchestratorTx?.txHashes) return undefined;

    // Show the most relevant hash for the current phase
    switch (currentPhase) {
      case 'BRIDGE_TO_EVM':
        return orchestratorTx.txHashes.xrplBridge;
      case 'DEPOSIT':
        return orchestratorTx.txHashes.deposit;
      case 'WITHDRAW':
        return orchestratorTx.txHashes.withdraw;
      case 'BRIDGE_TO_XRPL':
        return orchestratorTx.txHashes.evmBridge;
      default:
        // For other phases, show the most recent hash available
        return (
          orchestratorTx.txHashes.evmBridge ||
          orchestratorTx.txHashes.withdraw ||
          orchestratorTx.txHashes.deposit ||
          orchestratorTx.txHashes.xrplBridge
        );
    }
  };

  const txHash = getTxHashForPhase();

  // Show loading state while orchestrator is starting or if no transaction data yet
  if (!txData && !orchestratorStarting) return null;

  return (
    <div className="flex-1 flex items-start justify-center px-4 py-8">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-12">
          <h2 className="font-display text-2xl font-medium mb-2">Payment in Progress</h2>
          <p className="text-base text-platinum-dim">
            {isDemo ? 'Demo: ~10 seconds' : 'Estimated time: 5-10 minutes'}
          </p>
        </div>

        {/* Vault Progress Ring */}
        <div className="relative w-60 h-60 mx-auto mb-12">
          <svg className="absolute inset-0" viewBox="0 0 240 240">
            {/* Background ring */}
            <circle
              cx="120"
              cy="120"
              r="108"
              fill="none"
              stroke="currentColor"
              strokeWidth="4"
              className="text-slate"
            />
            {/* Progress ring */}
            <circle
              cx="120"
              cy="120"
              r="108"
              fill="none"
              stroke="currentColor"
              strokeWidth="4"
              strokeLinecap="round"
              className="text-gold transition-all duration-1000 ease-out-expo"
              style={{
                strokeDasharray: circumference,
                strokeDashoffset,
                transform: 'rotate(-90deg)',
                transformOrigin: 'center',
              }}
            />
          </svg>

          {/* Center content */}
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <div className="text-xs font-medium tracking-wider uppercase text-platinum-dim mb-1">
              Stage {stageIndex} of 3
            </div>
            <div className={`font-display text-base font-medium ${displayError ? 'text-red-400' : 'text-platinum'}`}>
              {getStatusMessage()}
            </div>
            {/* Show bridge confirmations during bridge phases */}
            {(currentPhase === 'BRIDGE_TO_EVM' || currentPhase === 'BRIDGE_TO_XRPL') &&
              bridgeStatus &&
              bridgeStatus !== 'failed' &&
              !isUsingOrchestrator && (
                <div className="text-xs text-platinum-dim mt-1">
                  {bridgeProgress}% confirmed
                </div>
              )}
            {/* Show overall progress for orchestrator */}
            {isUsingOrchestrator && (
              <div className="text-xs text-platinum-dim mt-1">
                {progress}% complete
              </div>
            )}
          </div>
        </div>

        {/* Transaction Hash Display */}
        {txHash && (
          <div className="text-center mb-8">
            <div className="text-xs text-platinum-dim mb-1">
              {currentPhase === 'DEPOSIT' ? 'Deposit TX' :
               currentPhase === 'WITHDRAW' ? 'Withdraw TX' :
               currentPhase === 'BRIDGE_TO_EVM' ? 'Bridge TX' :
               currentPhase === 'BRIDGE_TO_XRPL' ? 'Bridge TX' :
               'Transaction Hash'}
            </div>
            <div className="font-mono text-xs text-teal-bright break-all px-4">
              {txHash.slice(0, 16)}...{txHash.slice(-8)}
            </div>
          </div>
        )}

        {/* Error Display */}
        {displayError && (
          <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-4 mb-8 text-center">
            <div className="text-red-400 text-sm font-medium mb-1">
              {isUsingOrchestrator ? 'Transaction Error' : 'Bridge Error'}
            </div>
            <div className="text-red-300 text-xs">{displayError}</div>
          </div>
        )}

        {/* Stages List */}
        <div className="max-w-sm mx-auto">
          {stages.map((stage, index) => {
            const status = getStageStatus(stage.id);

            return (
              <div
                key={stage.id}
                className={`
                  flex items-center gap-4 py-4
                  ${index < stages.length - 1 ? 'border-b border-slate' : ''}
                `}
              >
                {/* Indicator */}
                <div
                  className={`
                    w-8 h-8 flex items-center justify-center rounded-full border-2 flex-shrink-0
                    transition-all duration-300
                    ${status === 'complete' ? 'border-gold bg-gold text-obsidian' : ''}
                    ${status === 'active' ? 'border-teal text-teal-bright animate-pulse' : ''}
                    ${status === 'pending' ? 'border-slate text-platinum-dim' : ''}
                  `}
                >
                  {status === 'complete' ? (
                    <CheckIcon className="w-4 h-4" />
                  ) : status === 'active' ? (
                    <div className="spinner" />
                  ) : (
                    <span className="text-sm font-medium">{index + 1}</span>
                  )}
                </div>

                {/* Content */}
                <div className="flex-1">
                  <div
                    className={`text-base font-medium mb-0.5 ${status === 'pending' ? 'text-platinum-dim' : 'text-platinum'}`}
                  >
                    {stage.name}
                  </div>
                  <div className="text-sm text-platinum-dim">{stage.description}</div>
                </div>

                {/* Time */}
                <div className="text-xs text-platinum-dim">{stage.time}</div>
              </div>
            );
          })}
        </div>

        {/* Technical Details (Expandable) - Only for orchestrator */}
        {isUsingOrchestrator && orchestratorTx && (
          <details className="mt-8 text-xs text-platinum-dim">
            <summary className="cursor-pointer hover:text-platinum">
              Technical Details
            </summary>
            <div className="mt-2 p-3 bg-slate/20 rounded-md font-mono">
              <div>ID: {orchestratorTx.id}</div>
              <div>Phase: {orchestratorPhase}</div>
              <div>Status: {orchestratorTx.phaseStatus}</div>
              <div>Retries: {orchestratorTx.retryCount}/{orchestratorTx.maxRetries}</div>
              {orchestratorTx.depositData && (
                <>
                  <div className="mt-2">Deposit:</div>
                  <div className="pl-2">Leaf: #{orchestratorTx.depositData.leafIndex}</div>
                  <div className="pl-2 truncate">
                    Commitment: {orchestratorTx.depositData.commitment.slice(0, 16)}...
                  </div>
                </>
              )}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

export default Progress;
