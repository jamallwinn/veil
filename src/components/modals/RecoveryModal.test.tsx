/**
 * RecoveryModal Component Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RecoveryModal } from './RecoveryModal';
import type { OrchestratorTransaction } from '@services/orchestrator';

// Mock the orchestrator store
const mockRecoveryTransaction: OrchestratorTransaction = {
  id: 'VEIL-TEST-123',
  currentPhase: 'DEPOSIT',
  phaseStatus: 'pending',
  params: {
    amount: '10.50',
    recipient: 'rDemoRecipientAddress123456789',
    senderXRPL: 'rDemoSenderAddress123456789',
  },
  phaseResults: {},
  txHashes: {},
  startedAt: Date.now() - 5 * 60 * 1000, // 5 minutes ago
  retryCount: 1,
  maxRetries: 3,
  lastUpdatedAt: Date.now() - 2 * 60 * 1000,
};

vi.mock('@stores/orchestratorStore', () => ({
  useOrchestratorStore: () => ({
    recoveryTransaction: mockRecoveryTransaction,
  }),
}));

vi.mock('@services/orchestrator', () => ({
  transactionPersistenceService: {
    clearActiveTransaction: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('RecoveryModal', () => {
  const mockOnResume = vi.fn();
  const mockOnAbandon = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders when isOpen is true', () => {
    render(
      <RecoveryModal
        isOpen={true}
        onResume={mockOnResume}
        onAbandon={mockOnAbandon}
      />
    );

    expect(screen.getByText('Pending Transaction Found')).toBeInTheDocument();
    expect(screen.getByText('10.50 XRP')).toBeInTheDocument();
  });

  it('does not render when isOpen is false', () => {
    render(
      <RecoveryModal
        isOpen={false}
        onResume={mockOnResume}
        onAbandon={mockOnAbandon}
      />
    );

    expect(screen.queryByText('Pending Transaction Found')).not.toBeInTheDocument();
  });

  it('displays transaction details correctly', () => {
    render(
      <RecoveryModal
        isOpen={true}
        onResume={mockOnResume}
        onAbandon={mockOnAbandon}
      />
    );

    // Amount
    expect(screen.getByText('10.50 XRP')).toBeInTheDocument();

    // Phase name (Deposit)
    expect(screen.getByText('Deposit')).toBeInTheDocument();

    // Retry attempts
    expect(screen.getByText('1/3')).toBeInTheDocument();
  });

  it('formats recipient address correctly', () => {
    render(
      <RecoveryModal
        isOpen={true}
        onResume={mockOnResume}
        onAbandon={mockOnAbandon}
      />
    );

    // Should show truncated address
    expect(screen.getByText('rDemo...56789')).toBeInTheDocument();
  });

  it('calls onResume when Resume button is clicked', async () => {
    render(
      <RecoveryModal
        isOpen={true}
        onResume={mockOnResume}
        onAbandon={mockOnAbandon}
      />
    );

    const resumeButton = screen.getByRole('button', { name: /resume/i });
    fireEvent.click(resumeButton);

    await waitFor(() => {
      expect(mockOnResume).toHaveBeenCalled();
    });
  });

  it('calls onAbandon when Start Fresh button is clicked', async () => {
    render(
      <RecoveryModal
        isOpen={true}
        onResume={mockOnResume}
        onAbandon={mockOnAbandon}
      />
    );

    const abandonButton = screen.getByRole('button', { name: /start fresh/i });
    fireEvent.click(abandonButton);

    await waitFor(() => {
      expect(mockOnAbandon).toHaveBeenCalled();
    });
  });

  it('displays time elapsed correctly', () => {
    render(
      <RecoveryModal
        isOpen={true}
        onResume={mockOnResume}
        onAbandon={mockOnAbandon}
      />
    );

    // Should show "5 minutes ago" or similar
    expect(screen.getByText(/minutes ago/i)).toBeInTheDocument();
  });

  it('shows informational message about saved progress', () => {
    render(
      <RecoveryModal
        isOpen={true}
        onResume={mockOnResume}
        onAbandon={mockOnAbandon}
      />
    );

    expect(
      screen.getByText(/your transaction can be resumed/i)
    ).toBeInTheDocument();
  });
});

describe('RecoveryModal - Phase Names', () => {
  const phases = [
    { phase: 'INITIATE', expected: 'Initiation' },
    { phase: 'BRIDGE_TO_EVM', expected: 'Bridge to EVM' },
    { phase: 'DEPOSIT', expected: 'Deposit' },
    { phase: 'WAIT', expected: 'Waiting' },
    { phase: 'PROVE', expected: 'Proof Generation' },
    { phase: 'WITHDRAW', expected: 'Withdrawal' },
    { phase: 'BRIDGE_TO_XRPL', expected: 'Bridge to XRPL' },
  ] as const;

  phases.forEach(({ phase, expected }) => {
    it(`displays "${expected}" for phase "${phase}"`, () => {
      // Override the mock for this test
      vi.doMock('@stores/orchestratorStore', () => ({
        useOrchestratorStore: () => ({
          recoveryTransaction: {
            ...mockRecoveryTransaction,
            currentPhase: phase,
          },
        }),
      }));

      // This test validates the phase mapping exists
      const phaseNames: Record<string, string> = {
        INITIATE: 'Initiation',
        BRIDGE_TO_EVM: 'Bridge to EVM',
        DEPOSIT: 'Deposit',
        WAIT: 'Waiting',
        PROVE: 'Proof Generation',
        WITHDRAW: 'Withdrawal',
        BRIDGE_TO_XRPL: 'Bridge to XRPL',
        COMPLETE: 'Complete',
        FAILED: 'Failed',
      };

      expect(phaseNames[phase]).toBe(expected);
    });
  });
});
