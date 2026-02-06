import { Routes, Route, useNavigate } from 'react-router-dom';
import { useEffect, useState, useCallback } from 'react';
import Header from '@components/common/Header';
import DemoBanner from '@components/common/DemoBanner';
import Footer from '@components/common/Footer';
import { RecoveryModal } from '@components/modals';
import Landing from '@pages/Landing';
import SendPrivate from '@pages/SendPrivate';
import ReviewPayment from '@pages/ReviewPayment';
import Progress from '@pages/Progress';
import Completion from '@pages/Completion';
// USDC Pages
import SendPrivateUSDC from '@pages/SendPrivateUSDC';
import ReviewUSDC from '@pages/ReviewUSDC';
import ProgressUSDC from '@pages/ProgressUSDC';
import { useAppStore } from '@stores/appStore';
import { useWalletStore } from '@stores/walletStore';
import { useOrchestratorStore } from '@stores/orchestratorStore';

function App() {
  const navigate = useNavigate();
  const { isDemo } = useAppStore();
  const { checkConnection } = useWalletStore();
  const {
    hasPendingRecovery,
    canResume,
    checkForRecovery,
    dismissRecovery,
    resumeTransaction,
  } = useOrchestratorStore();

  const [showRecoveryModal, setShowRecoveryModal] = useState(false);

  // Check for existing wallet connection on mount
  useEffect(() => {
    checkConnection();
  }, [checkConnection]);

  // Check for pending transactions on app launch
  useEffect(() => {
    const checkRecovery = async () => {
      await checkForRecovery();
    };
    checkRecovery();
  }, [checkForRecovery]);

  // Show recovery modal when pending transaction is found
  useEffect(() => {
    if (hasPendingRecovery && canResume) {
      setShowRecoveryModal(true);
    }
  }, [hasPendingRecovery, canResume]);

  // Handle resume action
  const handleResume = useCallback(async () => {
    try {
      await resumeTransaction();
      setShowRecoveryModal(false);
      // Navigate to progress page to show the resumed transaction
      navigate('/progress');
    } catch (error) {
      console.error('Failed to resume transaction:', error);
    }
  }, [resumeTransaction, navigate]);

  // Handle abandon action
  const handleAbandon = useCallback(() => {
    dismissRecovery();
    setShowRecoveryModal(false);
  }, [dismissRecovery]);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Demo banner - visible only in demo mode */}
      {isDemo && <DemoBanner />}

      {/* Header with logo and wallet */}
      <Header />

      {/* Main content */}
      <main className="flex-1 pt-20">
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/send" element={<SendPrivate />} />
          <Route path="/review" element={<ReviewPayment />} />
          <Route path="/progress" element={<Progress />} />
          <Route path="/complete" element={<Completion />} />
          {/* USDC Routes */}
          <Route path="/send-usdc" element={<SendPrivateUSDC />} />
          <Route path="/review-usdc" element={<ReviewUSDC />} />
          <Route path="/progress-usdc" element={<ProgressUSDC />} />
        </Routes>
      </main>

      {/* Footer */}
      <Footer />

      {/* Recovery Modal */}
      <RecoveryModal
        isOpen={showRecoveryModal}
        onResume={handleResume}
        onAbandon={handleAbandon}
      />
    </div>
  );
}

export default App;
