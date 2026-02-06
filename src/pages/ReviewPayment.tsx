import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTransactionStore } from '@stores/transactionStore';
import { useOrchestratorStore } from '@stores/orchestratorStore';
import { useAppStore } from '@stores/appStore';
import { useWalletStore } from '@stores/walletStore';
import {
  LockIcon,
  ChevronRightIcon,
  ArrowLeftIcon,
  SpinnerIcon,
} from '@components/common/Icons';

// Transaction flow steps for explanation
const transactionSteps = [
  {
    number: 1,
    title: 'Bridge to EVM',
    description: 'Your XRP is transferred to the XRPL EVM sidechain via Axelar bridge',
    time: '~2 min',
  },
  {
    number: 2,
    title: 'Enter Privacy Pool',
    description: 'Funds are deposited into the zero-knowledge privacy pool',
    time: '~1 min',
  },
  {
    number: 3,
    title: 'Generate ZK Proof',
    description: 'A cryptographic proof is generated to verify ownership without revealing the source',
    time: '~30 sec',
  },
  {
    number: 4,
    title: 'Exit Privacy Pool',
    description: 'Funds are withdrawn using the ZK proof, breaking the on-chain link',
    time: '~1 min',
  },
  {
    number: 5,
    title: 'Bridge to XRPL',
    description: 'XRP is delivered to the recipient on XRPL mainnet',
    time: '~2 min',
  },
];

function ReviewPayment() {
  const navigate = useNavigate();
  const { currentTransaction, clearTransaction } = useTransactionStore();
  const { startTransaction } = useOrchestratorStore();
  const { isDemo } = useAppStore();
  const { address } = useWalletStore();

  // Redirect if no transaction data
  useEffect(() => {
    if (!currentTransaction) {
      navigate('/send');
    }
  }, [currentTransaction, navigate]);

  if (!currentTransaction) {
    return null;
  }

  const { amount, recipient, fees } = currentTransaction;
  const totalCost = parseFloat(amount) + fees.total;

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setError(null);
    setIsLoading(true);

    if (isDemo) {
      // Demo mode: navigate directly to progress (simulation starts there)
      navigate('/progress');
    } else {
      // Real mode: start the orchestrator
      // Navigate to progress page first, let it handle the orchestrator
      // The Progress page will show status while orchestrator initializes
      try {
        // Start the transaction (don't await - let it run in background)
        // The orchestratorStore will update state as it progresses
        startTransaction({
          amount,
          recipient,
          senderXRPL: address || '',
        }).catch((err) => {
          console.error('Transaction failed:', err);
          // Error will be shown on Progress page via orchestratorStore.error
        });

        // Navigate immediately so user sees progress
        navigate('/progress');
      } catch (err) {
        console.error('Failed to start transaction:', err);
        setError(err instanceof Error ? err.message : 'Failed to start transaction. Please try again.');
        setIsLoading(false);
      }
    }
  };

  const handleBack = () => {
    clearTransaction();
    navigate('/send');
  };

  return (
    <div className="flex-1 flex items-start justify-center px-4 py-8">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <button
            type="button"
            onClick={handleBack}
            className="p-2 rounded-full hover:bg-slate/50 transition-colors"
          >
            <ArrowLeftIcon className="w-5 h-5 text-platinum-dim" />
          </button>
          <div>
            <h2 className="font-display text-xl font-medium">Review Payment</h2>
            <p className="text-sm text-platinum-dim">Confirm the details before proceeding</p>
          </div>
        </div>

        {/* Payment Summary Card */}
        <div className="card card-accent mb-6">
          <div className="flex justify-between items-center mb-6">
            <span className="text-sm text-platinum-dim">Private Payment</span>
            <div className="badge badge-teal">
              <LockIcon className="w-3 h-3" />
              Protected
            </div>
          </div>

          {/* Amount Display */}
          <div className="text-center mb-6 py-4 border-y border-slate">
            <div className="text-3xl font-display font-medium text-gold mb-1">
              {parseFloat(amount).toFixed(2)} XRP
            </div>
            <div className="text-sm text-platinum-dim">
              to {recipient.slice(0, 8)}...{recipient.slice(-6)}
            </div>
          </div>

          {/* Fee Breakdown - Always Visible */}
          <div className="space-y-2 mb-6">
            <div className="text-xs font-medium text-platinum-dim uppercase tracking-wider mb-3">
              Fee Breakdown
            </div>

            <div className="flex justify-between text-sm text-platinum-dim py-1.5">
              <span>Bridge fee (XRPL → EVM)</span>
              <span>~{(fees.bridge / 2).toFixed(4)} XRP</span>
            </div>
            <div className="flex justify-between text-sm text-platinum-dim py-1.5">
              <span>Privacy pool fee (0.5%)</span>
              <span>{fees.privacy.toFixed(4)} XRP</span>
            </div>
            <div className="flex justify-between text-sm text-platinum-dim py-1.5">
              <span>EVM gas (deposit + withdraw)</span>
              <span>~{fees.evmGas.toFixed(4)} XRP</span>
            </div>
            <div className="flex justify-between text-sm text-platinum-dim py-1.5">
              <span>Bridge fee (EVM → XRPL)</span>
              <span>~{(fees.bridge / 2).toFixed(4)} XRP</span>
            </div>
            <div className="flex justify-between text-sm text-platinum-dim py-1.5">
              <span>XRPL network fee</span>
              <span>~{fees.network.toFixed(6)} XRP</span>
            </div>

            <div className="flex justify-between text-sm font-medium text-platinum py-2 mt-2 border-t border-slate">
              <span>Total Fees</span>
              <span>~{fees.total.toFixed(4)} XRP</span>
            </div>
          </div>

          {/* Summary */}
          <div className="bg-obsidian rounded-lg p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-platinum-dim">You pay</span>
              <span className="text-platinum font-medium">{totalCost.toFixed(4)} XRP</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-platinum-dim">Recipient receives</span>
              <span className="text-gold font-medium">{parseFloat(amount).toFixed(4)} XRP</span>
            </div>
          </div>
        </div>

        {/* Transaction Steps */}
        <div className="card mb-6">
          <div className="text-xs font-medium text-platinum-dim uppercase tracking-wider mb-4">
            How it works
          </div>

          <div className="space-y-0">
            {transactionSteps.map((step, index) => (
              <div key={step.number} className="flex gap-3">
                {/* Step indicator */}
                <div className="flex flex-col items-center">
                  <div className="w-6 h-6 rounded-full bg-slate flex items-center justify-center text-xs font-medium text-platinum">
                    {step.number}
                  </div>
                  {index < transactionSteps.length - 1 && (
                    <div className="w-px h-full min-h-[40px] bg-slate/50" />
                  )}
                </div>

                {/* Step content */}
                <div className="flex-1 pb-4">
                  <div className="flex justify-between items-start">
                    <div className="font-medium text-sm text-platinum">{step.title}</div>
                    <div className="text-xs text-platinum-dim">{step.time}</div>
                  </div>
                  <div className="text-xs text-platinum-dim mt-0.5">{step.description}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="text-xs text-platinum-dim mt-2 pt-3 border-t border-slate">
            Estimated total time: <span className="text-platinum">5-10 minutes</span>
            {isDemo && <span className="text-teal-bright ml-2">(Demo: ~10 seconds)</span>}
          </div>
        </div>

        {/* Privacy Notice */}
        <div className="bg-teal/10 border border-teal/30 rounded-lg p-4 mb-6">
          <div className="flex gap-3">
            <LockIcon className="w-5 h-5 text-teal-bright flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-medium text-platinum mb-1">Privacy Guarantee</div>
              <div className="text-xs text-platinum-dim">
                Once complete, there will be no on-chain link between your wallet and the recipient.
                The zero-knowledge proof ensures complete transaction privacy.
              </div>
            </div>
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-4 mb-6">
            <div className="text-red-400 text-sm">{error}</div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleBack}
            className="btn btn-secondary flex-1"
            disabled={isLoading}
          >
            Back
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isLoading}
            className="btn btn-primary flex-1 font-display flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <SpinnerIcon className="w-4 h-4 animate-spin" />
                Starting...
              </>
            ) : (
              <>
                Confirm Payment
                <ChevronRightIcon className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ReviewPayment;
