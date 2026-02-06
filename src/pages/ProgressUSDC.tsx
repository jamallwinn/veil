import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUsdcTransactionStore, phaseToStage, UserStage } from '@stores/usdcTransactionStore';
import { useAppStore } from '@stores/appStore';
import { CheckIcon } from '@components/common/Icons';

// USDC Constants
const USDC_SYMBOL = 'USDC';

// Stage configuration for USDC (same 3 stages as XRP)
const stages: { id: UserStage; name: string; description: string; time: string }[] = [
  { id: 'securing', name: 'Securing Payment', description: 'Approving and bridging USDC', time: '~3 min' },
  { id: 'privacy', name: 'Privacy Layer', description: 'Adding zero-knowledge protection', time: '~3 min' },
  { id: 'delivery', name: 'Delivery', description: 'Completing USDC settlement', time: '~2 min' },
];

function ProgressUSDC() {
  const navigate = useNavigate();

  const {
    currentTransaction,
    currentPhase,
    progress: txProgress,
    statusMessage,
    error: txError,
    simulateProgress,
  } = useUsdcTransactionStore();

  const { isDemo } = useAppStore();

  // Track if demo simulation has been started
  const simulationStartedRef = useRef(false);

  // Get current stage from phase
  const currentStage = currentTransaction ? phaseToStage[currentPhase] : null;

  // Redirect if no transaction
  useEffect(() => {
    if (!currentTransaction) {
      navigate('/');
    }
  }, [currentTransaction, navigate]);

  // Start progress tracking (demo simulation or real orchestrator)
  useEffect(() => {
    if (currentTransaction && !simulationStartedRef.current) {
      simulationStartedRef.current = true;
      if (isDemo) {
        // Demo mode: use store simulation
        simulateProgress();
      } else {
        // Real mode: orchestrator is already running from ReviewUSDC
        // Store will update via orchestrator events - UI reacts to store state changes
        console.log('[ProgressUSDC] Real mode - orchestrator already active, tracking progress via store');
      }
    }
  }, [isDemo, currentTransaction, simulateProgress]);

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

  // Calculate progress percentage
  const getProgress = (): number => {
    if (txProgress !== undefined) {
      return txProgress;
    }

    const phaseProgress: Record<string, number> = {
      IDLE: 0,
      INITIATE: 5,
      APPROVAL: 10,
      BRIDGE_TO_EVM: 25,
      DEPOSIT: 40,
      WAIT: 55,
      PROVE: 70,
      WITHDRAW: 85,
      BRIDGE_TO_XRPL: 95,
      COMPLETE: 100,
      FAILED: 0,
    };
    return phaseProgress[currentPhase] || 0;
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

  // Get current status message
  const getStatusMessage = (): string => {
    if (statusMessage) {
      return statusMessage;
    }

    const messages: Record<string, string> = {
      IDLE: 'Initializing...',
      INITIATE: 'Preparing USDC transaction...',
      APPROVAL: 'Approving ERC-20 token...',
      BRIDGE_TO_EVM: 'Bridging USDC to EVM...',
      DEPOSIT: 'Depositing to privacy pool...',
      WAIT: 'Waiting for privacy...',
      PROVE: 'Generating ZK proof...',
      WITHDRAW: 'Withdrawing from privacy pool...',
      BRIDGE_TO_XRPL: 'Bridging USDC to XRPL...',
      COMPLETE: 'Complete!',
      FAILED: 'Transaction failed',
    };
    return messages[currentPhase] || 'Processing...';
  };

  // Get stage index for display
  const stageIndex = currentStage ? stages.findIndex(s => s.id === currentStage) + 1 : 1;

  // Get transaction hash for display
  const getTxHashForPhase = (): string | undefined => {
    if (!currentTransaction?.txHashes) return undefined;

    switch (currentPhase) {
      case 'APPROVAL':
        return currentTransaction.txHashes.approval;
      case 'BRIDGE_TO_EVM':
        return currentTransaction.txHashes.xrplBridge;
      case 'DEPOSIT':
        return currentTransaction.txHashes.deposit;
      case 'WITHDRAW':
        return currentTransaction.txHashes.withdraw;
      case 'BRIDGE_TO_XRPL':
        return currentTransaction.txHashes.evmBridge;
      default:
        return (
          currentTransaction.txHashes.evmBridge ||
          currentTransaction.txHashes.withdraw ||
          currentTransaction.txHashes.deposit ||
          currentTransaction.txHashes.approval ||
          currentTransaction.txHashes.xrplBridge
        );
    }
  };

  const txHash = getTxHashForPhase();

  if (!currentTransaction) return null;

  return (
    <div className="flex-1 flex items-start justify-center px-4 py-8">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-12">
          <h2 className="font-display text-2xl font-medium mb-2">USDC Payment in Progress</h2>
          <p className="text-base text-platinum-dim">
            {isDemo ? 'Demo: ~12 seconds' : 'Estimated time: 6-10 minutes'}
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
            <div className={`font-display text-base font-medium ${txError ? 'text-red-400' : 'text-platinum'}`}>
              {getStatusMessage()}
            </div>
            <div className="text-xs text-platinum-dim mt-1">
              {progress}% complete
            </div>
          </div>
        </div>

        {/* Transaction Hash Display */}
        {txHash && (
          <div className="text-center mb-8">
            <div className="text-xs text-platinum-dim mb-1">
              {currentPhase === 'APPROVAL' ? 'Approval TX' :
               currentPhase === 'DEPOSIT' ? 'Deposit TX' :
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

        {/* Amount Display */}
        <div className="text-center mb-8 py-4 bg-slate/20 rounded-lg">
          <div className="text-2xl font-display font-medium text-gold">
            {parseFloat(currentTransaction.amount).toFixed(2)} {USDC_SYMBOL}
          </div>
          <div className="text-sm text-platinum-dim mt-1">
            to {currentTransaction.recipient.slice(0, 8)}...{currentTransaction.recipient.slice(-6)}
          </div>
        </div>

        {/* Error Display */}
        {txError && (
          <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-4 mb-8 text-center">
            <div className="text-red-400 text-sm font-medium mb-1">
              Transaction Error
            </div>
            <div className="text-red-300 text-xs">{txError}</div>
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

        {/* Technical Details (Expandable) */}
        {currentTransaction && (
          <details className="mt-8 text-xs text-platinum-dim">
            <summary className="cursor-pointer hover:text-platinum">
              Technical Details
            </summary>
            <div className="mt-2 p-3 bg-slate/20 rounded-md font-mono">
              <div>ID: {currentTransaction.id}</div>
              <div>Phase: {currentPhase}</div>
              <div>Asset: {USDC_SYMBOL}</div>
              {currentTransaction.depositData && (
                <>
                  <div className="mt-2">Deposit:</div>
                  <div className="pl-2">Leaf: #{currentTransaction.depositData.leafIndex}</div>
                  <div className="pl-2 truncate">
                    Commitment: {currentTransaction.depositData.commitment.slice(0, 16)}...
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

export default ProgressUSDC;
