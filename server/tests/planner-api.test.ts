import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Pool } from 'pg';
import { invoicePolicy, invoiceWorkflow } from '../../fixtures/m0/invoice.js';
import { WorkflowSchema, type Workflow } from '../../shared/index.js';
import { buildDraftApi } from '../src/app.js';

type Draft = { id: string; workspaceId: string; name: string; revision: number; definition: Workflow };
type Generation = {
  id: string;
  status: string;
  draft?: Draft;
  proposal?: { workflowId: string; expectedRevision: number; definition: Workflow };
  assumptions?: string[];
  connectionRequirements?: Array<{ kind: string }>;
  message?: string;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
};

const { id: _fixtureId, workspaceId: _fixtureWorkspaceId, ...definition } = invoiceWorkflow;
const usage = { inputTokens: 9, outputTokens: 3, totalTokens: 12 };
const assumptions = ['The user has authorized the invoice portal connection.'];
const prompt = 'Collect the known invoice. Raw-only canary 4fec1932.';
const revisionPrompt = 'Rename this workflow.';
const clarificationPrompt = 'Clarification test';
const unsupportedPrompt = 'Unsupported test';
const invalidPrompt = 'Invalid provider response test';
const destinationPrompt = 'Unapproved action destination test';

const eventIds = (body: string) => [...body.matchAll(/^id:[ \t]*(\d+)/gm)].map((match) => Number(match[1]));

test('planner persists workspace-scoped drafts and applies only explicitly reviewed revisions', async (t) => {
  const port = Number(process.env.RUNSPELL_TEST_PG_PORT);
  assert.ok(Number.isInteger(port) && port > 0 && port <= 65_535, 'Run through the disposable PostgreSQL test runner');
  const connection = { host: '127.0.0.1', port, database: 'postgres', max: 1, connectionTimeoutMillis: 3_000 };
  const admin = new Pool({ ...connection, user: 'runspell_test_admin' });
  const pool = new Pool({ ...connection, user: 'runspell_test_api' });
  const workspaceA = randomUUID();
  const workspaceB = randomUUID();
  const tokens = {
    'Bearer planner-owner': randomUUID(),
    'Bearer planner-viewer': randomUUID(),
    'Bearer other-owner': randomUUID(),
  };
  const calls: string[] = [];
  const app = buildDraftApi({
    pool,
    allowedOrigins: invoicePolicy.allowedOrigins,
    authenticate: async (request) => Object.entries(tokens).find(([token]) => token === request.headers.authorization)?.[1] ?? null,
    planner: async (input) => {
      calls.push(input.prompt);
      if (input.prompt === clarificationPrompt) {
        return { output: { status: 'clarification', message: 'Which invoice number should I use?' }, usage };
      }
      if (input.prompt === unsupportedPrompt) {
        return { output: { status: 'unsupported', message: 'That action is not in the catalog.' }, usage };
      }
      if (input.prompt === invalidPrompt) {
        return { output: { debug: 'provider-internal-canary' }, usage };
      }
      if (input.prompt === destinationPrompt) {
        const nodes = definition.nodes.map((node) => node.actionType === 'browser.navigate'
          ? { ...node, config: { ...node.config, url: 'https://unapproved.example/invoice' } }
          : node);
        return { output: { status: 'candidate', definition: { ...definition, nodes }, assumptions }, usage };
      }
      if (input.prompt === revisionPrompt) {
        assert.ok(input.current, 'a conversational edit receives the current draft');
        assert.doesNotMatch(JSON.stringify(input.current), /portal\.example/);
        const nodes = definition.nodes.map((node) => ({ ...node, config: {}, inputs: {} }));
        return { output: { status: 'candidate', definition: { ...definition, nodes, name: 'Reviewed invoice draft' }, assumptions }, usage };
      }
      assert.equal(input.prompt, prompt);
      return { output: { status: 'candidate', definition, assumptions }, usage };
    },
  });
  t.after(async () => {
    try {
      await app.close();
    } finally {
      await Promise.all([pool.end(), admin.end()]);
    }
  });

  await admin.query(
    'INSERT INTO runspell.workspaces (id, name) VALUES ($1, $2), ($3, $4)',
    [workspaceA, 'Planner workspace A', workspaceB, 'Planner workspace B'],
  );
  for (const [token, actorId] of Object.entries(tokens)) {
    await admin.query(
      'INSERT INTO runspell.users (id, identity_issuer, identity_subject) VALUES ($1, $2, $3)',
      [actorId, 'https://identity.example.test', 'planner:' + token],
    );
  }
  await admin.query(
    'INSERT INTO runspell.workspace_members (user_id, workspace_id, role) VALUES ($1, $2, $3), ($4, $2, $5), ($6, $7, $8)',
    [tokens['Bearer planner-owner'], workspaceA, 'owner', tokens['Bearer planner-viewer'], 'viewer', tokens['Bearer other-owner'], workspaceB, 'owner'],
  );

  const workspacePath = (workspaceId: string) => `/api/v1/workspaces/${workspaceId}`;
  const generations = `${workspacePath(workspaceA)}/ai/generations`;
  const owner = { authorization: 'Bearer planner-owner' };
  const viewer = { authorization: 'Bearer planner-viewer' };
  const outsider = { authorization: 'Bearer other-owner' };
  const rejected = await app.inject({ method: 'POST', url: generations, headers: viewer, payload: { prompt } });
  assert.equal(rejected.statusCode, 403, rejected.body);
  assert.equal(calls.length, 0);

  const created = await app.inject({ method: 'POST', url: generations, headers: owner, payload: { prompt } });
  assert.equal(created.statusCode, 201, created.body);
  const generation = created.json<Generation>();
  assert.equal(generation.status, 'ready');
  assert.deepEqual(generation.assumptions, assumptions);
  assert.deepEqual(generation.usage, usage);
  assert.ok(generation.connectionRequirements?.some(({ kind }) => kind === 'browser'));
  assert.ok(generation.draft);
  const draft = generation.draft;
  assert.equal(draft.workspaceId, workspaceA);
  assert.equal(draft.revision, 0);
  assert.deepEqual(WorkflowSchema.parse(draft.definition).nodes, definition.nodes);
  assert.doesNotMatch(created.body, /4fec1932/);

  const generationPath = `${generations}/${generation.id}`;
  const record = await app.inject({ method: 'GET', url: generationPath, headers: owner });
  assert.equal(record.statusCode, 200, record.body);
  assert.deepEqual(record.json<Generation>().usage, usage);
  assert.doesNotMatch(record.body, /4fec1932/);
  const stored = await admin.query<{ data: string }>(
    'SELECT to_jsonb(g)::text AS data FROM runspell.ai_generations g WHERE g.id = $1', [generation.id],
  );
  assert.equal(stored.rowCount, 1);
  assert.doesNotMatch(stored.rows[0].data, /4fec1932/);

  const guessed = `${workspacePath(workspaceB)}/ai/generations/${generation.id}`;
  for (const url of [generationPath, guessed, `${generationPath}/events`]) {
    const previous = await app.inject({ method: 'GET', url, headers: outsider });
    assert.equal(previous.statusCode, 404, previous.body);
  }

  const events = await app.inject({ method: 'GET', url: `${generationPath}/events`, headers: owner });
  assert.equal(events.statusCode, 200, events.body);
  assert.match(String(events.headers['content-type']), /^text\/event-stream\b/);
  assert.deepEqual(eventIds(events.body), [1, 2]);
  assert.match(events.body, /ready/);
  assert.doesNotMatch(events.body, /4fec1932/);
  const replay = await app.inject({
    method: 'GET', url: `${generationPath}/events`, headers: { ...owner, 'last-event-id': '1' },
  });
  assert.equal(replay.statusCode, 200, replay.body);
  assert.deepEqual(eventIds(replay.body), [2]);
  assert.match(replay.body, /ready/);

  for (const [input, status, message] of [
    [clarificationPrompt, 'clarification', 'Which invoice number should I use?'],
    [unsupportedPrompt, 'unsupported', 'That action is not in the catalog.'],
    [invalidPrompt, 'failed', undefined],
    [destinationPrompt, 'failed', undefined],
  ] as const) {
    const response = await app.inject({ method: 'POST', url: generations, headers: owner, payload: { prompt: input } });
    assert.equal(response.statusCode, 201, response.body);
    const result = response.json<Generation>();
    assert.equal(result.status, status, response.body);
    if (message) assert.equal(result.message, message);
    assert.ok(!result.draft, 'non-ready generation did not create a workflow');
    assert.doesNotMatch(response.body, /provider-internal-canary|unapproved\.example/);
  }

  const workflowPath = `${workspacePath(workspaceA)}/workflows/${draft.id}`;
  const revisionPath = `${workflowPath}/draft/ai-edit`;
  const revisionBody = { prompt: revisionPrompt, expectedRevision: 0 };
  const proposed = await app.inject({ method: 'POST', url: revisionPath, headers: owner, payload: revisionBody });
  assert.equal(proposed.statusCode, 201, proposed.body);
  const revision = proposed.json<Generation>();
  assert.equal(revision.status, 'ready');
  assert.equal(revision.proposal?.workflowId, draft.id);
  assert.equal(revision.proposal?.expectedRevision, 0);
  assert.equal(revision.proposal?.definition.name, 'Reviewed invoice draft');
  assert.deepEqual(revision.proposal?.definition.nodes, definition.nodes);
  assert.ok(!revision.draft);

  const unchanged = await app.inject({ method: 'GET', url: workflowPath, headers: owner });
  assert.equal(unchanged.statusCode, 200, unchanged.body);
  assert.deepEqual(unchanged.json<Draft>(), draft);

  const apply = `${workflowPath}/draft/apply-patch`;
  const applyBody = { generationId: revision.id };
  const viewerApply = await app.inject({ method: 'POST', url: apply, headers: viewer, payload: applyBody });
  assert.equal(viewerApply.statusCode, 403, viewerApply.body);
  const applied = await app.inject({ method: 'POST', url: apply, headers: owner, payload: applyBody });
  assert.equal(applied.statusCode, 200, applied.body);
  const updated = await app.inject({ method: 'GET', url: workflowPath, headers: owner });
  assert.equal(updated.statusCode, 200, updated.body);
  assert.deepEqual(updated.json<Draft>(), { ...draft, revision: 1, name: 'Reviewed invoice draft', definition: revision.proposal?.definition });
  const repeated = await app.inject({ method: 'POST', url: apply, headers: owner, payload: applyBody });
  assert.equal(repeated.statusCode, 409, repeated.body);

  const performedCalls = calls.length;
  const stale = await app.inject({ method: 'POST', url: revisionPath, headers: owner, payload: revisionBody });
  assert.equal(stale.statusCode, 409, stale.body);
  assert.equal(calls.length, performedCalls, 'stale edit never calls the provider');

  for (let i = performedCalls; i < 10; i++) {
    const allowed = await app.inject({ method: 'POST', url: generations, headers: owner, payload: { prompt: clarificationPrompt } });
    assert.equal(allowed.statusCode, 201, allowed.body);
  }
  const quota = await app.inject({ method: 'POST', url: generations, headers: owner, payload: { prompt } });
  assert.equal(quota.statusCode, 429, quota.body);
  assert.equal(calls.length, 10, 'workspace quota is checked before the provider call');
});
