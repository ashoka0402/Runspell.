import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { generateKeyPair, SignJWT } from 'jose';
import { Pool } from 'pg';
import { buildDraftApi } from '../src/app.js';
import { resolveOidcActor } from '../src/database.js';
import { buildOidcAuthenticator } from '../src/oidc.js';

type Run = {
  id: string;
  workflowId: string;
  workflowVersionId: string;
  status: 'accepted' | 'succeeded' | 'failed';
  mode: 'mock';
  createdAt: string;
  finishedAt: string | null;
};
type RunPage = { runs: Run[]; nextCursor: string | null };

test('signed identity and paginated run history expose only the member workspace summaries', async (t) => {
  const port = Number(process.env.RUNSPELL_TEST_PG_PORT);
  assert.ok(Number.isInteger(port) && port > 0 && port <= 65_535, 'Run through the disposable PostgreSQL test runner');
  const connection = { host: '127.0.0.1', port, database: 'postgres', max: 1, connectionTimeoutMillis: 3_000 };
  const admin = new Pool({ ...connection, user: 'runspell_test_admin' });
  const pool = new Pool({ ...connection, user: 'runspell_test_api' });
  const identity = new Pool({ ...connection, user: 'runspell_test_identity' });
  const issuer = 'https://identity.example.test/run-history';
  const audience = 'runspell-api';
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const app = buildDraftApi({
    pool,
    authenticate: buildOidcAuthenticator({
      issuer,
      audience,
      jwksUrl: 'https://identity.example.test/run-history/jwks',
      verificationKey: async () => publicKey,
      resolveActor: (verifiedIssuer, verifiedSubject) => resolveOidcActor(identity, verifiedIssuer, verifiedSubject),
    }),
    allowedOrigins: [],
  });
  t.after(async () => {
    try {
      await app.close();
    } finally {
      await Promise.all([pool.end(), identity.end(), admin.end()]);
    }
  });

  const member = randomUUID();
  const nonmember = randomUUID();
  const otherMember = randomUUID();
  const [alpha, otherAlpha] = [randomUUID(), randomUUID()].sort();
  const zeta = randomUUID();
  const foreign = randomUUID();
  await admin.query(
    'INSERT INTO runspell.users (id, identity_issuer, identity_subject) VALUES ($1, $2, $3), ($4, $2, $5), ($6, $2, $7)',
    [member, issuer, 'member', nonmember, 'nonmember', otherMember, 'other-member'],
  );
  await admin.query(
    'INSERT INTO runspell.workspaces (id, name) VALUES ($1, $2), ($3, $2), ($4, $5), ($6, $7)',
    [otherAlpha, 'Alpha', alpha, zeta, 'Zeta', foreign, 'Private'],
  );
  await admin.query(
    "INSERT INTO runspell.workspace_members (user_id, workspace_id, role) VALUES ($1, $2, 'owner'), ($1, $3, 'admin'), ($1, $4, 'viewer'), ($5, $6, 'owner')",
    [member, zeta, otherAlpha, alpha, otherMember, foreign],
  );

  async function seedVersion(workspaceId: string, actorId: string) {
    const workflowId = randomUUID();
    const versionId = randomUUID();
    await admin.query(
      "INSERT INTO runspell.workflows (id, workspace_id, name, draft_definition) VALUES ($1, $2, 'History fixture', '{}')",
      [workflowId, workspaceId],
    );
    await admin.query(
      "INSERT INTO runspell.workflow_versions (id, workspace_id, workflow_id, version_number, draft_revision, definition, created_by) VALUES ($1, $2, $3, 1, 0, '{}', $4)",
      [versionId, workspaceId, workflowId, actorId],
    );
    return { workflowId, versionId };
  }

  const alphaVersion = await seedVersion(alpha, member);
  const foreignVersion = await seedVersion(foreign, otherMember);
  const zetaVersion = await seedVersion(zeta, member);
  const [firstTie, secondTie] = [randomUUID(), randomUUID()].sort();
  const early = '2026-01-01T12:00:00.000Z';
  const tie = '2026-01-02T12:00:00.000Z';
  const late = '2026-01-03T12:00:00.000Z';
  const finished = '2026-01-03T12:05:00.000Z';

  async function seedRun(
    workspaceId: string, actorId: string, { workflowId, versionId }: Awaited<ReturnType<typeof seedVersion>>,
    id: string, status: Run['status'], createdAt: string,
  ): Promise<Run> {
    const finishedAt = status === 'accepted' ? null : finished;
    await admin.query(
      `INSERT INTO runspell.runs
       (id, workspace_id, workflow_id, workflow_version_id, requested_by, idempotency_key, status, created_at, finished_at, result)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [id, workspaceId, workflowId, versionId, actorId, 'private-idempotency:' + id, status, createdAt, finishedAt,
        finishedAt ? { evidence: 'simulated', privateOutput: 'simulated fixture secret' } : null],
    );
    return { id, workflowId, workflowVersionId: versionId, status, mode: 'mock', createdAt, finishedAt };
  }

  const newest = await seedRun(alpha, member, alphaVersion, randomUUID(), 'failed', late);
  const tieA = await seedRun(alpha, member, alphaVersion, firstTie, 'succeeded', tie);
  const tieB = await seedRun(alpha, member, alphaVersion, secondTie, 'accepted', tie);
  const oldest = await seedRun(alpha, member, alphaVersion, randomUUID(), 'accepted', early);
  const foreignRun = await seedRun(foreign, otherMember, foreignVersion, randomUUID(), 'accepted', early);
  await admin.query(
    `INSERT INTO runspell.runs (workspace_id, workflow_id, workflow_version_id, requested_by, idempotency_key, created_at)
     SELECT $1, $2, $3, $4, 'batch:' || n, $5::timestamptz + n * interval '1 second'
     FROM generate_series(1, 26) AS batch(n)`,
    [zeta, zetaVersion.workflowId, zetaVersion.versionId, member, early],
  );

  async function bearer(subject: string, requestedAudience = audience) {
    const token = await new SignJWT({ runspell_user_id: member })
      .setProtectedHeader({ alg: 'RS256', typ: 'at+jwt' })
      .setIssuer(issuer)
      .setAudience(requestedAudience)
      .setSubject(subject)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
    return { authorization: `Bearer ${token}` };
  }

  const headers = await bearer('member');
  const unrelated = await bearer('nonmember');
  const otherHeaders = await bearer('other-member');
  const me = '/api/v1/me';
  const memberInfo = await app.inject({ method: 'GET', url: me, headers });
  assert.equal(memberInfo.statusCode, 200, memberInfo.body);
  assert.deepEqual(memberInfo.json(), {
    id: member,
    workspaces: [
      { id: alpha, name: 'Alpha', role: 'viewer' },
      { id: otherAlpha, name: 'Alpha', role: 'admin' },
      { id: zeta, name: 'Zeta', role: 'owner' },
    ],
  });
  const noMemberships = await app.inject({ method: 'GET', url: me, headers: unrelated });
  assert.equal(noMemberships.statusCode, 200, noMemberships.body);
  assert.deepEqual(noMemberships.json(), { id: nonmember, workspaces: [] });
  await assert.rejects(identity.query('SELECT id FROM runspell.workspaces'), { code: '42501' });
  await assert.rejects(identity.query('SET ROLE runspell_runtime'), { code: '42501' });
  await assert.rejects(resolveOidcActor(pool, issuer, 'member'), /Identity lookup failed/);
  assert.equal(await resolveOidcActor(identity, 'https://other.example.test', 'member'), null);
  for (const unauthenticated of [{}, await bearer('unprovisioned'), await bearer('member', 'wrong-audience')]) {
    const denied = await app.inject({ method: 'GET', url: me, headers: { ...unauthenticated, 'x-user-id': member } });
    assert.equal(denied.statusCode, 401, denied.body);
  }

  const history = (workspace: string) => `/api/v1/workspaces/${workspace}/runs`;
  const alphaHistory = history(alpha);
  const list = await app.inject({ method: 'GET', url: alphaHistory, headers });
  assert.equal(list.statusCode, 200, list.body);
  assert.deepEqual(list.json<RunPage>(), { runs: [newest, tieA, tieB, oldest], nextCursor: null });
  assert.doesNotMatch(list.body, /private-idempotency|simulated fixture secret|requestedBy|requested_by|\bresult\b/i);
  const first = await app.inject({ method: 'GET', url: alphaHistory + '?limit=2', headers });
  assert.equal(first.statusCode, 200, first.body);
  assert.deepEqual(first.json<RunPage>(), { runs: [newest, tieA], nextCursor: tieA.id });
  const second = await app.inject({ method: 'GET', url: alphaHistory + `?limit=2&after=${tieA.id}`, headers });
  assert.equal(second.statusCode, 200, second.body);
  assert.deepEqual(second.json<RunPage>(), { runs: [tieB, oldest], nextCursor: null });

  for (const [status, expected] of [['accepted', [tieB, oldest]], ['succeeded', [tieA]], ['failed', [newest]]] as const) {
    const filtered = await app.inject({ method: 'GET', url: alphaHistory + `?status=${status}`, headers });
    assert.equal(filtered.statusCode, 200, filtered.body);
    assert.deepEqual(filtered.json<RunPage>(), { runs: expected, nextCursor: null });
  }
  for (const cursor of [randomUUID(), foreignRun.id]) {
    const invisible = await app.inject({ method: 'GET', url: alphaHistory + `?after=${cursor}`, headers });
    assert.equal(invisible.statusCode, 200, invisible.body);
    assert.deepEqual(invisible.json<RunPage>(), { runs: [], nextCursor: null });
  }
  for (const query of ['after=bad-id', 'limit=0', 'limit=51', 'limit=1.5', 'status=queued']) {
    const invalid = await app.inject({ method: 'GET', url: alphaHistory + '?' + query, headers });
    assert.equal(invalid.statusCode, 400, invalid.body);
  }
  for (const deniedHeaders of [unrelated, otherHeaders]) {
    const denied = await app.inject({ method: 'GET', url: alphaHistory, headers: deniedHeaders });
    assert.equal(denied.statusCode, 404, denied.body);
  }
  const anonymous = await app.inject({ method: 'GET', url: alphaHistory });
  assert.equal(anonymous.statusCode, 401, anonymous.body);
  const defaultPage = await app.inject({ method: 'GET', url: history(zeta), headers });
  assert.equal(defaultPage.statusCode, 200, defaultPage.body);
  assert.equal(defaultPage.json<RunPage>().runs.length, 25);
  assert.equal(defaultPage.json<RunPage>().nextCursor, defaultPage.json<RunPage>().runs.at(-1)?.id);
  const maxPage = await app.inject({ method: 'GET', url: history(zeta) + '?limit=50', headers });
  assert.equal(maxPage.statusCode, 200, maxPage.body);
  assert.equal(maxPage.json<RunPage>().runs.length, 26);
  assert.equal(maxPage.json<RunPage>().nextCursor, null);
});
