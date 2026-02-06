import { useAppStore } from '@stores/appStore';
import { useWalletStore } from '@stores/walletStore';
import { useNavigate } from 'react-router-dom';

function DemoBanner() {
  const { exitDemo } = useAppStore();
  const { disconnect } = useWalletStore();
  const navigate = useNavigate();

  const handleExit = () => {
    exitDemo();
    disconnect();
    navigate('/');
  };

  return (
    <div className="fixed top-0 left-0 right-0 z-[200] py-3 px-4 bg-gold text-obsidian">
      <div className="flex justify-center items-center gap-4">
        <span className="text-sm font-medium">
          Demo Mode — Simulated transaction flow
        </span>
        <button
          onClick={handleExit}
          className="px-3 py-1 bg-obsidian text-platinum rounded text-xs font-medium hover:bg-charcoal transition-colors"
        >
          Exit Demo
        </button>
      </div>
    </div>
  );
}

export default DemoBanner;
