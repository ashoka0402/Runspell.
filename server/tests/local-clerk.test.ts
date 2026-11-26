import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { exposeLocalClerk, localClerkConfig } from '../src/local-clerk.js';

const encoded = Buffer.from('fixture.clerk.accounts.dev$', 'utf8').toString('base64');
const publishableKey = `pk_test_${encoded}`;

test('local Clerk bootstrap accepts only development instance publishable keys', () => {
  assert.deepEqual(localClerkConfig(publishableKey), {
    provider: 'clerk', publishableKey, frontendApi: 'https://fixture.clerk.accounts.dev',
  });
  assert.throws(() => localClerkConfig(`pk_live_${encoded}`));
  const untrusted = Buffer.from('outside.example$', 'utf8').toString('base64');
  assert.throws(() => localClerkConfig(`pk_test_${untrusted}`));
});

test('local Clerk CORS exposes only read routes to the preview origins', async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  exposeLocalClerk(app, localClerkConfig(publishableKey));
  const origin = 'http://localhost:8000';
  const config = await app.inject({ url: '/api/v1/auth/config', headers: { origin } });
  assert.equal(config.headers['access-control-allow-origin'], origin);
  assert.deepEqual(config.json(), localClerkConfig(publishableKey));

  const runs = '/api/v1/workspaces/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/runs';
  const preflight = await app.inject({
    method: 'OPTIONS', url: runs, headers: { origin, 'access-control-request-method': 'GET' },
  });
  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.headers['access-control-allow-origin'], origin);
  assert.equal(preflight.headers['access-control-allow-headers'], 'Authorization');
  assert.equal(preflight.headers['access-control-allow-credentials'], undefined);

  const outsiders = await app.inject({
    method: 'OPTIONS', url: runs, headers: { origin: 'https://outside.example', 'access-control-request-method': 'GET' },
  });
  assert.equal(outsiders.headers['access-control-allow-origin'], undefined);
  const write = await app.inject({
    method: 'OPTIONS', url: runs, headers: { origin, 'access-control-request-method': 'POST' },
  });
  assert.equal(write.statusCode, 404);
  assert.equal(write.headers['access-control-allow-methods'], undefined);
});
