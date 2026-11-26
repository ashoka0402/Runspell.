import { expect, test, type Page } from '@playwright/test';

const acceptedAt = '2026-11-26T09:00:00.000Z';
const finishedAt = '2026-11-26T09:00:01.000Z';
const receipt = {
  schemaVersion: 1,
  runId: '4e8b282b-ff0e-49c5-9537-87bfd593fa50',
  workflowId: '4d880bd4-1cc3-4328-aba4-63f990ae1b9a',
  workflowVersion: { id: 'c68d4ac2-6380-4552-85a4-827e4dc13e00', number: 7, draftRevision: 3 },
  mode: 'mock',
  status: 'succeeded',
  evidence: 'simulated',
  externalOutcome: 'not_attempted',
  acceptedAt,
  finishedAt,
  timeline: [
    { kind: 'accepted', at: acceptedAt },
    { kind: 'step', nodeId: 'open_portal', actionType: 'browser.navigate', outcome: 'simulated', outputFields: ['url'] },
    { kind: 'step', nodeId: 'approve_invoice', actionType: 'human.approval', outcome: 'skipped', outputFields: [] },
    { kind: 'finished', at: finishedAt, status: 'succeeded' },
  ],
};

async function openReceipt(page: Page, data: string) {
  await page.getByLabel('Open receipt', { exact: true }).setInputFiles({
    name: 'runspell-receipt.json',
    mimeType: 'application/json',
    buffer: Buffer.from(data),
  });
}

test('the Runs tab opens Flight Recorder and shows the pinned version and simulated timeline', async ({ page }) => {
  await page.goto('/app/#/runs');
  await page.getByRole('link', { name: 'Flight Recorder', exact: true }).click();
  await expect(page).toHaveURL(/#\/runs\/recorder$/);
  await expect(page.getByRole('heading', { name: 'Flight Recorder', exact: true })).toBeVisible();
  await openReceipt(page, JSON.stringify(receipt));
  await expect(page.getByText(receipt.runId, { exact: true })).toBeVisible();
  await expect(page.getByText('Version 7 · Draft revision 3', { exact: true })).toBeVisible();
  await expect(page.getByText(/^Simulated$/i).first()).toBeVisible();
  await expect(page.getByText('No external action attempted', { exact: true })).toBeVisible();
  const timeline = page.getByRole('list', { name: 'Run timeline' });
  await expect(timeline.getByText('open_portal', { exact: true })).toBeVisible();
  await expect(timeline.getByText('approve_invoice', { exact: true })).toBeVisible();
  await expect(timeline.getByText(/^Skipped$/i)).toBeVisible();
});

test('pending receipts replace old steps and invalid files clear the receipt with accessible feedback', async ({ page }) => {
  await page.goto('/app/#/runs/recorder');
  await openReceipt(page, JSON.stringify(receipt));
  await expect(page.getByText('open_portal', { exact: true })).toBeVisible();

  await openReceipt(page, JSON.stringify({
    ...receipt, status: 'accepted', evidence: 'pending', finishedAt: null, timeline: receipt.timeline.slice(0, 1),
  }));
  await expect(page.getByText(/^Pending$/i)).toBeVisible();
  await expect(page.getByText('open_portal', { exact: true })).toHaveCount(0);

  const feedback = page.locator('#flight-recorder').getByRole('status');
  await openReceipt(page, '{');
  await expect(feedback).toHaveText('Choose a valid Runspell mock receipt.');
  await expect(page.getByText(receipt.runId, { exact: true })).toHaveCount(0);

  await openReceipt(page, JSON.stringify(receipt));
  await expect(feedback).toHaveText('Receipt opened.');
  const hostile = '<img src=x onerror="window.recorderPayloadExecuted=true">';
  await openReceipt(page, JSON.stringify({ ...receipt, runId: hostile }));
  await expect(feedback).toHaveText('Choose a valid Runspell mock receipt.');
  await expect(page.locator('img[onerror]')).toHaveCount(0);
  await expect(page.getByText(hostile, { exact: true })).toHaveCount(0);
});
