import { Pool } from 'pg';
import { buildDraftApi } from './app.js';
import { resolveOidcActor } from './database.js';
import { buildOidcAuthenticator } from './oidc.js';

function setting(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Set ${name} before starting the API`);
  return value;
}

async function start() {
  const connectionString = setting('RUNSPELL_DATABASE_URL');
  const identityConnectionString = setting('RUNSPELL_IDENTITY_DATABASE_URL');
  const issuer = setting('RUNSPELL_OIDC_ISSUER');
  const audience = setting('RUNSPELL_OIDC_AUDIENCE');
  const jwksUrl = setting('RUNSPELL_OIDC_JWKS_URL');
  const allowedOrigins = (process.env.RUNSPELL_ALLOWED_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean);
  const pool = new Pool({ connectionString, connectionTimeoutMillis: 3000, max: 5 });
  const identityPool = new Pool({ connectionString: identityConnectionString, connectionTimeoutMillis: 3000, max: 3 });
  for (const connectionPool of [pool, identityPool]) {
    connectionPool.on('error', () => console.error('A Runspell database connection closed unexpectedly.'));
  }

  let app;
  try {
    const authenticate = buildOidcAuthenticator({
      issuer, audience, jwksUrl, resolveActor: (verifiedIssuer, subject) => resolveOidcActor(identityPool, verifiedIssuer, subject),
    });
    app = buildDraftApi({ pool, authenticate, allowedOrigins });
    app.addHook('onClose', async () => {
      await Promise.all([pool.end(), identityPool.end()]);
    });
    const address = await app.listen({ host: '127.0.0.1', port: 8002 });
    console.log(`Runspell API is listening at ${address}`);
  } catch {
    if (app) await app.close();
    else await Promise.all([pool.end(), identityPool.end()]);
    throw new Error('Unable to start the local API. Check its configuration and loopback port 8002.');
  }

  const close = () => {
    void app.close().catch(() => { process.exitCode = 1; });
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}

try {
  await start();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Unable to start the local API.');
  process.exitCode = 1;
}
