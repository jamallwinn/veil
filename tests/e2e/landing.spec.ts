/**
 * Landing Page E2E Tests
 *
 * Tests for the main landing page of the Veil application.
 */

import { test, expect } from '@playwright/test';

test.describe('Landing Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('displays the main heading', async ({ page }) => {
    // Check for the main title
    await expect(page.locator('h1')).toContainText('Send XRP with');
    await expect(page.locator('h1')).toContainText('Complete Privacy');
  });

  test('displays the privacy tagline', async ({ page }) => {
    await expect(
      page.getByText('Privacy-First Payments')
    ).toBeVisible();
  });

  test('displays the description text', async ({ page }) => {
    await expect(
      page.getByText('Your payment. Your privacy. No trace.')
    ).toBeVisible();
  });

  test('shows View Demo button', async ({ page }) => {
    const demoButton = page.getByRole('button', { name: /view demo/i });
    await expect(demoButton).toBeVisible();
  });

  test('shows Start Private Payment button', async ({ page }) => {
    const paymentButton = page.getByRole('button', { name: /start private payment/i });
    await expect(paymentButton).toBeVisible();
  });

  test('displays the three feature cards', async ({ page }) => {
    // Private feature - use heading role to be specific
    await expect(page.getByRole('heading', { name: 'Private' })).toBeVisible();
    await expect(
      page.getByText('Zero-knowledge proofs break the on-chain link')
    ).toBeVisible();

    // Fast feature
    await expect(page.getByRole('heading', { name: 'Fast' })).toBeVisible();
    await expect(
      page.getByText('Complete private transactions in 5-15 minutes')
    ).toBeVisible();

    // Secure feature
    await expect(page.getByRole('heading', { name: 'Secure' })).toBeVisible();
    await expect(
      page.getByText('Audited RAILGUN protocol')
    ).toBeVisible();
  });

  test('header contains Veil logo', async ({ page }) => {
    await expect(page.getByText('Veil')).toBeVisible();
  });

  test('header contains Connect Wallet button', async ({ page }) => {
    await expect(
      page.getByRole('button', { name: /connect wallet/i })
    ).toBeVisible();
  });

  test('footer is visible', async ({ page }) => {
    // Check footer exists (scroll to bottom first if needed)
    const footer = page.locator('footer');
    await expect(footer).toBeVisible();
  });
});

test.describe('Landing Page - Navigation', () => {
  test('clicking View Demo navigates to send page', async ({ page }) => {
    await page.goto('/');

    // Click demo button
    await page.getByRole('button', { name: /view demo/i }).click();

    // Should navigate to /send
    await expect(page).toHaveURL(/\/send/);
  });

  test('clicking logo navigates to home', async ({ page }) => {
    await page.goto('/send');

    // Click on logo/brand
    await page.getByText('Veil').click();

    // Should navigate back to landing
    await expect(page).toHaveURL('/');
  });
});
