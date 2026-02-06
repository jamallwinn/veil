import { Link } from 'react-router-dom';
import { useWalletStore } from '@stores/walletStore';
import { useAppStore } from '@stores/appStore';

function Header() {
  const { isConnected, isConnecting, address, connect, disconnect } = useWalletStore();
  const { isDemo } = useAppStore();

  const handleWalletClick = () => {
    if (isConnected) {
      disconnect();
    } else {
      connect();
    }
  };

  // Format address for display (rABC...xyz)
  const formatAddress = (addr: string) => {
    if (addr.length <= 12) return addr;
    return `${addr.slice(0, 4)}...${addr.slice(-3)}`;
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-50 px-6 md:px-12 py-6">
      {/* Gradient background */}
      <div className="absolute inset-0 bg-gradient-to-b from-obsidian to-transparent pointer-events-none" />

      <div className="relative flex justify-between items-center max-w-7xl mx-auto">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-3 text-platinum no-underline">
          <div className="relative w-8 h-8">
            {/* Outer ring */}
            <div className="absolute inset-0 border-[1.5px] border-platinum rounded-full" />
            {/* Inner ring */}
            <div className="absolute inset-[6px] border-[1.5px] border-gold rounded-full" />
          </div>
          <span className="font-display text-xl font-medium tracking-[0.2em] uppercase">
            Veil
          </span>
        </Link>

        {/* Wallet Button */}
        <button
          onClick={handleWalletClick}
          disabled={isConnecting}
          className={`
            flex items-center gap-2 px-5 py-2.5
            bg-transparent border border-slate rounded-full
            font-body text-sm font-normal
            transition-all duration-300 ease-out-quart
            ${isConnected ? 'border-teal text-platinum' : 'text-platinum-dim hover:border-platinum-dim hover:text-platinum'}
            disabled:opacity-50 disabled:cursor-not-allowed
          `}
        >
          {isConnecting ? (
            <>
              <div className="spinner" />
              <span>Connecting...</span>
            </>
          ) : isConnected ? (
            <>
              {/* Connected indicator */}
              <div className="w-1.5 h-1.5 bg-teal-bright rounded-full shadow-[0_0_8px_theme(colors.teal.bright)]" />
              <span>{isDemo ? 'Demo Wallet' : formatAddress(address!)}</span>
            </>
          ) : (
            <span>Connect Wallet</span>
          )}
        </button>
      </div>
    </header>
  );
}

export default Header;
