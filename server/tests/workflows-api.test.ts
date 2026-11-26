import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Pool } from 'pg';
import { invoicePolicy, invoiceWorkflow } from '../../fixtures/m0/invoice.js';
import { WorkflowSchema, type Workflow } from '../../shared/index.js';
import { buildDraftApi } from '../src/app.js';

type Draft = {
  id: string;
  workspaceId: string;
  name: string;
  revision: number;
  definition: Workflow;
};

type DraftPage = { workflows: Draft[]; nextCursor: string | null };

const { id: fixtureId, workspaceId: fixtureWorkspaceId, ...definition } = invoiceWorkflow;

test('workflow draft routes enforce workspace access and persist revision-checked edits', async (t) => {
  const port = Number(process.env.RUNSPELL_TEST_PG_PORT);
  assert.ok(Number.isInteger(port) && port > 0 && port <= 65_535, 'Run through the disposable PostgreSQL test runner');
  const connection = { host: '127.0.0.1', port, database: 'postgres', max: 1, connectionTimeoutMillis: 3_000 };
  const admin = new Pool({ ...connection, user: 'runspell_test_admin' });
  const pool = new Pool({ ...connection, user: 'runspell_test_api' });
  const concurrentPool = new Pool({ ...connection, user: 'runspell_test_api' });
  const tokens = {
    'Bearer editor-a': randomUUID(),
    'Bearer viewer-a': randomUUID(),
    'Bearer owner-b': randomUUID(),
    'Bearer nonmember': randomUUID(),
  };
  const appOptions: Omit<Parameters<typeof buildDraftApi>[0], 'pool'> = {
    allowedOrigins: invoicePolicy.allowedOrigins,
    authenticate: async (request) => Object.entries(tokens).find(([token]) => token === request.headers.authorization)?.[1] ?? null,
  };
  const app = await buildDraftApi({ ...appOptions, pool });
  const concurrentApp = await buildDraftApi({ ...appOptions, pool: concurrentPool });
  t.after(async () => {
    try {
      await Promise.all([app.close(), concurrentApp.close()]);
    } finally {
      await Promise.all([pool.end(), concurrentPool.end(), admin.end()]);
    }
  });

  const workspaceA = randomUUID();
  const workspaceB = randomUUID();
  await admin.query(
    'INSERT INTO runspell.workspaces (id, name) VALUES ($1, $2), ($3, $4)',
    [workspaceA, 'Workspace A', workspaceB, 'Workspace B'],
  );
  for (const [token, actorId] of Object.entries(tokens)) {
    await admin.query(
      'INSERT INTO runspell.users (id, identity_issuer, identity_subject) VALUES ($1, $2, $3)',
      [actorId, 'https://identity.example.test', token],
    );
  }
  await admin.query(
    'INSERT INTO runspell.workspace_members (user_id, workspace_id, role) VALUES ($1, $2, $3), ($4, $2, $5), ($6, $7, $8)',
    [tokens['Bearer editor-a'], workspaceA, 'editor', tokens['Bearer viewer-a'], 'viewer', tokens['Bearer owner-b'], workspaceB, 'owner'],
  );

  const collection = (workspaceId: string) => `/api/v1/workspaces/${workspaceId}/workflows`;
  const editor = { authorization: 'Bearer editor-a' };
  const viewer = { authorization: 'Bearer viewer-a' };
  const owner = { authorization: 'Bearer owner-b' };
  const anonymous = await app.inject({ method: 'GET', url: collection(workspaceA) });
  assert.equal(anonymous.statusCode, 401, anonymous.body);
  const spoofed = await app.inject({
    method: 'GET', url: collection(workspaceA),
    headers: { authorization: `Bearer ${tokens['Bearer editor-a']}`, 'x-user-id': tokens['Bearer editor-a'] },
  });
  assert.equal(spoofed.statusCode, 401, spoofed.body);

  const created = await app.inject({ method: 'POST', url: collection(workspaceA), headers: editor, payload: { definition } });
  assert.equal(created.statusCode, 201, created.body);
  const draft = created.json<Draft>();
  const item = `${collection(workspaceA)}/${draft.id}`;
  assert.equal(draft.workspaceId, workspaceA);
  assert.equal(draft.name, definition.name);
  assert.equal(draft.revision, 0);
  const parsed = WorkflowSchema.parse(draft.definition);
  assert.notEqual(parsed.id, fixtureId);
  assert.notEqual(parsed.workspaceId, fixtureWorkspaceId);
  assert.deepEqual(parsed.nodes, definition.nodes);

  const otherCreated = await app.inject({
    method: 'POST', url: collection(workspaceB), headers: owner, payload: { definition: { ...definition, name: 'Tenant B draft' } },
  });
  assert.equal(otherCreated.statusCode, 201, otherCreated.body);
  const otherDraft = otherCreated.json<Draft>();
  assert.notEqual(otherDraft.definition.id, parsed.id);
  assert.notEqual(otherDraft.definition.workspaceId, parsed.workspaceId);

  const viewerList = await app.inject({ method: 'GET', url: collection(workspaceA), headers: viewer });
  assert.equal(viewerList.statusCode, 200, viewerList.body);
  assert.deepEqual(viewerList.json<DraftPage>().workflows.map(({ id }) => id), [draft.id]);
  const after = await app.inject({ method: 'GET', url: `${collection(workspaceA)}?after=${draft.id}`, headers: viewer });
  assert.equal(after.statusCode, 200, after.body);
  assert.deepEqual(after.json<DraftPage>(), { workflows: [], nextCursor: null });
  const viewerRead = await app.inject({ method: 'GET', url: item, headers: viewer });
  assert.equal(viewerRead.statusCode, 200, viewerRead.body);
  assert.deepEqual(viewerRead.json<Draft>(), draft);
  const uppercaseItem = `${collection(workspaceA.toUpperCase())}/${draft.id.toUpperCase()}`;
  const uppercaseRead = await app.inject({ method: 'GET', url: uppercaseItem, headers: viewer });
  assert.equal(uppercaseRead.statusCode, 200, uppercaseRead.body);
  assert.deepEqual(uppercaseRead.json<Draft>(), draft);
  const viewerEdit = await app.inject({
    method: 'PATCH', url: item, headers: viewer, payload: { expectedRevision: 0, definition },
  });
  assert.equal(viewerEdit.statusCode, 403, viewerEdit.body);
  const viewerCreate = await app.inject({
    method: 'POST', url: collection(workspaceA), headers: viewer, payload: { definition },
  });
  assert.equal(viewerCreate.statusCode, 403, viewerCreate.body);
  const guessedOtherDraft = await app.inject({
    method: 'GET', url: `${collection(workspaceA)}/${otherDraft.id}`, headers: viewer,
  });
  assert.equal(guessedOtherDraft.statusCode, 404, guessedOtherDraft.body);
  const foreignWorkspace = await app.inject({ method: 'GET', url: collection(workspaceB), headers: editor });
  assert.equal(foreignWorkspace.statusCode, 404, foreignWorkspace.body);
  const nonmember = await app.inject({ method: 'GET', url: item, headers: { authorization: 'Bearer nonmember' } });
  assert.equal(nonmember.statusCode, 404, nonmember.body);

  const invalid = await app.inject({
    method: 'PATCH', url: item, headers: editor,
    payload: { expectedRevision: 0, definition: { ...definition, nodes: [], edges: definition.edges } },
  });
  assert.equal(invalid.statusCode, 422, invalid.body);
  const unapprovedNodes = definition.nodes.map((node) => node.actionType === 'browser.navigate'
    ? { ...node, config: { ...node.config, url: 'https://unapproved.example/invoice' } }
    : node);
  const unapproved = await app.inject({
    method: 'PATCH', url: item, headers: editor,
    payload: { expectedRevision: 0, definition: { ...definition, nodes: unapprovedNodes } },
  });
  assert.equal(unapproved.statusCode, 422, unapproved.body);

  const replacements = [app, concurrentApp].map((instance, index) =>
    instance.inject({
      method: 'PATCH', url: index === 0 ? item : uppercaseItem, headers: editor,
      payload: { expectedRevision: 0, definition: { ...definition, name: `Revision attempt ${index + 1}` } },
    }),
  );
  const [first, second] = await Promise.all(replacements);
  assert.deepEqual([first.statusCode, second.statusCode].sort(), [200, 409], [first.body, second.body].join('\n'));
  const accepted = (first.statusCode === 200 ? first : second).json<Draft>();
  assert.equal(accepted.revision, 1);
  assert.equal(accepted.id, draft.id);
  assert.equal(accepted.workspaceId, draft.workspaceId);
  assert.equal(accepted.definition.id, parsed.id);
  assert.equal(accepted.definition.workspaceId, parsed.workspaceId);
  assert.equal(accepted.definition.name, accepted.name);
  const stored = await admin.query(
    'SELECT name, draft_revision, draft_definition FROM runspell.workflows WHERE workspace_id = $1 AND id = $2',
    [workspaceA, draft.id],
  );
  assert.deepEqual(stored.rows, [{ name: accepted.name, draft_revision: accepted.revision, draft_definition: accepted.definition }]);

  const ownerList = await app.inject({ method: 'GET', url: collection(workspaceB), headers: owner });
  assert.equal(ownerList.statusCode, 200, ownerList.body);
  assert.deepEqual(ownerList.json<DraftPage>().workflows.map(({ id }) => id), [otherDraft.id]);

  const blank = await app.inject({
    method: 'POST', url: collection(workspaceA), headers: editor,
    payload: { definition: { ...definition, name: 'Blank draft', nodes: [], edges: [] } },
  });
  assert.equal(blank.statusCode, 201, blank.body);
  const blankDraft = blank.json<Draft>();
  assert.equal(blankDraft.name, 'Blank draft');
  assert.equal(blankDraft.revision, 0);
  assert.deepEqual(WorkflowSchema.parse(blankDraft.definition).nodes, []);
  assert.deepEqual(blankDraft.definition.edges, []);
  const blankRead = await app.inject({ method: 'GET', url: `${collection(workspaceA)}/${blankDraft.id}`, headers: viewer });
  assert.equal(blankRead.statusCode, 200, blankRead.body);
  assert.deepEqual(blankRead.json<Draft>(), blankDraft);

  const pooled = await pool.query("SELECT current_user AS role, NULLIF(current_setting('runspell.user_id', true), '') AS actor");
  assert.deepEqual(pooled.rows, [{ role: 'runspell_test_api', actor: null }]);
});
