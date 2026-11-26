import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Pool } from 'pg';
import { invoicePolicy, invoiceWorkflow } from '../../fixtures/m0/invoice.js';
import type { Workflow } from '../../shared/index.js';
import { buildDraftApi } from '../src/app.js';
import { dispatchNextMockRun } from '../src/mock-worker.js';

type Version = { id: string; versionNumber: number; draftRevision: number; mode: 'mock' };
type Run = {
  id: string;
  workflowId: string;
  workflowVersionId: string;
  status: 'accepted';
  mode: 'mock';
  createdAt: string;
};
type MockReceipt = Omit<Run, 'status'> & {
  status: 'succeeded';
  finishedAt: string;
  result: { evidence: string; steps: { outcome: string }[] };
};

const { id: _fixtureId, workspaceId: _fixtureWorkspaceId, ...definition } = invoiceWorkflow;

test('mock run admission pins revisions and concurrent workers dispatch each accepted run once', async (t) => {
  const port = Number(process.env.RUNSPELL_TEST_PG_PORT);
  assert.ok(Number.isInteger(port) && port > 0 && port <= 65_535, 'Run through the disposable PostgreSQL test runner');
  const connection = { host: '127.0.0.1', port, database: 'postgres', max: 1, connectionTimeoutMillis: 3_000 };
  const admin = new Pool({ ...connection, user: 'runspell_test_admin' });
  const pool = new Pool({ ...connection, user: 'runspell_test_api' });
  const concurrentPool = new Pool({ ...connection, user: 'runspell_test_api' });
  const workerPool = new Pool({ ...connection, user: 'runspell_test_mock_worker', max: 2 });
  const workspaceA = randomUUID();
  const workspaceB = randomUUID();
  const tokens = {
    'Bearer admission-editor': randomUUID(),
    'Bearer admission-viewer': randomUUID(),
    'Bearer admission-outsider': randomUUID(),
  };
  const appOptions: Omit<Parameters<typeof buildDraftApi>[0], 'pool'> = {
    allowedOrigins: invoicePolicy.allowedOrigins,
    authenticate: async (request) => Object.entries(tokens).find(([token]) => token === request.headers.authorization)?.[1] ?? null,
  };
  const app = buildDraftApi({ ...appOptions, pool });
  const concurrentApp = buildDraftApi({ ...appOptions, pool: concurrentPool });
  t.after(async () => {
    try {
      await Promise.all([app.close(), concurrentApp.close()]);
    } finally {
      await Promise.all([pool.end(), concurrentPool.end(), workerPool.end(), admin.end()]);
    }
  });

  await admin.query(
    'INSERT INTO runspell.workspaces (id, name) VALUES ($1, $2), ($3, $4)',
    [workspaceA, 'Admission workspace A', workspaceB, 'Admission workspace B'],
  );
  for (const [token, actorId] of Object.entries(tokens)) {
    await admin.query(
      'INSERT INTO runspell.users (id, identity_issuer, identity_subject) VALUES ($1, $2, $3)',
      [actorId, 'https://identity.example.test', token],
    );
  }
  await admin.query(
    'INSERT INTO runspell.workspace_members (user_id, workspace_id, role) VALUES ($1, $2, $3), ($4, $2, $5), ($6, $7, $8)',
    [tokens['Bearer admission-editor'], workspaceA, 'editor', tokens['Bearer admission-viewer'], 'viewer',
      tokens['Bearer admission-outsider'], workspaceB, 'owner'],
  );

  const workspacePath = (workspaceId: string) => `/api/v1/workspaces/${workspaceId}`;
  const editor = { authorization: 'Bearer admission-editor' };
  const viewer = { authorization: 'Bearer admission-viewer' };
  const outsider = { authorization: 'Bearer admission-outsider' };
  const collection = `${workspacePath(workspaceA)}/workflows`;

  async function createDraft(draft: typeof definition) {
    const response = await app.inject({ method: 'POST', url: collection, headers: editor, payload: { definition: draft } });
    assert.equal(response.statusCode, 201, response.body);
    return response.json<{ id: string }>().id;
  }

  function activate(workflowId: string, expectedRevision: number, headers = editor, instance = app) {
    return instance.inject({
      method: 'POST', url: `${collection}/${workflowId}/activate`, headers,
      payload: { mode: 'mock', expectedRevision },
    });
  }

  function admit(workflowId: string, key: string, instance = app, headers = editor) {
    return instance.inject({
      method: 'POST', url: `${collection}/${workflowId}/runs`,
      headers: { ...headers, 'idempotency-key': key }, payload: { mode: 'mock' },
    });
  }

  const workflowId = await createDraft(definition);
  const inactive = await admit(workflowId, 'before-activation');
  assert.equal(inactive.statusCode, 409, inactive.body);
  const emptyId = await createDraft({ ...definition, name: 'Empty draft', nodes: [], edges: [] });
  const empty = await activate(emptyId, 0);
  assert.equal(empty.statusCode, 422, empty.body);

  const forbiddenActivation = await activate(workflowId, 0, viewer);
  assert.equal(forbiddenActivation.statusCode, 403, forbiddenActivation.body);
  const foreignActivation = await activate(workflowId, 0, outsider);
  assert.equal(foreignActivation.statusCode, 404, foreignActivation.body);
  const liveActivation = await app.inject({
    method: 'POST', url: `${collection}/${workflowId}/activate`, headers: editor,
    payload: { mode: 'production', expectedRevision: 0 },
  });
  assert.equal(liveActivation.statusCode, 422, liveActivation.body);

  // The fixture has actions that require connections but the mock version never contacts them.
  const [activation, duplicateActivation] = await Promise.all([
    activate(workflowId, 0), activate(workflowId, 0, editor, concurrentApp),
  ]);
  assert.equal(activation.statusCode, 200, activation.body);
  const v1 = activation.json<Version>();
  assert.deepEqual({ versionNumber: v1.versionNumber, draftRevision: v1.draftRevision, mode: v1.mode },
    { versionNumber: 1, draftRevision: 0, mode: 'mock' });
  assert.equal(duplicateActivation.statusCode, 200, duplicateActivation.body);
  assert.deepEqual(duplicateActivation.json<Version>(), v1);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE runspell_runtime');
    await client.query("SELECT set_config('runspell.user_id', $1, true)", [tokens['Bearer admission-viewer']]);
    await assert.rejects(
      client.query('SELECT id FROM runspell.admit_mock_run($1, $2, $3)', [workspaceA, workflowId, 'direct-viewer']),
      { code: '42501' },
    );
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }

  const forbiddenRun = await admit(workflowId, 'viewer-run', app, viewer);
  assert.equal(forbiddenRun.statusCode, 403, forbiddenRun.body);
  const foreignRun = await admit(workflowId, 'outsider-run', app, outsider);
  assert.equal(foreignRun.statusCode, 404, foreignRun.body);
  const missingKey = await app.inject({
    method: 'POST', url: `${collection}/${workflowId}/runs`, headers: editor, payload: { mode: 'mock' },
  });
  assert.equal(missingKey.statusCode, 400, missingKey.body);
  const malformedKey = await admit(workflowId, 'x'.repeat(129));
  assert.equal(malformedKey.statusCode, 400, malformedKey.body);

  const [first, concurrent] = await Promise.all([
    admit(workflowId, 'first-admission'),
    admit(workflowId, 'first-admission', concurrentApp),
  ]);
  assert.equal(first.statusCode, 202, first.body);
  assert.equal(concurrent.statusCode, 202, concurrent.body);
  const initialRun = first.json<Run>();
  assert.deepEqual(concurrent.json<Run>(), initialRun);
  assert.deepEqual({ workflowId: initialRun.workflowId, version: initialRun.workflowVersionId, status: initialRun.status, mode: initialRun.mode },
    { workflowId, version: v1.id, status: 'accepted', mode: 'mock' });
  assert.ok(Number.isFinite(Date.parse(initialRun.createdAt)));

  const changedName = 'Revised mock invoice draft';
  const changed = await app.inject({
    method: 'PATCH', url: `${collection}/${workflowId}`, headers: editor,
    payload: { expectedRevision: 0, definition: { ...definition, name: changedName } },
  });
  assert.equal(changed.statusCode, 200, changed.body);
  const staleActivation = await activate(workflowId, 0);
  assert.equal(staleActivation.statusCode, 409, staleActivation.body);

  const beforeReactivation = await admit(workflowId, 'second-admission');
  assert.equal(beforeReactivation.statusCode, 202, beforeReactivation.body);
  const pinnedRun = beforeReactivation.json<Run>();
  assert.equal(pinnedRun.workflowVersionId, v1.id);
  assert.notEqual(pinnedRun.id, initialRun.id);

  const reactivated = await activate(workflowId, 1);
  assert.equal(reactivated.statusCode, 200, reactivated.body);
  const v2 = reactivated.json<Version>();
  assert.notEqual(v2.id, v1.id);
  assert.deepEqual({ versionNumber: v2.versionNumber, draftRevision: v2.draftRevision, mode: v2.mode },
    { versionNumber: 2, draftRevision: 1, mode: 'mock' });

  const retryOldKey = await admit(workflowId, 'first-admission');
  assert.equal(retryOldKey.statusCode, 202, retryOldKey.body);
  assert.deepEqual(retryOldKey.json<Run>(), initialRun);
  const fresh = await admit(workflowId, 'new-active-version');
  assert.equal(fresh.statusCode, 202, fresh.body);
  const latestRun = fresh.json<Run>();
  assert.equal(latestRun.workflowVersionId, v2.id);

  const readPath = `${workspacePath(workspaceA)}/runs/${initialRun.id}`;
  const read = await app.inject({ method: 'GET', url: readPath, headers: viewer });
  assert.equal(read.statusCode, 200, read.body);
  assert.deepEqual(read.json<Run>(), initialRun);
  for (const url of [readPath, `${workspacePath(workspaceB)}/runs/${initialRun.id}`]) {
    const denied = await app.inject({ method: 'GET', url, headers: outsider });
    assert.equal(denied.statusCode, 404, denied.body);
  }

  const scheduledId = await createDraft({
    ...definition, name: 'Scheduled draft', triggers: [{ id: 'schedule_start', type: 'schedule' }],
  });
  const scheduledActivation = await activate(scheduledId, 0);
  assert.equal(scheduledActivation.statusCode, 200, scheduledActivation.body);
  const scheduledManualRun = await admit(scheduledId, 'manual-scheduled-run');
  assert.equal(scheduledManualRun.statusCode, 409, scheduledManualRun.body);

  const versions = await admin.query<{ id: string; definition: Workflow }>(
    'SELECT id, definition FROM runspell.workflow_versions WHERE workflow_id = $1 ORDER BY version_number',
    [workflowId],
  );
  assert.deepEqual(versions.rows.map((row) => [row.id, row.definition.name]), [[v1.id, definition.name], [v2.id, changedName]]);
  const outbox = await admin.query<{ id: string; count: number }>(
    'SELECT runs.id, count(outbox.run_id)::int AS count FROM runspell.runs AS runs LEFT JOIN runspell.dispatch_outbox AS outbox ON outbox.run_id = runs.id WHERE runs.workspace_id = $1 GROUP BY runs.id',
    [workspaceA],
  );
  assert.deepEqual(new Map(outbox.rows.map(({ id, count }) => [id, count])),
    new Map([[initialRun.id, 1], [pinnedRun.id, 1], [latestRun.id, 1]]));

  const abandonedWorker = await workerPool.connect();
  let abandonedRunId: string;
  try {
    await abandonedWorker.query('BEGIN');
    await abandonedWorker.query('SET LOCAL ROLE runspell_mock_worker');
    const claimed = await abandonedWorker.query<{ id: string }>('SELECT id FROM runspell.claim_mock_run()');
    assert.ok(claimed.rows[0]);
    abandonedRunId = claimed.rows[0].id;
  } finally {
    await abandonedWorker.query('ROLLBACK');
    abandonedWorker.release();
  }

  const [firstDispatch, secondDispatch] = await Promise.all([
    dispatchNextMockRun(workerPool),
    dispatchNextMockRun(workerPool),
  ]);
  assert.ok(firstDispatch);
  assert.ok(secondDispatch);
  assert.equal(firstDispatch.status, 'succeeded');
  assert.equal(secondDispatch.status, 'succeeded');
  assert.notEqual(firstDispatch.id, secondDispatch.id);
  const dispatchedIds = new Set([firstDispatch.id, secondDispatch.id]);
  assert.ok(dispatchedIds.has(abandonedRunId), 'rollback leaves the claimed run available');
  const remaining = [initialRun, pinnedRun, latestRun].filter(({ id }) => !dispatchedIds.has(id));
  assert.equal(remaining.length, 1);
  const pending = await admin.query<{ run_id: string }>(
    'SELECT outbox.run_id FROM runspell.dispatch_outbox AS outbox JOIN runspell.runs AS runs ON runs.id = outbox.run_id WHERE runs.workspace_id = $1',
    [workspaceA],
  );
  assert.deepEqual(pending.rows, [{ run_id: remaining[0].id }]);
  assert.deepEqual(await dispatchNextMockRun(workerPool), { id: remaining[0].id, status: 'succeeded' });
  assert.equal(await dispatchNextMockRun(workerPool), null);
  const drained = await admin.query(
    'SELECT 1 FROM runspell.dispatch_outbox AS outbox JOIN runspell.runs AS runs ON runs.id = outbox.run_id WHERE runs.workspace_id = $1',
    [workspaceA],
  );
  assert.equal(drained.rowCount, 0);

  for (const run of [initialRun, pinnedRun, latestRun]) {
    const response = await app.inject({ method: 'GET', url: `${workspacePath(workspaceA)}/runs/${run.id}`, headers: viewer });
    assert.equal(response.statusCode, 200, response.body);
    const receipt = response.json<MockReceipt>();
    assert.equal(receipt.id, run.id);
    assert.equal(receipt.workflowVersionId, run.workflowVersionId);
    assert.equal(receipt.status, 'succeeded');
    assert.equal(receipt.mode, 'mock');
    assert.ok(Date.parse(receipt.finishedAt) >= Date.parse(run.createdAt), response.body);
    assert.equal(receipt.result.evidence, 'simulated');
    assert.ok(receipt.result.steps.some((step) => step.outcome === 'simulated'), response.body);
  }
  const replayedReceipt = await admit(workflowId, 'first-admission');
  assert.equal(replayedReceipt.statusCode, 200, replayedReceipt.body);
  assert.equal(replayedReceipt.json<MockReceipt>().id, initialRun.id);
});
