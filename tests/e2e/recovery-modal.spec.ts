/**
 * Recovery Modal E2E Tests
 *
 * Tests for the transaction recovery modal functionality.
 * These tests simulate a pending transaction scenario.
 */

import { test, expect } from '@playwright/test';

test.describe('Recovery Modal', () => {
  test.beforeEach(async ({ page }) => {
    // Set up a pending transaction in localStorage before visiting the page
    await page.goto('/');

    // Inject a mock pending transaction into localStorage
    await page.evaluate(() => {
      const mockTransaction = {
        id: 'VEIL-TEST-12345',
        currentPhase: 'DEPOSIT',
        phaseStatus: 'pending',
        params: {
          amount: '10.50',
          recipient: 'rDemoRecipientAddress123456789',
          senderXRPL: 'rDemoSenderAddress123456789',
        },
        phaseResults: {},
        txHashes: {},
        startedAt: Date.now() - 5 * 60 * 1000,
        retryCount: 0,
        maxRetries: 3,
        lastUpdatedAt: Date.now() - 2 * 60 * 1000,
      };

      localStorage.setItem(
        'veil_active_transaction',
        JSON.stringify(mockTransaction)
      );
    });
  });

  test.afterEach(async ({ page }) => {
    // Clean up localStorage
    await page.evaluate(() => {
      localStorage.removeItem('veil_active_transaction');
    });
  });

  test('displays recovery modal when pending transaction exists', async ({ page }) => {
    // Reload to trigger recovery check
    await page.reload();

    // Wait for modal to appear
    await expect(
      page.getByText('Pending Transaction Found')
    ).toBeVisible({ timeout: 5000 });
  });

  test('shows transaction amount', async ({ page }) => {
    await page.reload();
    await expect(page.getByText('10.50 XRP')).toBeVisible({ timeout: 5000 });
  });

  test('shows truncated recipient address', async ({ page }) => {
    await page.reload();
    await expect(
      page.getByText(/rDemo.*56789/)
    ).toBeVisible({ timeout: 5000 });
  });

  test('shows last phase name', async ({ page }) => {
    await page.reload();
    await expect(page.getByText('Deposit')).toBeVisible({ timeout: 5000 });
  });

  test('shows relative time since start', async ({ page }) => {
    await page.reload();
    await expect(
      page.getByText(/minutes ago/)
    ).toBeVisible({ timeout: 5000 });
  });

  test('shows Resume and Start Fresh buttons', async ({ page }) => {
    await page.reload();

    await expect(
      page.getByRole('button', { name: /resume/i })
    ).toBeVisible({ timeout: 5000 });

    await expect(
      page.getByRole('button', { name: /start fresh/i })
    ).toBeVisible();
  });

  test('clicking Start Fresh clears the modal', async ({ page }) => {
    await page.reload();

    // Wait for modal
    await expect(
      page.getByText('Pending Transaction Found')
    ).toBeVisible({ timeout: 5000 });

    // Click Start Fresh
    await page.getByRole('button', { name: /start fresh/i }).click();

    // Modal should close
    await expect(
      page.getByText('Pending Transaction Found')
    ).not.toBeVisible({ timeout: 3000 });

    // localStorage should be cleared
    const hasTransaction = await page.evaluate(() => {
      return localStorage.getItem('veil_active_transaction') !== null;
    });

    expect(hasTransaction).toBe(false);
  });

  test('clicking Resume triggers resume flow and shows loading state', async ({ page }) => {
    await page.reload();

    // Wait for modal
    await expect(
      page.getByText('Pending Transaction Found')
    ).toBeVisible({ timeout: 5000 });

    // Resume button should be enabled initially
    const resumeButton = page.getByRole('button', { name: /resume/i });
    await expect(resumeButton).toBeEnabled();

    // Click Resume button
    await resumeButton.click();

    // Button should show "Resuming..." state (proves click handler was triggered)
    const resumingText = page.getByText('Resuming...');
    await expect(resumingText).toBeVisible({ timeout: 2000 });

    // The "Resuming..." button should be disabled
    // Note: The button text changes, so we need to find it by the new text
    const resumingButton = page.getByRole('button', { name: /resuming/i });
    await expect(resumingButton).toBeDisabled();

    // Start Fresh button should also be disabled during resume
    await expect(
      page.getByRole('button', { name: /start fresh/i })
    ).toBeDisabled();

    // Note: Full navigation to /progress requires ZK service initialization
    // which loads WASM and can be slow in E2E. The loading state verification
    // above proves the resume flow is correctly triggered.
  });

  test('modal shows informational message', async ({ page }) => {
    await page.reload();

    await expect(
      page.getByText(/can be resumed/)
    ).toBeVisible({ timeout: 5000 });

    await expect(
      page.getByText(/progress has been saved/)
    ).toBeVisible();
  });
});

test.describe('Recovery Modal - No Pending Transaction', () => {
  test('does not show modal when no pending transaction', async ({ page }) => {
    // Clear any existing transactions
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.removeItem('veil_active_transaction');
    });

    await page.reload();

    // Modal should not appear
    await expect(
      page.getByText('Pending Transaction Found')
    ).not.toBeVisible({ timeout: 2000 });
  });
});

test.describe('Recovery Modal - Edge Cases', () => {
  test('handles very old transaction (shows hours)', async ({ page }) => {
    await page.goto('/');

    // Set a transaction from 3 hours ago
    await page.evaluate(() => {
      const mockTransaction = {
        id: 'VEIL-OLD-TX',
        currentPhase: 'BRIDGE_TO_EVM',
        phaseStatus: 'pending',
        params: {
          amount: '5.00',
          recipient: 'rOldRecipient',
          senderXRPL: 'rOldSender',
        },
        phaseResults: {},
        txHashes: {},
        startedAt: Date.now() - 3 * 60 * 60 * 1000, // 3 hours ago
        retryCount: 2,
        maxRetries: 3,
        lastUpdatedAt: Date.now() - 1 * 60 * 60 * 1000, // 1 hour ago
      };

      localStorage.setItem(
        'veil_active_transaction',
        JSON.stringify(mockTransaction)
      );
    });

    await page.reload();

    // Should show hours
    await expect(
      page.getByText(/hours? ago/)
    ).toBeVisible({ timeout: 5000 });
  });

  test('shows retry count if retries attempted', async ({ page }) => {
    await page.goto('/');

    await page.evaluate(() => {
      const mockTransaction = {
        id: 'VEIL-RETRY-TX',
        currentPhase: 'PROVE',
        phaseStatus: 'pending',
        params: {
          amount: '2.00',
          recipient: 'rRetryRecipient',
          senderXRPL: 'rRetrySender',
        },
        phaseResults: {},
        txHashes: {},
        startedAt: Date.now() - 10 * 60 * 1000,
        retryCount: 2,
        maxRetries: 3,
        lastUpdatedAt: Date.now() - 5 * 60 * 1000,
      };

      localStorage.setItem(
        'veil_active_transaction',
        JSON.stringify(mockTransaction)
      );
    });

    await page.reload();

    // Should show retry count
    await expect(page.getByText('2/3')).toBeVisible({ timeout: 5000 });
  });
});
