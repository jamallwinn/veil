import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@stores/appStore';
import { useWalletStore } from '@stores/walletStore';
import { LockIcon, ClockIcon, ShieldCheckIcon, PlayIcon } from '@components/common/Icons';

function Landing() {
  const navigate = useNavigate();
  const { startDemo } = useAppStore();
  const { isConnected, isConnecting, connect, simulateConnection, error } = useWalletStore();

  const handleStartDemo = () => {
    // Simulate wallet connection for demo
    simulateConnection(
      'rDemoAddress' + Math.random().toString(36).substr(2, 6),
      '500.00'
    );
    startDemo();
    navigate('/send');
  };

  const handleStartPayment = async () => {
    if (!isConnected) {
      console.log('[Landing] Starting wallet connection...');
      await connect();
      // Check if connection was successful
      const state = useWalletStore.getState();
      if (state.isConnected) {
        console.log('[Landing] Connection successful, navigating...');
        navigate('/send');
      } else {
        console.log('[Landing] Connection failed:', state.error);
        // Error will be displayed via the error state
      }
    } else {
      navigate('/send');
    }
  };

  const handleStartUsdcPayment = async () => {
    if (!isConnected) {
      console.log('[Landing] Starting wallet connection for USDC...');
      await connect();
      const state = useWalletStore.getState();
      if (state.isConnected) {
        console.log('[Landing] Connection successful, navigating to USDC...');
        navigate('/send-usdc');
      } else {
        console.log('[Landing] Connection failed:', state.error);
      }
    } else {
      navigate('/send-usdc');
    }
  };

  return (
    <div className="flex-1 flex flex-col justify-center items-center px-8 py-32 text-center relative">
      {/* Background vault rings */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {/* Radial gradient */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-radial-gradient from-graphite to-transparent opacity-50" />

        {/* Concentric rings */}
        {[300, 500, 700, 900].map((size) => (
          <div
            key={size}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 border border-slate rounded-full opacity-30"
            style={{ width: size, height: size }}
          />
        ))}
      </div>

      {/* Content */}
      <div className="relative z-10 max-w-xl">
        {/* Tag */}
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-graphite border border-slate rounded-full text-xs font-medium tracking-wider uppercase text-platinum-dim mb-8 animate-fade-in-up">
          <div className="w-1.5 h-1.5 bg-gold rounded-full" />
          Privacy-First Payments
        </div>

        {/* Title */}
        <h1
          className="font-display text-4xl md:text-5xl lg:text-6xl font-medium tracking-tight leading-tight mb-6 animate-fade-in-up"
          style={{ animationDelay: '0.1s' }}
        >
          Send with
          <br />
          <span className="text-gold">Complete Privacy</span>
        </h1>

        {/* Description */}
        <p
          className="text-lg font-light leading-relaxed text-platinum-dim mb-12 animate-fade-in-up"
          style={{ animationDelay: '0.2s' }}
        >
          Your payment. Your privacy. No trace. Execute private XRP or USDC transactions
          with cryptographic certainty that no one can link sender to recipient.
        </p>

        {/* Error display */}
        {error && (
          <div className="mb-6 p-4 bg-red-900/30 border border-red-500/50 rounded-lg text-red-300 text-sm animate-fade-in-up">
            {error}
          </div>
        )}

        {/* CTAs */}
        <div
          className="flex flex-col gap-4 items-center animate-fade-in-up"
          style={{ animationDelay: '0.3s' }}
        >
          {/* Primary action buttons */}
          <div className="flex gap-4 justify-center flex-wrap">
            <button
              onClick={handleStartPayment}
              className="btn btn-primary"
              disabled={isConnecting}
            >
              {isConnecting ? 'Connecting...' : 'Send XRP Privately'}
            </button>
            <button
              onClick={handleStartUsdcPayment}
              className="btn btn-primary"
              disabled={isConnecting}
            >
              {isConnecting ? 'Connecting...' : 'Send USDC Privately'}
            </button>
          </div>
          {/* Demo button */}
          <button onClick={handleStartDemo} className="btn btn-secondary">
            <PlayIcon className="w-4 h-4" />
            View Demo
          </button>
        </div>
      </div>

      {/* Features */}
      <div
        className="relative z-10 grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mt-16 px-8 animate-fade-in-up"
        style={{ animationDelay: '0.4s' }}
      >
        <Feature
          icon={<LockIcon className="w-6 h-6" />}
          title="Private"
          description="Zero-knowledge proofs break the on-chain link between sender and recipient"
        />
        <Feature
          icon={<ClockIcon className="w-6 h-6" />}
          title="Fast"
          description="Complete private transactions in 5-15 minutes with XRPL settlement"
        />
        <Feature
          icon={<ShieldCheckIcon className="w-6 h-6" />}
          title="Secure"
          description="Custom ZK privacy pool with Groth16 cryptographic proofs"
        />
      </div>
    </div>
  );
}

interface FeatureProps {
  icon: React.ReactNode;
  title: string;
  description: string;
}

function Feature({ icon, title, description }: FeatureProps) {
  return (
    <div className="text-center p-6">
      <div className="w-12 h-12 mx-auto mb-4 flex items-center justify-center border border-slate rounded-full text-gold">
        {icon}
      </div>
      <h3 className="font-display text-base font-medium mb-2">{title}</h3>
      <p className="text-sm font-light text-platinum-dim leading-relaxed">
        {description}
      </p>
    </div>
  );
}

export default Landing;
