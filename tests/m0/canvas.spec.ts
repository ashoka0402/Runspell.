import { test, expect } from '@playwright/test';

test('isolated canvas survives lifecycle checks without altering workspace drafts or shortcuts', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const savedDrafts = JSON.stringify({ blank: { name: 'Existing local draft', steps: [] } });
  await page.addInitScript(value => localStorage.setItem('brisko.workflow.drafts', value), savedDrafts);
  await page.goto('/app/#/overview');
  const outsideStyles = await page.locator('.workspace').evaluate(element => ({
    font: getComputedStyle(element).fontFamily,
    borderRadius: getComputedStyle(element).borderRadius,
  }));
  const documentStyleCount = await page.locator('head style').count();
  await page.getByRole('link', { name: 'M0 lab', exact: true }).click();
  const host = page.locator('#m0-canvas-host');
  await expect(host).toHaveAttribute('data-mounted', 'true');
  await expect(page.getByRole('heading', { name: 'Invoice workflow fixture', exact: true })).toBeVisible();
  await expect(page.getByText('Offline fixture', { exact: true })).toBeVisible();
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  expect(await page.locator('head style').count()).toBe(documentStyleCount);
  expect(await page.locator('.workspace').evaluate(element => ({
    font: getComputedStyle(element).fontFamily,
    borderRadius: getComputedStyle(element).borderRadius,
  }))).toEqual(outsideStyles);

  const note = page.getByRole('textbox', { name: 'Fixture note (not saved)' });
  await note.fill('Typed inside the shadow root');
  await note.press('Control+k');
  await expect(page.locator('.modal')).toHaveCount(0);
  await expect(note).toHaveValue('Typed inside the shadow root');
  await page.locator('.search-global').click();
  await expect(page.getByRole('heading', { name: 'Search Runspell', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal')).toHaveCount(0);

  for (let index = 0; index < 3; index++) {
    await page.getByRole('button', { name: 'Unmount canvas', exact: true }).click();
    await expect(host).toHaveAttribute('data-mounted', 'false');
    await expect(page.locator('.react-flow')).toHaveCount(0);
    await page.getByRole('button', { name: 'Mount canvas', exact: true }).click();
    await expect(host).toHaveAttribute('data-mounted', 'true');
    await expect(page.locator('.react-flow')).toHaveCount(1);
  }
  await expect(page.getByRole('textbox', { name: 'Fixture note (not saved)' })).toHaveValue('');

  await page.getByRole('link', { name: 'Back to overview', exact: true }).click();
  await expect(page.locator('.overview-hero')).toBeVisible();
  await expect(page.locator('#m0-canvas-host')).toHaveCount(0);
  await page.getByRole('link', { name: 'M0 lab', exact: true }).click();
  await expect(page.locator('.react-flow')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.react-flow')).toHaveCount(1);
  expect(await page.evaluate(() => localStorage.getItem('brisko.workflow.drafts'))).toBe(savedDrafts);
  expect(errors).toEqual([]);
});

test('canvas remains bounded on mobile and supports reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/app/#/m0');
  await expect(page.locator('.react-flow')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const node = page.locator('.react-flow__node').first();
  await node.focus();
  await expect(node).toBeFocused();
  await expect(page.getByRole('list', { name: 'Workflow steps' })).toBeVisible();
});
