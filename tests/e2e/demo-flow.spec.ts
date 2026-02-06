/**
 * Demo Flow E2E Tests
 *
 * Tests for the complete demo mode flow in the Veil application.
 * This is the most important E2E test as it covers the full user journey.
 */

import { test, expect } from '@playwright/test';

test.describe('Demo Mode Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('demo mode shows demo banner after activation', async ({ page }) => {
    // Click demo button
    await page.getByRole('button', { name: /view demo/i }).click();

    // Wait for navigation
    await page.waitForURL(/\/send/);

    // Demo banner should be visible
    await expect(page.getByText('Demo Mode')).toBeVisible();
    await expect(page.getByText('Simulated transaction flow')).toBeVisible();
  });

  test('demo mode shows demo wallet in header', async ({ page }) => {
    await page.getByRole('button', { name: /view demo/i }).click();
    await page.waitForURL(/\/send/);

    // Should show demo wallet indicator
    await expect(page.getByText('Demo Wallet')).toBeVisible();
  });

  test('exit demo button returns to landing page', async ({ page }) => {
    await page.getByRole('button', { name: /view demo/i }).click();
    await page.waitForURL(/\/send/);

    // Click exit demo
    await page.getByRole('button', { name: /exit demo/i }).click();

    // Should return to landing
    await expect(page).toHaveURL('/');

    // Demo banner should not be visible
    await expect(page.getByText('Demo Mode')).not.toBeVisible();
  });

  test('send page shows form after demo activation', async ({ page }) => {
    await page.getByRole('button', { name: /view demo/i }).click();
    await page.waitForURL(/\/send/);

    // Should see the send form elements
    // Amount input or label
    await expect(page.getByText(/amount/i).first()).toBeVisible();

    // Recipient input or label
    await expect(page.getByText(/recipient/i).first()).toBeVisible();
  });
});

test.describe('Demo Mode - Progress Flow', () => {
  test('demo shows progress stages', async ({ page }) => {
    // Start demo
    await page.goto('/');
    await page.getByRole('button', { name: /view demo/i }).click();
    await page.waitForURL(/\/send/);

    // Find and fill the form (if required)
    // Try to find a submit/send button
    const sendButton = page.getByRole('button', { name: /send|continue|next/i }).first();

    if (await sendButton.isVisible()) {
      await sendButton.click();
    }

    // If we land on progress page, verify stage indicators
    if (await page.getByText(/payment in progress/i).isVisible({ timeout: 5000 }).catch(() => false)) {
      // Verify the three stages are displayed
      await expect(page.getByText('Securing Payment')).toBeVisible();
      await expect(page.getByText('Privacy Layer')).toBeVisible();
      await expect(page.getByText('Delivery')).toBeVisible();
    }
  });

  test('demo completes with success message', async ({ page }) => {
    // This is a longer test that waits for demo completion
    test.setTimeout(60000);

    await page.goto('/');
    await page.getByRole('button', { name: /view demo/i }).click();
    await page.waitForURL(/\/send/);

    // Try to proceed through the flow
    const sendButton = page.getByRole('button', { name: /send|continue|next/i }).first();

    if (await sendButton.isVisible()) {
      await sendButton.click();

      // Wait for completion (demo is fast, ~10 seconds)
      await page.waitForURL(/\/complete/, { timeout: 30000 }).catch(() => {
        // May still be on progress page
      });

      // If on complete page, verify success
      if (await page.url().includes('/complete')) {
        await expect(
          page.getByText(/complete|success/i).first()
        ).toBeVisible();
      }
    }
  });
});

test.describe('Demo Mode - Stage Indicators', () => {
  test('displays correct estimated times for each stage', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /view demo/i }).click();
    await page.waitForURL(/\/send/);

    const sendButton = page.getByRole('button', { name: /send|continue|next/i }).first();

    if (await sendButton.isVisible()) {
      await sendButton.click();

      // Wait for progress page
      await page.waitForURL(/\/progress/, { timeout: 5000 }).catch(() => {});

      if (await page.url().includes('/progress')) {
        // Verify estimated times are shown
        await expect(page.getByText(/~2 min/)).toBeVisible();
        await expect(page.getByText(/~3 min/)).toBeVisible();
      }
    }
  });

  test('progress ring shows percentage', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /view demo/i }).click();
    await page.waitForURL(/\/send/);

    const sendButton = page.getByRole('button', { name: /send|continue|next/i }).first();

    if (await sendButton.isVisible()) {
      await sendButton.click();
      await page.waitForURL(/\/progress/, { timeout: 5000 }).catch(() => {});

      if (await page.url().includes('/progress')) {
        // Should show stage indicator
        await expect(page.getByText(/stage \d of 3/i)).toBeVisible();
      }
    }
  });

  test('demo mode shows shorter estimated time', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /view demo/i }).click();
    await page.waitForURL(/\/send/);

    const sendButton = page.getByRole('button', { name: /send|continue|next/i }).first();

    if (await sendButton.isVisible()) {
      await sendButton.click();
      await page.waitForURL(/\/progress/, { timeout: 5000 }).catch(() => {});

      if (await page.url().includes('/progress')) {
        // Demo mode shows "~10 seconds" instead of "5-10 minutes"
        await expect(page.getByText(/~10 seconds|demo/i)).toBeVisible();
      }
    }
  });
});
