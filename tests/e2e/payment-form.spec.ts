/**
 * Payment Form E2E Tests
 *
 * Tests for form validation, fee display, and form interactions
 * on the SendPrivate page.
 */

import { test, expect } from '@playwright/test';

test.describe('Payment Form - Basic Display', () => {
  test.beforeEach(async ({ page }) => {
    // Start in demo mode to access the form
    await page.goto('/');
    await page.getByRole('button', { name: /view demo/i }).click();
    await page.waitForURL(/\/send/);
  });

  test('displays amount input with label', async ({ page }) => {
    await expect(page.getByText('Amount')).toBeVisible();
    await expect(page.getByPlaceholder('0.00')).toBeVisible();
  });

  test('displays recipient input with label', async ({ page }) => {
    await expect(page.getByText('Recipient Address')).toBeVisible();
    await expect(page.getByPlaceholder(/rXXX/)).toBeVisible();
  });

  test('displays balance indicator', async ({ page }) => {
    await expect(page.getByText('Balance:')).toBeVisible();
    await expect(page.getByText('XRP').first()).toBeVisible();
  });

  test('displays estimated fees section', async ({ page }) => {
    await expect(page.getByText('Estimated Fees')).toBeVisible();
  });

  test('displays Review Payment button', async ({ page }) => {
    await expect(
      page.getByRole('button', { name: /review payment/i })
    ).toBeVisible();
  });

  test('displays Protected badge', async ({ page }) => {
    await expect(page.getByText('Protected')).toBeVisible();
  });

  test('displays Private Payment header', async ({ page }) => {
    await expect(page.getByText('Private Payment')).toBeVisible();
  });
});

test.describe('Payment Form - Demo Mode Pre-fill', () => {
  test('pre-fills amount in demo mode', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /view demo/i }).click();
    await page.waitForURL(/\/send/);

    // Demo mode pre-fills with 100 XRP
    const amountInput = page.getByPlaceholder('0.00');
    await expect(amountInput).toHaveValue('100');
  });

  test('pre-fills recipient in demo mode', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /view demo/i }).click();
    await page.waitForURL(/\/send/);

    // Demo mode pre-fills with a demo address
    const recipientInput = page.getByPlaceholder(/rXXX/);
    await expect(recipientInput).not.toHaveValue('');
  });
});

test.describe('Payment Form - Input Validation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /view demo/i }).click();
    await page.waitForURL(/\/send/);
  });

  test('button disabled when amount is empty', async ({ page }) => {
    // Clear the pre-filled amount
    const amountInput = page.getByPlaceholder('0.00');
    await amountInput.clear();

    // Button should be disabled when amount is empty
    const submitButton = page.getByRole('button', { name: /review payment/i });
    await expect(submitButton).toBeDisabled();
  });

  test('button disabled when recipient is empty', async ({ page }) => {
    // Clear the pre-filled recipient
    const recipientInput = page.getByPlaceholder(/rXXX/);
    await recipientInput.clear();

    // Button should be disabled when recipient is empty
    const submitButton = page.getByRole('button', { name: /review payment/i });
    await expect(submitButton).toBeDisabled();
  });

  test('shows error for invalid recipient address', async ({ page }) => {
    // Clear and enter invalid address
    const recipientInput = page.getByPlaceholder(/rXXX/);
    await recipientInput.clear();
    await recipientInput.fill('invalid-address');

    // Button should be enabled (form is filled)
    const submitButton = page.getByRole('button', { name: /review payment/i });
    await expect(submitButton).toBeEnabled();

    // Click to trigger validation
    await submitButton.click();

    // Should show invalid address error
    await expect(page.getByText(/invalid.*address/i)).toBeVisible();
  });

  test('shows error for amount below minimum', async ({ page }) => {
    // Clear and enter amount below 1 XRP
    const amountInput = page.getByPlaceholder('0.00');
    await amountInput.clear();
    await amountInput.fill('0.5');

    // Button should be enabled (form is filled)
    const submitButton = page.getByRole('button', { name: /review payment/i });
    await expect(submitButton).toBeEnabled();

    // Click to trigger validation
    await submitButton.click();

    // Should show minimum amount error
    await expect(page.getByText(/minimum.*1 XRP/i)).toBeVisible();
  });

  test('accepts only numeric input for amount', async ({ page }) => {
    const amountInput = page.getByPlaceholder('0.00');
    await amountInput.clear();

    // Try to enter non-numeric characters
    await amountInput.fill('abc123.45xyz');

    // Should only contain numbers and decimal
    await expect(amountInput).toHaveValue('123.45');
  });
});

test.describe('Payment Form - Fee Display', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /view demo/i }).click();
    await page.waitForURL(/\/send/);
  });

  test('shows estimated fees toggle', async ({ page }) => {
    await expect(page.getByText('Estimated Fees')).toBeVisible();
    // Should show a fee amount
    await expect(page.getByText(/~[\d.]+\s*XRP/)).toBeVisible();
  });

  test('expands fee breakdown on click', async ({ page }) => {
    // Click on fees toggle
    await page.getByText('Estimated Fees').click();

    // Should show fee breakdown
    await expect(page.getByText('Bridge fee')).toBeVisible();
    await expect(page.getByText('Privacy pool')).toBeVisible();
    await expect(page.getByText('EVM gas')).toBeVisible();
    await expect(page.getByText('XRPL network fee')).toBeVisible();
    await expect(page.getByText('Total Fees')).toBeVisible();
  });

  test('collapses fee breakdown on second click', async ({ page }) => {
    // Open fees
    await page.getByText('Estimated Fees').click();
    await expect(page.getByText('Bridge fee')).toBeVisible();

    // Close fees
    await page.getByText('Estimated Fees').click();

    // Fee details should be hidden
    await expect(page.getByText('Bridge fee')).not.toBeVisible();
  });

  test('updates fees when amount changes', async ({ page }) => {
    // Get initial fee
    const feeText = await page.getByText(/~[\d.]+\s*XRP/).first().textContent();

    // Change amount
    const amountInput = page.getByPlaceholder('0.00');
    await amountInput.clear();
    await amountInput.fill('500');

    // Fee should update (500 XRP has higher fees than 100 XRP)
    // Wait for recalculation
    await page.waitForTimeout(500);

    const newFeeText = await page.getByText(/~[\d.]+\s*XRP/).first().textContent();

    // Fees should be different (larger amount = larger privacy fee)
    expect(newFeeText).not.toBe(feeText);
  });

  test('shows recipient receives amount in fee breakdown', async ({ page }) => {
    await page.getByText('Estimated Fees').click();

    // Should show what recipient receives
    await expect(page.getByText('Recipient receives')).toBeVisible();
  });

  test('shows total you pay in fee breakdown', async ({ page }) => {
    await page.getByText('Estimated Fees').click();

    // Should show total cost
    await expect(page.getByText('You pay (total)')).toBeVisible();
  });
});

test.describe('Payment Form - Submit Flow', () => {
  test('button is disabled when form is empty', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /view demo/i }).click();
    await page.waitForURL(/\/send/);

    // Clear all inputs
    await page.getByPlaceholder('0.00').clear();
    await page.getByPlaceholder(/rXXX/).clear();

    // Button should be disabled
    const submitButton = page.getByRole('button', { name: /review payment/i });
    await expect(submitButton).toBeDisabled();
  });

  test('button is enabled when form is filled', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /view demo/i }).click();
    await page.waitForURL(/\/send/);

    // Form is pre-filled in demo mode
    const submitButton = page.getByRole('button', { name: /review payment/i });
    await expect(submitButton).toBeEnabled();
  });

  test('navigates to progress page on valid submit', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /view demo/i }).click();
    await page.waitForURL(/\/send/);

    // Submit the pre-filled form
    await page.getByRole('button', { name: /review payment/i }).click();

    // Should navigate to progress page
    await expect(page).toHaveURL(/\/progress/);
  });
});

test.describe('Payment Form - Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /view demo/i }).click();
    await page.waitForURL(/\/send/);
  });

  test('amount input is focusable', async ({ page }) => {
    const amountInput = page.getByPlaceholder('0.00');
    await amountInput.focus();
    await expect(amountInput).toBeFocused();
  });

  test('recipient input is focusable', async ({ page }) => {
    const recipientInput = page.getByPlaceholder(/rXXX/);
    await recipientInput.focus();
    await expect(recipientInput).toBeFocused();
  });

  test('can tab through form elements', async ({ page }) => {
    // Start from amount input
    const amountInput = page.getByPlaceholder('0.00');
    await amountInput.focus();
    await expect(amountInput).toBeFocused();

    // Tab to recipient
    await page.keyboard.press('Tab');
    const recipientInput = page.getByPlaceholder(/rXXX/);
    await expect(recipientInput).toBeFocused();
  });

  test('error messages are visible for screen readers', async ({ page }) => {
    // Enter amount below minimum to trigger validation error
    await page.getByPlaceholder('0.00').clear();
    await page.getByPlaceholder('0.00').fill('0.5');

    // Submit to trigger validation
    await page.getByRole('button', { name: /review payment/i }).click();

    // Error message should be in the DOM
    const errorText = page.getByText(/minimum.*1 XRP/i);
    await expect(errorText).toBeVisible();
    await expect(errorText).toHaveClass(/text-danger/);
  });
});
