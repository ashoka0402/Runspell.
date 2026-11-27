import { expect, test } from '@playwright/test';

test('a scenario folder stays selected and list rows open scenarios', async ({ page }) => {
  await page.goto('/app/#/scenarios/folders');
  await page.getByText('Orders', { exact: true }).click();
  await expect(page).toHaveURL(/#\/scenarios\/all\?folder=Orders$/);
  await expect(page.locator('.scenario-card')).toHaveCount(4);

  await page.reload();
  await expect(page.locator('.scenario-card')).toHaveCount(4);
  await page.getByRole('button', { name: 'List', exact: true }).click();
  const table = page.getByRole('table');
  await expect(table.locator('tbody tr')).toHaveCount(4);
  await table.getByRole('link', { name: 'New order → packing slip', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'New order → packing slip', exact: true })).toBeVisible();
});

test('a template opens a named draft with editable steps', async ({ page }) => {
  await page.goto('/app/#/scenarios/templates');
  const template = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Low stock → reorder', exact: true }) });
  await template.getByRole('button', { name: 'Use template' }).click();
  await expect(page.locator('#workflow-name')).toHaveValue('Low stock → reorder');
  await expect(page.locator('#builder [data-action="workflow-edit"]').first()).toBeVisible();
  await page.getByRole('button', { name: /Back/ }).click();
  await expect(page.getByRole('heading', { name: 'Scenarios', exact: true })).toBeVisible();
});

test('global search links to matching dashboard content', async ({ page }) => {
  await page.goto('/app/#/overview');
  await page.getByRole('button', { name: /Search scenarios/ }).click();
  const search = page.getByRole('dialog');
  await expect(search.getByRole('heading', { name: 'Search Runspell' })).toBeVisible();
  await search.getByRole('searchbox').fill('packing slip');
  await search.getByRole('link', { name: 'New order → packing slip', exact: true }).click();
  await expect(search).toBeHidden();
  await expect(page.getByRole('heading', { name: 'New order → packing slip', exact: true })).toBeVisible();

  await page.getByRole('button', { name: /Search scenarios/ }).click();
  await search.getByRole('searchbox').fill('packing slip');
  await search.getByRole('link', { name: 'New order → packing slip', exact: true }).click();
  await expect(search).toBeHidden();
});

test('run history filters rows by their start source', async ({ page }) => {
  await page.goto('/app/#/runs/history');
  const source = page.getByLabel('Started by');
  const rows = page.getByRole('table').locator('tbody tr');
  await expect(rows.first()).toBeVisible();
  const all = await rows.count();
  await source.selectOption({ label: 'Schedules' });
  await expect(source).toHaveValue(/schedule/i);
  await expect.poll(() => rows.count()).toBeLessThan(all);
  const selected = await rows.allTextContents();
  expect(selected.length).toBeGreaterThan(0);
  expect(selected.every(row => row.includes('Schedule'))).toBe(true);
  await source.selectOption({ label: 'Any start' });
  await expect(rows).toHaveCount(all);
});

test('workspace, notifications, and scenario controls open their own menus', async ({ page }) => {
  await page.goto('/app/#/scenarios');
  await page.getByRole('button', { name: /Tallow & Fern/ }).click();
  await expect(page.getByRole('button', { name: 'Workspace settings' })).toBeVisible();
  await page.getByRole('button', { name: 'Notifications' }).click();
  await expect(page.getByRole('button', { name: 'Workspace settings' })).toBeHidden();
  await page.getByRole('button', { name: 'Mark all read' }).click();
  await expect(page.getByText('All caught up')).toBeVisible();

  await page.getByRole('button', { name: 'More for New order → packing slip' }).click();
  await page.getByRole('button', { name: 'Scenario details' }).click();
  await expect(page.getByRole('heading', { name: 'New order → packing slip', exact: true })).toBeVisible();
});
