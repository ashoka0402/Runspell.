import { expect, test } from '@playwright/test';

const preview = 'http://127.0.0.1:8000';
const api = 'http://127.0.0.1:8002/api/v1';
const frontendApi = 'https://local.clerk.accounts.dev';
const publishableKey = 'pk_test_' + Buffer.from('local.clerk.accounts.dev$').toString('base64');
const workspace = '550e8400-e29b-41d4-a716-446655440000';
const run = '550e8400-e29b-41d4-a716-446655440001';
const nextRun = '550e8400-e29b-41d4-a716-446655440002';
const acceptedAt = '2026-11-26T09:00:00.000Z';

test('local Clerk sign-in loads workspace runs and displays authorized evidence', async ({ page, baseURL }) => {
  const requests: string[] = [];
  await page.route(`${preview}/**`, (route) => route.fetch({
    url: route.request().url().replace(preview, baseURL!),
  }).then((response) => route.fulfill({ response })));
  await page.route(`${frontendApi}/npm/**`, async (route) => {
    requests.push('Clerk SDK');
    const fakeClerk = `
      const listeners = new Set();
      window.Clerk = {
        load: async () => {},
        addListener: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        openSignIn() {
          this.session = { id: 'sess_mock', getToken: async () => 'mock-clerk-token' };
          for (const listener of listeners) listener({session: this.session});
        },
        async signOut() {
          this.session = null;
          for (const listener of listeners) listener({session: null});
        },
      };`;
    await route.fulfill({
      contentType: 'application/javascript',
      headers: { 'Access-Control-Allow-Origin': preview },
      body: route.request().url().includes('/@clerk/ui@')
        ? 'window.__internal_ClerkUICtor = class {};'
        : fakeClerk,
    });
  });
  const cors = {
    'Access-Control-Allow-Origin': preview,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization',
  };
  await page.route(`${api}/**`, async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    const path = route.request().url().slice(api.length);
    requests.push(path);
    if (path === '/auth/config') {
      await route.fulfill({ headers: cors, json: { provider: 'clerk', frontendApi, publishableKey } });
      return;
    }
    expect(route.request().headers().authorization).toBe('Bearer mock-clerk-token');
    expect(route.request().headers().cookie).toBeUndefined();
    let json: unknown;
    if (path === '/me') json = { workspaces: [{ id: workspace, name: 'Example Workspace', role: 'viewer' }] };
    else if (path === `/workspaces/${workspace}/runs`) json = { runs: [{ id: run, status: 'accepted', createdAt: acceptedAt }], nextCursor: run };
    else if (path === `/workspaces/${workspace}/runs?after=${run}`) {
      json = { runs: [{ id: nextRun, status: 'accepted', createdAt: acceptedAt }], nextCursor: null };
    } else {
      expect(path).toBe(`/workspaces/${workspace}/runs/${run}/evidence`);
      json = {
        schemaVersion: 1, runId: run, workflowId: nextRun, workflowVersion: { id: workspace, number: 1, draftRevision: 0 },
        mode: 'mock', status: 'accepted', evidence: 'pending', externalOutcome: 'not_attempted',
        acceptedAt, finishedAt: null, timeline: [{ kind: 'accepted', at: acceptedAt }],
      };
    }
    await route.fulfill({ headers: cors, json });
  });

  await page.goto(`${preview}/app/#/runs/recorder`);
  await expect(page.getByLabel('Open receipt', { exact: true })).toBeVisible();
  expect(requests).toEqual([]);
  const history = page.locator('#clerk-history');
  await history.getByRole('button', { name: 'Sign in with Clerk' }).click();
  await expect(history.getByLabel('Workspace', { exact: true })).toHaveValue(workspace);
  await history.getByRole('button', { name: `View run ${run}`, exact: true }).click();
  await expect(history.getByText('No external action attempted')).toBeVisible();
  await history.getByRole('button', { name: 'Load more runs', exact: true }).click();
  await expect(history.getByRole('button', { name: `View run ${nextRun}`, exact: true })).toBeVisible();
  await history.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(history.getByText('No external action attempted')).toHaveCount(0);
  await expect(history.getByRole('list', { name: 'Workspace runs' })).toBeHidden();
});
