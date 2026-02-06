import { useState, useEffect, useCallback } from 'react';
import { useWalletStore } from '@stores/walletStore';
import { useAppStore } from '@stores/appStore';

// USDC Constants
// Decimals: 15, Issuer: rGm7WCVp9gb4jZHWTEtGUr4dd74z2XuWhE
const USDC_SYMBOL = 'USDC';

// Demo balance for testing
const DEMO_USDC_BALANCE = '500.00';

interface USDCBalanceDisplayProps {
  className?: string;
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

/**
 * Component to display USDC balance from GemWallet trustline
 * Queries the USDC trustline balance and formats it correctly
 */
function USDCBalanceDisplay({
  className = '',
  showLabel = true,
  size = 'md'
}: USDCBalanceDisplayProps) {
  const { isConnected, address } = useWalletStore();
  const { isDemo } = useAppStore();

  const [balance, setBalance] = useState<string>('0.00');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Format balance based on USDC decimals
  const formatUsdcBalance = useCallback((rawBalance: string): string => {
    try {
      const num = parseFloat(rawBalance);
      if (isNaN(num)) return '0.00';
      return num.toFixed(2);
    } catch {
      return '0.00';
    }
  }, []);

  // Fetch USDC trustline balance
  const fetchBalance = useCallback(async () => {
    if (isDemo) {
      setBalance(DEMO_USDC_BALANCE);
      return;
    }

    if (!isConnected || !address) {
      setBalance('0.00');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Query trustline balance via GemWallet
      // Note: This requires GemWallet API support for trustline queries
      // For now, we'll use a placeholder that can be replaced with actual implementation
      const trustlineBalance = await queryUsdcTrustline(address);
      setBalance(formatUsdcBalance(trustlineBalance));
    } catch (err) {
      console.error('Failed to fetch USDC balance:', err);
      setError('Failed to load balance');
      setBalance('0.00');
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, address, isDemo, formatUsdcBalance]);

  // Fetch balance on mount and when connection changes
  useEffect(() => {
    fetchBalance();
  }, [fetchBalance]);

  // Size variants
  const sizeClasses = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-base',
  };

  const balanceSizeClasses = {
    sm: 'text-sm font-medium',
    md: 'text-base font-medium',
    lg: 'text-lg font-semibold',
  };

  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      {showLabel && (
        <span className={`text-platinum-dim ${sizeClasses[size]}`}>
          USDC Balance:
        </span>
      )}

      {isLoading ? (
        <span className={`text-platinum-dim ${sizeClasses[size]} animate-pulse`}>
          Loading...
        </span>
      ) : error ? (
        <span className={`text-red-400 ${sizeClasses[size]}`}>
          {error}
        </span>
      ) : (
        <span className={`text-platinum ${balanceSizeClasses[size]}`}>
          {balance} <span className="text-platinum-dim">{USDC_SYMBOL}</span>
        </span>
      )}
    </div>
  );
}

/**
 * Query USDC trustline balance from XRPL
 * This is a placeholder implementation that should be replaced with actual GemWallet API call
 */
async function queryUsdcTrustline(_address: string): Promise<string> {
  // TODO: Implement actual trustline query via GemWallet or xrpl.js
  // For now, return a placeholder balance
  //
  // Implementation notes:
  // 1. Use xrpl.js to query account_lines for the address
  // 2. Filter for lines where account === USDC_ISSUER_XRPL
  // 3. Return the balance from that trustline
  //
  // Example with xrpl.js:
  // const client = new Client('wss://s1.ripple.com');
  // await client.connect();
  // const response = await client.request({
  //   command: 'account_lines',
  //   account: address,
  //   peer: USDC_ISSUER_XRPL,
  // });
  // const usdcLine = response.result.lines[0];
  // return usdcLine?.balance || '0';

  // For now, simulate a delay and return 0
  await new Promise(resolve => setTimeout(resolve, 100));

  // Return 0 as placeholder - real implementation will query XRPL
  return '0';
}

/**
 * Hook to access USDC balance with refresh capability
 */
export function useUsdcBalance() {
  const { isConnected, address } = useWalletStore();
  const { isDemo } = useAppStore();

  const [balance, setBalance] = useState<string>('0.00');
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (isDemo) {
      setBalance(DEMO_USDC_BALANCE);
      return;
    }

    if (!isConnected || !address) {
      setBalance('0.00');
      return;
    }

    setIsLoading(true);
    try {
      const trustlineBalance = await queryUsdcTrustline(address);
      setBalance(parseFloat(trustlineBalance).toFixed(2));
    } catch (err) {
      console.error('Failed to refresh USDC balance:', err);
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, address, isDemo]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { balance, isLoading, refresh };
}

export default USDCBalanceDisplay;
