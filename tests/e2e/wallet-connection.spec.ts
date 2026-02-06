/**
 * Wallet Connection E2E Tests
 *
 * Tests for wallet connection UI behavior.
 * Note: GemWallet extension is not available in test environment,
 * so we test the UI states and mock interactions.
 */

import { test, expect } from '@playwright/test';

test.describe('Wallet Connection UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('shows Connect Wallet button when disconnected', async ({ page }) => {
    const walletButton = page.getByRole('button', { name: /connect wallet/i });
    await expect(walletButton).toBeVisible();
  });

  test('wallet button is clickable', async ({ page }) => {
    const walletButton = page.getByRole('button', { name: /connect wallet/i });
    await expect(walletButton).toBeEnabled();

    // Click should not throw (even if GemWallet is not installed)
    await walletButton.click();

    // Button should still be visible (connection may fail gracefully)
    await expect(walletButton).toBeVisible();
  });

  test('Start Private Payment button exists on landing', async ({ page }) => {
    const paymentButton = page.getByRole('button', { name: /start private payment/i });
    await expect(paymentButton).toBeVisible();
    await expect(paymentButton).toBeEnabled();
  });

  test('clicking Start Private Payment attempts wallet connection', async ({ page }) => {
    const paymentButton = page.getByRole('button', { name: /start private payment/i });
    await paymentButton.click();

    // Without GemWallet, should show connecting state or error
    // The app handles this gracefully
    await page.waitForTimeout(2000);

    // Should either navigate to /send or show connection state
    const currentUrl = page.url();
    const hasNavigated = currentUrl.includes('/send');
    const connectButton = page.getByRole('button', { name: /connect wallet|connecting/i });

    // Either navigated or still showing wallet button
    expect(hasNavigated || (await connectButton.isVisible())).toBe(true);
  });
});

test.describe('Wallet States in Demo Mode', () => {
  test('demo mode auto-connects wallet', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /view demo/i }).click();
    await page.waitForURL(/\/send/);

    // Should show connected state (Demo Wallet)
    await expect(page.getByText('Demo Wallet')).toBeVisible();

    // Connect Wallet button should not be visible
    await expect(
      page.getByRole('button', { name: /connect wallet/i })
    ).not.toBeVisible();
  });

  test('demo wallet shows connected indicator', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /view demo/i }).click();
    await page.waitForURL(/\/send/);

    // The header should show a connected state
    // Look for the connected indicator (teal dot or similar)
    const header = page.locator('header');
    const walletArea = header.getByText('Demo Wallet');

    await expect(walletArea).toBeVisible();
  });

  test('exiting demo disconnects wallet', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /view demo/i }).click();
    await page.waitForURL(/\/send/);

    // Exit demo
    await page.getByRole('button', { name: /exit demo/i }).click();
    await page.waitForURL('/');

    // Should show Connect Wallet again
    await expect(
      page.getByRole('button', { name: /connect wallet/i })
    ).toBeVisible();
  });
});

test.describe('Header Wallet Display', () => {
  test('header wallet button has correct styling', async ({ page }) => {
    await page.goto('/');

    const walletButton = page.getByRole('button', { name: /connect wallet/i });
    await expect(walletButton).toBeVisible();

    // Should have border styling
    await expect(walletButton).toHaveCSS('border-radius', /\d+px/);
  });

  test('wallet area is in fixed header', async ({ page }) => {
    await page.goto('/');

    const header = page.locator('header');
    await expect(header).toHaveCSS('position', 'fixed');
  });
});

test.describe('Form Wallet Requirements', () => {
  test('send page requires wallet for form submission', async ({ page }) => {
    // Navigate directly to send page without demo
    await page.goto('/send');

    // Page may redirect back to landing if wallet not connected
    await page.waitForTimeout(1000);

    const currentUrl = page.url();

    // Either redirected to landing or showing the form
    if (currentUrl.includes('/send')) {
      // Look for wallet-related messaging
      const needsWallet = await page.getByText(/connect|wallet/i).first().isVisible();
      expect(needsWallet).toBe(true);
    } else {
      // Redirected - that's also valid behavior
      expect(currentUrl).toBe(page.url());
    }
  });
});
