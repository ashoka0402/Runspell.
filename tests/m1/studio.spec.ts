import { test, expect, type Page } from '@playwright/test';
import { invoiceWorkflow } from '../../fixtures/m0/invoice';
import type { StudioDocument } from '../../studio/model';

const storageKey = 'relay.studio.v1';
const legacyKey = 'brisko.workflow.drafts';

async function saved(page: Page): Promise<StudioDocument> {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), storageKey);
}

async function openStudio(page: Page) {
  await page.goto('/app/#/studio');
  await expect(page.getByRole('heading', { name: 'Prompt Studio', exact: true })).toBeVisible();
}

async function buildExample(page: Page) {
  await page.getByRole('button', { name: 'Use invoice example', exact: true }).click();
  await page.getByRole('button', { name: 'Build mock draft', exact: true }).click();
  await expect.poll(async () => (await saved(page)).snapshot.status, { timeout: 10_000 }).toBe('ready');
  await expect(page.locator('.react-flow__node')).toHaveCount(6);
}

async function selectStep(page: Page, label: string) {
  await page.locator('.studio-step-strip').getByRole('button', { name: new RegExp(label) }).click();
  await expect(page.getByRole('textbox', { name: 'Step label', exact: true })).toHaveValue(label);
}

test('mock authoring saves a real draft, validates edits, and never calls action or model providers', async ({ page }) => {
  const externalRequests: string[] = [];
  const browserErrors: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.protocol.startsWith('http') && !['localhost', '127.0.0.1', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) externalRequests.push(request.url());
  });
  page.on('pageerror', error => browserErrors.push(error.message));
  await openStudio(page);
  await expect(page.getByText('Offline prototype', { exact: true })).toBeVisible();
  await expect(page.getByText('Mock planner', { exact: true })).toBeVisible();
  await buildExample(page);
  await expect(page.getByText('No accounts are connected in this prototype.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Activate unavailable', exact: true })).toBeDisabled();

  await selectStep(page, 'Read invoice fields');
  await page.getByRole('textbox', { name: 'Step label', exact: true }).fill('Read vendor invoice');
  await page.getByRole('button', { name: 'Save step changes', exact: true }).click();
  await expect.poll(async () => (await saved(page)).snapshot.workflow.nodes.find(node => node.id === 'read_invoice')?.label).toBe('Read vendor invoice');
  const accepted = await saved(page);
  await page.getByRole('textbox', { name: 'Configuration JSON', exact: true }).fill('{"unsupportedField":true}');
  await page.getByRole('button', { name: 'Save step changes', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect((await saved(page)).snapshot.workflow).toEqual(accepted.snapshot.workflow);
  await page.reload();
  await expect(page.locator('.studio-step-strip').getByRole('button', { name: /Read vendor invoice/ })).toBeVisible();
  await page.getByRole('button', { name: 'Build mock draft', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Replace current draft confirmation', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Keep current draft', exact: true }).click();
  expect((await saved(page)).snapshot.workflow).toEqual(accepted.snapshot.workflow);
  await page.getByRole('button', { name: 'View sample result', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Illustrative result/ })).toBeVisible();
  expect(externalRequests).toEqual([]);
  expect(browserErrors).toEqual([]);
});

test('reviewed suggestions can be rejected or accepted and stale proposals cannot overwrite manual edits', async ({ page }) => {
  await openStudio(page);
  await buildExample(page);
  const initial = await saved(page);
  await page.getByRole('textbox', { name: 'Ask for a mock suggestion', exact: true }).fill('Change threshold to 25000');
  await page.getByRole('button', { name: 'Suggest edit', exact: true }).click();
  await expect(page.getByText('Threshold: 25000', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reject change', exact: true }).click();
  expect((await saved(page)).snapshot.revision).toBe(initial.snapshot.revision);

  await page.getByRole('button', { name: 'Suggest edit', exact: true }).click();
  await selectStep(page, 'Read invoice fields');
  await page.getByRole('textbox', { name: 'Step label', exact: true }).fill('Keep this manual edit');
  await page.getByRole('button', { name: 'Save step changes', exact: true }).click();
  await page.getByRole('button', { name: 'Accept change', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/draft changed/i);
  expect((await saved(page)).snapshot.workflow.nodes.find(node => node.id === 'check_amount')?.config.threshold).toBe(50000);

  await page.getByRole('button', { name: 'Suggest edit', exact: true }).click();
  await page.getByRole('button', { name: 'Accept change', exact: true }).click();
  await expect.poll(async () => (await saved(page)).snapshot.workflow.nodes.find(node => node.id === 'check_amount')?.config.threshold).toBe(25000);
  expect((await saved(page)).snapshot.workflow.nodes.find(node => node.id === 'read_invoice')?.label).toBe('Keep this manual edit');
});

test('cancelled and interrupted builds preserve accepted edits across refresh, resume, and navigation', async ({ page }) => {
  await openStudio(page);
  await page.getByRole('button', { name: 'Build mock draft', exact: true }).click();
  await expect.poll(async () => (await saved(page)).snapshot.workflow.nodes.length).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Cancel build', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume build', exact: true })).toBeVisible();
  await selectStep(page, 'Open invoice portal');
  await page.getByRole('textbox', { name: 'Step label', exact: true }).fill('Preserved portal step');
  await page.getByRole('button', { name: 'Save step changes', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Resume build', exact: true })).toBeVisible();
  await expect(page.locator('.studio-step-strip').getByRole('button', { name: /Preserved portal step/ })).toBeVisible();
  await page.getByRole('button', { name: 'Resume build', exact: true }).click();
  await expect.poll(async () => (await saved(page)).snapshot.status, { timeout: 10_000 }).toBe('ready');
  await expect(page.locator('.react-flow__node')).toHaveCount(6);
  expect((await saved(page)).snapshot.workflow.nodes[0]?.label).toBe('Preserved portal step');

  await page.getByRole('link', { name: 'Overview', exact: true }).click();
  await expect(page.locator('#studio-host')).toHaveCount(0);
  await page.goBack();
  await expect(page.locator('.react-flow__node')).toHaveCount(6);
  await page.getByRole('button', { name: 'Build mock draft', exact: true }).click();
  await page.getByRole('button', { name: 'Replace and build mock', exact: true }).click();
  await expect.poll(async () => (await saved(page)).snapshot.workflow.nodes.length).toBeGreaterThan(0);
  await page.reload();
  await expect(page.getByText(/previous build was interrupted/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel build', exact: true })).toHaveCount(0);
  const paused = await saved(page);
  await page.getByRole('button', { name: 'Reconnect draft', exact: true }).click();
  await expect.poll(async () => (await saved(page)).snapshot.status, { timeout: 10_000 }).toBe('ready');
  expect((await saved(page)).snapshot.workflow.nodes.length).toBe(6);
  expect(paused.snapshot.workflow.nodes.length).toBeLessThan(6);
});

test('legacy and canonical imports are explicit and preserve legacy source data', async ({ page }) => {
  const legacy = JSON.stringify({ blank: { name: 'My blank draft', steps: [] }, unsupported: { name: 'Old module draft', steps: [{ app: 'Storefront' }] } });
  await page.addInitScript(({ key, value }) => { if (localStorage.getItem(key) === null) localStorage.setItem(key, value); }, { key: legacyKey, value: legacy });
  await openStudio(page);
  await page.getByText('Import an existing draft', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Existing browser draft', exact: true }).selectOption('unsupported');
  await page.getByRole('button', { name: 'Import selected local draft', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/cannot be mapped safely/i);
  await page.getByRole('combobox', { name: 'Existing browser draft', exact: true }).selectOption('blank');
  await page.getByRole('button', { name: 'Import selected local draft', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My blank draft', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Canonical workflow JSON', exact: true }).fill(JSON.stringify(invoiceWorkflow));
  await page.getByRole('button', { name: 'Import workflow JSON', exact: true }).click();
  await expect(page.locator('.react-flow__node')).toHaveCount(6);
  expect(await page.evaluate(key => localStorage.getItem(key), legacyKey)).toBe(legacy);
});

test('malformed storage, failed saves and stale-tab writes never silently overwrite accepted data', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(key => localStorage.setItem(key, '{broken'), storageKey);
  await openStudio(page);
  await expect(page.getByRole('alert')).toContainText(/invalid or incompatible/i);
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBe('{broken');
  await page.evaluate(key => localStorage.removeItem(key), storageKey);
  await page.reload();
  await buildExample(page);
  const accepted = await saved(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'relay.studio.v1') throw new DOMException('Test quota failure', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await page.getByRole('button', { name: 'Build mock draft', exact: true }).click();
  await page.getByRole('button', { name: 'Replace and build mock', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/could not be saved/i);
  expect(await saved(page)).toEqual(accepted);
  await page.reload();
  await page.evaluate(key => {
    const next = JSON.parse(localStorage.getItem(key)!);
    next.storageRevision++;
    localStorage.setItem(key, JSON.stringify(next));
  }, storageKey);
  await page.getByRole('button', { name: 'Build mock draft', exact: true }).click();
  await page.getByRole('button', { name: 'Replace and build mock', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/changed this draft/i);
  await page.getByRole('button', { name: 'Reload saved draft', exact: true }).click();
  await expect(page.getByText(/Loaded the saved draft/)).toBeVisible();
});

test('mobile reduced-motion authoring is bounded and keyboard input stays inside Studio', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openStudio(page);
  await buildExample(page);
  const prompt = page.getByRole('textbox', { name: 'What should this workflow do?', exact: true });
  await prompt.focus();
  await prompt.press('Control+k');
  await expect(page.locator('.modal')).toHaveCount(0);
  await expect(prompt).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await selectStep(page, 'Read invoice fields');
  await page.getByRole('textbox', { name: 'Step label', exact: true }).fill('Keyboard-edited step');
  await page.getByRole('textbox', { name: 'Step label', exact: true }).press('Enter');
  await expect.poll(async () => (await saved(page)).snapshot.workflow.nodes.find(node => node.id === 'read_invoice')?.label).toBe('Keyboard-edited step');
});
