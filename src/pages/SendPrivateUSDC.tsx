import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWalletStore } from '@stores/walletStore';
import { useAppStore } from '@stores/appStore';
import { useUsdcTransactionStore } from '@stores/usdcTransactionStore';
import { LockIcon, ChevronDownIcon } from '@components/common/Icons';
import { gemWalletService } from '@services/gemwallet';

// USDC Constants
// Decimals: 15, Issuer: rGm7WCVp9gb4jZHWTEtGUr4dd74z2XuWhE
const USDC_DENOMINATION = 3; // 3 USDC per transaction
const USDC_SYMBOL = 'USDC';

// USDC Fee structure (different from XRP)
interface USDCFeeBreakdown {
  bridge: number;       // Axelar bridge fee (in USDC)
  bridgeGas: number;    // Axelar ITS gas fee deducted from transfer (in USDC)
  privacy: number;      // Privacy pool fee (0.5%)
  evmGas: number;       // EVM gas costs (paid in native XRP)
  approval: number;     // ERC-20 approval gas (one-time)
  xrpBridgeGas: number; // XRP bridged for EVM gas
  total: number;        // Total USDC fees
  totalXrpGas: number;  // Total XRP needed for gas
}

// Calculate USDC fees
function calculateUsdcFees(amount: number): USDCFeeBreakdown {
  const bridge = 1.0;     // ~1 USDC bridge fee each way (protocol fee)
  const bridgeGas = 0.2;  // Axelar ITS gas fee (deducted from USDC transfer)
  const privacy = amount * 0.005;  // 0.5% privacy pool fee
  const evmGas = 2.0;     // ~2.0 XRP for EVM gas (approval + deposit + withdraw)
  const approval = 0.01;  // ~0.01 XRP for ERC-20 approval gas
  // XRP bridged to EVM for gas:
  // - Approval:  ~0.01 XRP
  // - Deposit:   ~1.56 XRP
  // - Withdraw:  ~0.50 XRP
  // - Buffer:    ~0.33 XRP
  // - Total:     ~2.40 XRP needed, bridge 2.5 XRP
  const xrpBridgeGas = 2.5;
  const total = bridge * 2 + bridgeGas + privacy;  // Total USDC fees
  const totalXrpGas = xrpBridgeGas;  // XRP for EVM gas (bridged via Axelar)

  return {
    bridge: bridge * 2,
    bridgeGas,
    privacy,
    evmGas,
    approval,
    xrpBridgeGas,
    total,
    totalXrpGas,
  };
}

function SendPrivateUSDC() {
  const navigate = useNavigate();
  const { isConnected, balance, refreshBalance, address } = useWalletStore();
  const { isDemo } = useAppStore();
  const { initTransaction } = useUsdcTransactionStore();

  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [showFees, setShowFees] = useState(true);
  const [fees, setFees] = useState<USDCFeeBreakdown | null>(null);
  const [usdcBalance, setUsdcBalance] = useState<string>('0.00');
  const [errors, setErrors] = useState<{ amount?: string; recipient?: string }>({});
  const [recipientHasTrustline, setRecipientHasTrustline] = useState<boolean | null>(null);
  const [checkingTrustline, setCheckingTrustline] = useState(false);

  // Pre-fill form in demo mode
  useEffect(() => {
    if (isDemo) {
      setAmount('3');
      setRecipient('rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY');
      setUsdcBalance('500.00'); // Demo USDC balance
    }
  }, [isDemo]);

  // Refresh XRP balance on mount when wallet is connected
  useEffect(() => {
    if (isConnected) {
      refreshBalance();
    }
  }, [isConnected, refreshBalance]);

  // Fetch USDC balance from wallet trustline
  useEffect(() => {
    const fetchUsdcBalance = async () => {
      if (isConnected && address && !isDemo) {
        try {
          const usdcBal = await gemWalletService.getUSDCBalance(address);
          if (usdcBal !== null) {
            setUsdcBalance(usdcBal);
          }
        } catch (error) {
          console.error('Failed to fetch USDC balance:', error);
        }
      }
    };

    fetchUsdcBalance();
  }, [isConnected, address, isDemo]);

  // Redirect if not connected
  useEffect(() => {
    if (!isConnected && !isDemo) {
      navigate('/');
    }
  }, [isConnected, isDemo, navigate]);

  // Calculate fees when amount changes
  useEffect(() => {
    const numAmount = parseFloat(amount) || 0;
    setFees(calculateUsdcFees(numAmount));
  }, [amount]);

  // Check recipient USDC trustline when address changes
  useEffect(() => {
    const checkTrustline = async () => {
      // Reset state when recipient changes
      setRecipientHasTrustline(null);

      // Skip trustline check in demo mode (demo is for UI demonstration)
      if (isDemo) {
        setRecipientHasTrustline(true);
        return;
      }

      // Only check if recipient is a valid XRPL address
      if (!recipient || !gemWalletService.isValidAddress(recipient)) {
        return;
      }

      setCheckingTrustline(true);
      try {
        const hasTrustline = await gemWalletService.checkUSDCTrustline(recipient);
        setRecipientHasTrustline(hasTrustline);
      } catch (error) {
        console.error('Failed to check USDC trustline:', error);
        setRecipientHasTrustline(false);
      } finally {
        setCheckingTrustline(false);
      }
    };

    // Debounce the trustline check to avoid excessive API calls
    const timeoutId = setTimeout(checkTrustline, 500);
    return () => clearTimeout(timeoutId);
  }, [recipient, isDemo]);

  // Calculate total cost
  const totalUsdcCost = fees ? parseFloat(amount || '0') + fees.total : 0;

  // XRPL requires 10 XRP minimum reserve
  const XRPL_RESERVE = 10;

  // Demo balances
  const DEMO_USDC_BALANCE = 500.00;
  const DEMO_XRP_BALANCE = 100.00;
  const numUsdcBalance = isDemo ? DEMO_USDC_BALANCE : parseFloat(usdcBalance || '0');
  const numXrpBalance = isDemo ? DEMO_XRP_BALANCE : parseFloat(balance || '0');
  const spendableXrp = Math.max(0, numXrpBalance - XRPL_RESERVE);

  const validateForm = (): boolean => {
    const newErrors: typeof errors = {};
    const numAmount = parseFloat(amount) || 0;

    if (!amount || numAmount <= 0) {
      newErrors.amount = 'Please enter a valid amount';
    } else if (!isDemo && numAmount !== USDC_DENOMINATION) {
      // Real mode: privacy pool requires exact denomination
      newErrors.amount = `Amount must be exactly ${USDC_DENOMINATION} ${USDC_SYMBOL} (privacy pool denomination)`;
    } else if (isDemo && numAmount < 10) {
      // Demo mode: minimum 10 USDC
      newErrors.amount = 'Minimum amount is 10 USDC';
    } else if (!isDemo && fees && numAmount + fees.total > numUsdcBalance) {
      newErrors.amount = `Insufficient USDC. You have ${numUsdcBalance.toFixed(2)} USDC available. ` +
        `Need ${totalUsdcCost.toFixed(2)} USDC (including fees).`;
    } else if (!isDemo && fees && fees.totalXrpGas > spendableXrp) {
      newErrors.amount = `Insufficient XRP for gas. You have ${spendableXrp.toFixed(2)} XRP available ` +
        `(${numXrpBalance.toFixed(2)} XRP - 10 XRP reserve). Need ${fees.totalXrpGas.toFixed(2)} XRP for gas.`;
    }

    if (!recipient) {
      newErrors.recipient = 'Please enter a recipient address';
    } else if (!gemWalletService.isValidAddress(recipient)) {
      newErrors.recipient = 'Invalid XRPL address format';
    } else if (!isDemo && recipientHasTrustline === false) {
      // Skip trustline validation in demo mode
      newErrors.recipient = 'Recipient must have a USDC trustline to receive funds';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;

    // Initialize the USDC transaction in the store
    initTransaction({
      amount,
      recipient,
      fees: fees!,
    });

    // Navigate to USDC review page
    navigate('/review-usdc');
  };

  return (
    <div className="flex-1 flex items-start justify-center px-4 py-8">
      <div className="w-full max-w-md">
        <div className="card card-accent">
          {/* Header */}
          <div className="flex justify-between items-center mb-8">
            <h2 className="font-display text-xl font-medium">Private USDC Payment</h2>
            <div className="badge badge-teal">
              <LockIcon className="w-3 h-3" />
              Protected
            </div>
          </div>

          {/* USDC Info Banner */}
          <div className="bg-teal/10 border border-teal/30 rounded-lg p-3 mb-6">
            <div className="text-xs text-platinum-dim">
              <span className="text-teal-bright font-medium">USDC Privacy Pool</span>
              {' '} - Send stablecoin payments with complete privacy using zero-knowledge proofs.
            </div>
          </div>

          {/* Amount Input */}
          <div className="mb-6">
            <label className="flex justify-between items-baseline mb-2 text-sm text-platinum-dim">
              <span>Amount</span>
              <span className="text-xs">
                <span className="text-platinum">{numUsdcBalance.toFixed(2)}</span> USDC
                <span className="text-platinum-dim mx-1">|</span>
                <span className="text-platinum">{numXrpBalance.toFixed(2)}</span> XRP
              </span>
            </label>
            <div className="relative">
              <input
                type="text"
                inputMode="decimal"
                className={`input pr-16 ${errors.amount ? 'border-danger' : ''}`}
                placeholder="0.00"
                value={amount}
                onChange={(e) => {
                  // Only allow numbers and decimal point
                  const value = e.target.value.replace(/[^0-9.]/g, '');
                  setAmount(value);
                }}
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-platinum-dim">
                USDC
              </span>
            </div>
            {!isDemo && (
              <p className="mt-1 text-xs text-platinum-dim">
                Privacy pool requires exactly {USDC_DENOMINATION} USDC per transaction
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
            {/* Trustline check status */}
            {checkingTrustline && (
              <p className="mt-2 text-xs text-platinum-dim">Checking USDC trustline...</p>
            )}
            {!checkingTrustline && recipientHasTrustline === true && recipient && (
              <p className="mt-2 text-xs text-teal-bright">Recipient has USDC trustline</p>
            )}
            {!checkingTrustline && recipientHasTrustline === false && recipient && gemWalletService.isValidAddress(recipient) && (
              <p className="mt-2 text-xs text-danger-bright">
                Recipient does not have a USDC trustline. They must set up a trustline before receiving USDC.
              </p>
            )}
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
              <span>~{fees?.total.toFixed(2) || '0.00'} USDC + {fees?.totalXrpGas.toFixed(2) || '0.00'} XRP</span>
              <ChevronDownIcon
                className={`w-4 h-4 text-platinum-dim transition-transform ${showFees ? 'rotate-180' : ''}`}
              />
            </span>
          </button>

          {/* Fee Details */}
          {showFees && fees && (
            <div className="p-4 bg-obsidian border border-slate border-t-0 rounded-b-md -mt-6 mb-6">
              <div className="text-xs font-medium text-platinum-dim uppercase tracking-wider mb-3">
                USDC Fees
              </div>
              <div className="flex justify-between text-xs text-platinum-dim py-1">
                <span>Bridge fee (x2)</span>
                <span>~{fees.bridge.toFixed(2)} USDC</span>
              </div>
              <div className="flex justify-between text-xs text-platinum-dim py-1">
                <span>Axelar ITS gas (EVM execution)</span>
                <span>{fees.bridgeGas.toFixed(2)} USDC</span>
              </div>
              <div className="flex justify-between text-xs text-platinum-dim py-1">
                <span>Privacy pool (0.5%)</span>
                <span>{fees.privacy.toFixed(2)} USDC</span>
              </div>
              <div className="flex justify-between text-sm text-platinum py-2 mt-2 border-t border-slate font-medium">
                <span>Total USDC Fees</span>
                <span>~{fees.total.toFixed(2)} USDC</span>
              </div>

              <div className="text-xs font-medium text-platinum-dim uppercase tracking-wider mb-3 mt-4">
                XRP Gas (bridged to EVM)
              </div>
              <div className="flex justify-between text-xs text-platinum-dim py-1">
                <span>XRP for EVM gas</span>
                <span>~{fees.xrpBridgeGas.toFixed(2)} XRP</span>
              </div>
              <div className="text-xs text-platinum-dim/70 py-1 italic">
                Bridged via Axelar for EVM transactions
              </div>
              <div className="flex justify-between text-sm text-platinum py-2 mt-2 border-t border-slate font-medium">
                <span>Total XRP Required</span>
                <span>~{fees.totalXrpGas.toFixed(2)} XRP</span>
              </div>

              <div className="mt-4 pt-3 border-t border-slate">
                <div className="flex justify-between text-sm text-platinum py-1">
                  <span>You pay (total)</span>
                  <span className="text-platinum-dim">
                    {totalUsdcCost.toFixed(2)} USDC + {fees.totalXrpGas.toFixed(2)} XRP
                  </span>
                </div>
                <div className="flex justify-between text-sm text-platinum py-1">
                  <span>Recipient receives</span>
                  <span className="text-gold font-medium">
                    {parseFloat(amount || '0').toFixed(2)} USDC
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* XRP Balance Notice */}
          <div className="mb-6 p-3 bg-slate/30 rounded-md">
            <div className="flex justify-between text-xs text-platinum-dim">
              <span>XRP available for gas:</span>
              <span className="text-platinum">{spendableXrp.toFixed(2)} XRP</span>
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="button"
            className="btn btn-primary w-full font-display"
            onClick={handleSubmit}
            disabled={!amount || !recipient || checkingTrustline || recipientHasTrustline === false}
          >
            {checkingTrustline ? 'Checking trustline...' : 'Review Payment'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default SendPrivateUSDC;
