import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWalletStore } from '@stores/walletStore';
import { useAppStore } from '@stores/appStore';
import { useTransactionStore } from '@stores/transactionStore';
import { LockIcon, ChevronDownIcon } from '@components/common/Icons';
import { gemWalletService } from '@services/gemwallet';
import { calculateFees, calculateFeesAsync, FeeBreakdown } from '@utils/fees';

function SendPrivate() {
  const navigate = useNavigate();
  const { isConnected, balance, refreshBalance } = useWalletStore();
  const { isDemo } = useAppStore();
  const { initTransaction } = useTransactionStore();

  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [showFees, setShowFees] = useState(true);
  const [fees, setFees] = useState<FeeBreakdown | null>(null);
  const [feesLoading, setFeesLoading] = useState(false);
  const [errors, setErrors] = useState<{ amount?: string; recipient?: string }>({});

  // Pre-fill form in demo mode with a valid-looking XRPL address
  useEffect(() => {
    if (isDemo) {
      setAmount('100');
      // Use a valid XRPL address format for demo (this is a well-known burn address)
      setRecipient('rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY');
    }
  }, [isDemo]);

  // Refresh balance on mount when wallet is connected
  useEffect(() => {
    if (isConnected) {
      refreshBalance();
    }
  }, [isConnected, refreshBalance]);

  // Redirect if not connected
  useEffect(() => {
    if (!isConnected && !isDemo) {
      navigate('/');
    }
  }, [isConnected, isDemo, navigate]);

  // Calculate fees when amount changes (async with fallback)
  useEffect(() => {
    const fetchFees = async () => {
      const numAmount = parseFloat(amount) || 0;
      setFeesLoading(true);
      try {
        const calculatedFees = await calculateFeesAsync(numAmount);
        setFees(calculatedFees);
      } catch (error) {
        // Fallback to sync calculation if RPC fails
        console.warn('Failed to fetch async fees, using fallback:', error);
        setFees(calculateFees(numAmount));
      } finally {
        setFeesLoading(false);
      }
    };
    fetchFees();
  }, [amount]);

  // Calculate total cost (payment + all fees)
  const totalCost = fees ? parseFloat(amount || '0') + fees.total : 0;

  // Privacy pool denomination (1 XRP for mainnet MVP)
  const POOL_DENOMINATION = 1;

  // XRPL requires 10 XRP minimum reserve that cannot be spent
  const XRPL_RESERVE = 10;

  // Calculate spendable balance (total - reserve)
  // In demo mode, show a simulated balance for realistic UX
  const DEMO_BALANCE = 1250.00;
  const numBalance = isDemo ? DEMO_BALANCE : parseFloat(balance || '0');
  const spendableBalance = Math.max(0, numBalance - XRPL_RESERVE);
  const displayBalance = isDemo ? DEMO_BALANCE.toFixed(2) : (balance || '0.00');

  const validateForm = (): boolean => {
    const newErrors: typeof errors = {};
    const numAmount = parseFloat(amount) || 0;

    if (!amount || numAmount <= 0) {
      newErrors.amount = 'Please enter a valid amount';
    } else if (!isDemo && numAmount !== POOL_DENOMINATION) {
      // Real mode: privacy pool requires exact denomination
      newErrors.amount = `Amount must be exactly ${POOL_DENOMINATION} XRP (privacy pool denomination)`;
    } else if (isDemo && numAmount < 1) {
      // Demo mode: any amount >= 1 XRP
      newErrors.amount = 'Minimum amount is 1 XRP';
    } else if (!isDemo && fees && numAmount + fees.total > spendableBalance) {
      // Check against spendable balance (accounting for 10 XRP reserve)
      // Skip this check in demo mode - demo doesn't require wallet connection
      const required = numAmount + fees.total;
      if (numBalance < XRPL_RESERVE) {
        newErrors.amount = `Account balance (${numBalance.toFixed(2)} XRP) is below the 10 XRP reserve requirement`;
      } else {
        newErrors.amount = `Insufficient spendable XRP. You have ${spendableBalance.toFixed(2)} XRP available ` +
          `(${numBalance.toFixed(2)} XRP - 10 XRP reserve). Need ${required.toFixed(2)} XRP.`;
      }
    }

    if (!recipient) {
      newErrors.recipient = 'Please enter a recipient address';
    } else if (!gemWalletService.isValidAddress(recipient)) {
      newErrors.recipient = 'Invalid XRPL address format';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;

    // Initialize the transaction in the store (for both demo and real mode)
    // This stores the amount, recipient, and fees for the review page
    initTransaction({
      amount,
      recipient,
      fees: fees!,
    });

    // Navigate to review page where user confirms before execution
    navigate('/review');
  };

  return (
    <div className="flex-1 flex items-start justify-center px-4 py-8">
      <div className="w-full max-w-md">
        <div className="card card-accent">
          {/* Header */}
          <div className="flex justify-between items-center mb-8">
            <h2 className="font-display text-xl font-medium">Private Payment</h2>
            <div className="badge badge-teal">
              <LockIcon className="w-3 h-3" />
              Protected
            </div>
          </div>

          {/* Amount Input */}
          <div className="mb-6">
            <label className="flex justify-between items-baseline mb-2 text-sm text-platinum-dim">
              <span>Amount</span>
              <span className="text-xs">
                Spendable: <span className="text-platinum">{spendableBalance.toFixed(2)}</span> XRP
                <span className="text-platinum-dim ml-1">({displayBalance} - 10 reserve)</span>
              </span>
            </label>
            <div className="relative">
              <input
                type="text"
                inputMode="decimal"
                className={`input pr-14 ${errors.amount ? 'border-danger' : ''}`}
                placeholder="0.00"
                value={amount}
                onChange={(e) => {
                  // Only allow numbers and decimal point
                  const value = e.target.value.replace(/[^0-9.]/g, '');
                  setAmount(value);
                }}
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-platinum-dim">
                XRP
              </span>
            </div>
            {!isDemo && (
              <p className="mt-1 text-xs text-platinum-dim">
                Privacy pool requires exactly {POOL_DENOMINATION} XRP
              </p>
            )}
            {errors.amount && (
              <p className="mt-2 text-xs text-danger-bright">{errors.amount}</p>
            )}
          </div>

          {/* Recipient Input */}
          <div className="mb-6">
            <label className="block mb-2 text-sm text-platinum-dim">
              Recipient Address
            </label>
            <input
              type="text"
              className={`input font-mono text-sm ${errors.recipient ? 'border-danger' : ''}`}
              placeholder="rXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
            />
            {errors.recipient && (
              <p className="mt-2 text-xs text-danger-bright">{errors.recipient}</p>
            )}
          </div>

          {/* Fees Toggle */}
          <button
            type="button"
            className="w-full flex justify-between items-center p-4 bg-obsidian border border-slate rounded-md mb-6 transition-colors hover:border-platinum-dim"
            onClick={() => setShowFees(!showFees)}
          >
            <span className="text-sm text-platinum-dim">Estimated Fees</span>
            <span className="flex items-center gap-2 text-sm text-platinum">
              {feesLoading ? (
                <span className="text-platinum-dim animate-pulse">Calculating...</span>
              ) : (
                <span>~{fees?.total.toFixed(4) || '0.0000'} XRP</span>
              )}
              <ChevronDownIcon
                className={`w-4 h-4 text-platinum-dim transition-transform ${showFees ? 'rotate-180' : ''}`}
              />
            </span>
          </button>

          {/* Fee Details */}
          {showFees && fees && (
            <div className="p-4 bg-obsidian border border-slate border-t-0 rounded-b-md -mt-6 mb-6">
              <div className="flex justify-between text-xs text-platinum-dim py-1">
                <span>Bridge fee (x2)</span>
                <span>~{fees.bridge.toFixed(4)} XRP</span>
              </div>
              <div className="flex justify-between text-xs text-platinum-dim py-1">
                <span>Privacy pool (0.5%)</span>
                <span>{fees.privacy.toFixed(4)} XRP</span>
              </div>
              <div className="flex justify-between text-xs text-platinum-dim py-1">
                <span>EVM gas (deposit + withdraw)</span>
                <span>~{fees.evmGas.toFixed(4)} XRP</span>
              </div>
              <div className="flex justify-between text-xs text-platinum-dim py-1">
                <span>XRPL network fee</span>
                <span>~{fees.network.toFixed(6)} XRP</span>
              </div>
              <div className="flex justify-between text-sm text-platinum py-2 mt-2 border-t border-slate font-medium">
                <span>Total Fees</span>
                <span>~{fees.total.toFixed(4)} XRP</span>
              </div>
              <div className="flex justify-between text-sm text-platinum py-1 border-t border-slate mt-2 pt-2">
                <span>You pay (total)</span>
                <span className="text-platinum-dim">
                  {totalCost.toFixed(4)} XRP
                </span>
              </div>
              <div className="flex justify-between text-sm text-platinum py-1">
                <span>Recipient receives</span>
                <span className="text-gold font-medium">
                  {parseFloat(amount || '0').toFixed(4)} XRP
                </span>
              </div>
            </div>
          )}

          {/* Submit Button */}
          <button
            type="button"
            className="btn btn-primary w-full font-display"
            onClick={handleSubmit}
            disabled={!amount || !recipient}
          >
            Review Payment
          </button>
        </div>
      </div>
    </div>
  );
}

export default SendPrivate;
