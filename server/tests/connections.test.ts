import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Pool } from 'pg';
import { buildDraftApi } from '../src/app.js';

type Connection = {
  id: string;
  workspaceId: string;
  label: string;
  kind: 'browser' | 'api';
  origin: string;
  status: 'pending' | 'revoked';
  createdAt: string;
  revokedAt: string | null;
};
type ConnectionPage = { connections: Connection[]; nextCursor: string | null };

test('workspace connection metadata is tenant-scoped, secret-free and idempotently revoked', async (t) => {
  const port = Number(process.env.RUNSPELL_TEST_PG_PORT);
  assert.ok(Number.isInteger(port) && port > 0 && port <= 65_535, 'Run through the disposable PostgreSQL test runner');
  const connection = { host: '127.0.0.1', port, database: 'postgres', max: 1, connectionTimeoutMillis: 3_000 };
  const admin = new Pool({ ...connection, user: 'runspell_test_admin' });
  const pool = new Pool({ ...connection, user: 'runspell_test_api' });
  const origin = 'https://portal.example';
  const apiOrigin = 'https://notify.example';
  const tokens = {
    'Bearer connection-editor': randomUUID(),
    'Bearer connection-viewer': randomUUID(),
    'Bearer connection-outsider': randomUUID(),
  };
  const app = buildDraftApi({
    pool,
    allowedOrigins: [origin, apiOrigin],
    authenticate: async (request) => Object.entries(tokens).find(([token]) => token === request.headers.authorization)?.[1] ?? null,
  });
  t.after(async () => {
    try {
      await app.close();
    } finally {
      await Promise.all([pool.end(), admin.end()]);
    }
  });

  const firstWorkspace = randomUUID();
  const otherWorkspace = randomUUID();
  await admin.query(
    'INSERT INTO runspell.workspaces (id, name) VALUES ($1, $2), ($3, $4)',
    [firstWorkspace, 'Connections workspace A', otherWorkspace, 'Connections workspace B'],
  );
  for (const [token, actorId] of Object.entries(tokens)) {
    await admin.query(
      'INSERT INTO runspell.users (id, identity_issuer, identity_subject) VALUES ($1, $2, $3)',
      [actorId, 'https://identity.example.test', token],
    );
  }
  await admin.query(
    "INSERT INTO runspell.workspace_members (user_id, workspace_id, role) VALUES ($1, $2, 'editor'), ($3, $2, 'viewer'), ($4, $5, 'owner')",
    [tokens['Bearer connection-editor'], firstWorkspace, tokens['Bearer connection-viewer'],
      tokens['Bearer connection-outsider'], otherWorkspace],
  );

  const collection = (id: string) => `/api/v1/workspaces/${id}/connections`;
  const url = collection(firstWorkspace);
  const editor = { authorization: 'Bearer connection-editor' };
  const viewer = { authorization: 'Bearer connection-viewer' };
  const outsider = { authorization: 'Bearer connection-outsider' };
  const draft = { label: 'Invoice portal', kind: 'browser', origin };

  const anonymous = await app.inject({ method: 'GET', url });
  assert.equal(anonymous.statusCode, 401, anonymous.body);
  const empty = await app.inject({ method: 'GET', url, headers: viewer });
  assert.equal(empty.statusCode, 200, empty.body);
  assert.deepEqual(empty.json<ConnectionPage>(), { connections: [], nextCursor: null });

  const foreignList = await app.inject({ method: 'GET', url, headers: outsider });
  assert.equal(foreignList.statusCode, 404, foreignList.body);
  const viewerWrite = await app.inject({ method: 'POST', url, headers: viewer, payload: draft });
  assert.equal(viewerWrite.statusCode, 403, viewerWrite.body);

  for (const payload of [
    { ...draft, origin: 'https://unapproved.example' },
    { ...draft, origin: origin + '/?token=UNSAVED_TEST_CREDENTIAL' },
    { ...draft, apiKey: 'UNSAVED_TEST_CREDENTIAL' },
    { ...draft, credentials: { token: 'UNSAVED_TEST_CREDENTIAL' } },
    { ...draft, status: 'connected' },
  ]) {
    const bad = await app.inject({ method: 'POST', url, headers: editor, payload });
    assert.equal(bad.statusCode, 422, bad.body);
    assert.doesNotMatch(bad.body, /UNSAVED_TEST_CREDENTIAL/);
  }

  const created = await app.inject({
    method: 'POST', url, headers: editor, payload: { ...draft, origin: 'https://PORTAL.example:443/' },
  });
  assert.equal(created.statusCode, 201, created.body);
  const record = created.json<Connection>();
  assert.ok(Number.isFinite(Date.parse(record.createdAt)));
  assert.deepEqual(record, {
    ...draft, id: record.id, workspaceId: firstWorkspace, status: 'pending', createdAt: record.createdAt, revokedAt: null,
  });
  const apiDraft = { label: 'Notifications', kind: 'api', origin: apiOrigin };
  const other = await app.inject({
    method: 'POST', url: collection(otherWorkspace), headers: outsider, payload: apiDraft,
  });
  assert.equal(other.statusCode, 201, other.body);
  const foreignRecord = other.json<Connection>();
  assert.deepEqual(foreignRecord, {
    ...apiDraft, id: foreignRecord.id, workspaceId: otherWorkspace, status: 'pending', createdAt: foreignRecord.createdAt, revokedAt: null,
  });

  const listed = await app.inject({ method: 'GET', url, headers: viewer });
  assert.equal(listed.statusCode, 200, listed.body);
  assert.deepEqual(listed.json<ConnectionPage>(), { connections: [record], nextCursor: null });

  const recordUrl = `${url}/${record.id}`;
  const viewerRevoke = await app.inject({ method: 'DELETE', url: recordUrl, headers: viewer });
  assert.equal(viewerRevoke.statusCode, 403, viewerRevoke.body);
  for (const url of [recordUrl, `${collection(otherWorkspace)}/${record.id}`]) {
    const foreignRevoke = await app.inject({ method: 'DELETE', url, headers: outsider });
    assert.equal(foreignRevoke.statusCode, 404, foreignRevoke.body);
  }
  const revoked = await app.inject({ method: 'DELETE', url: recordUrl, headers: editor });
  assert.equal(revoked.statusCode, 200, revoked.body);
  const revokedRecord = revoked.json<Connection>();
  assert.ok(revokedRecord.revokedAt && Date.parse(revokedRecord.revokedAt) >= Date.parse(record.createdAt));
  assert.deepEqual(revokedRecord, { ...record, status: 'revoked', revokedAt: revokedRecord.revokedAt });
  const replay = await app.inject({ method: 'DELETE', url: recordUrl, headers: editor });
  assert.equal(replay.statusCode, 200, replay.body);
  assert.deepEqual(replay.json<Connection>(), revokedRecord);
  const listedRevoked = await app.inject({ method: 'GET', url, headers: viewer });
  assert.equal(listedRevoked.statusCode, 200, listedRevoked.body);
  assert.deepEqual(listedRevoked.json<ConnectionPage>(), { connections: [revokedRecord], nextCursor: null });

  const stored = await admin.query<{ data: string }>(
    'SELECT to_jsonb(c)::text AS data FROM runspell.connections c WHERE c.workspace_id = $1',
    [firstWorkspace],
  );
  assert.equal(stored.rowCount, 1, 'invalid records and cross-tenant operations did not add rows');
  assert.doesNotMatch(stored.rows[0].data, /UNSAVED_TEST_CREDENTIAL/);
  assert.match(stored.rows[0].data, /"status": "revoked"/);
});
