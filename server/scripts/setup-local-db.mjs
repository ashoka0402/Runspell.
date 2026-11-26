import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { Client } from 'pg';
import { localClerkConfig } from '../src/local-clerk.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const appData = process.platform === 'win32' && process.env.LOCALAPPDATA
  ? process.env.LOCALAPPDATA : join(homedir(), '.local', 'share');
const state = resolve(appData, 'Runspell', 'local-postgres');
const data = join(state, 'data');
const settingsFile = join(state, 'credentials.json');
const envFile = join(root, '.env');
const host = '127.0.0.1';
const port = 55432;
const database = 'runspell_local';
const admin = 'runspell_local_admin';
const workspaceId = '00000000-0000-4000-8000-000000000001';
const accounts = [
  { user: 'runspell_api_local', role: 'runspell_runtime', env: 'RUNSPELL_DATABASE_URL' },
  { user: 'runspell_identity_local', role: 'runspell_identity_lookup', env: 'RUNSPELL_IDENTITY_DATABASE_URL' },
  { user: 'runspell_worker_local', role: 'runspell_mock_worker', env: 'RUNSPELL_MOCK_DATABASE_URL' },
];
const subprocessEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('PG')),
);
class SetupError extends Error {}

function command(file, args) {
  const result = spawnSync(file, args, { cwd: root, env: subprocessEnv, stdio: 'ignore', windowsHide: true });
  if (result.error) throw new SetupError(`Could not run ${file}. Check that it is installed and on PATH.`);
  return result.status;
}

function checked(file, args, reason) {
  if (command(file, args) !== 0) throw new SetupError(reason);
}

function settings() {
  const names = [admin, ...accounts.map(({ user }) => user)];
  if (!existsSync(settingsFile)) {
    if (existsSync(join(data, 'PG_VERSION'))) throw new SetupError('Local database credentials are missing for this cluster.');
    const generated = Object.fromEntries(names.map((name) => [name, randomBytes(32).toString('hex')]));
    writeFileSync(settingsFile, JSON.stringify(generated), { mode: 0o600, flag: 'wx' });
  }
  const saved = JSON.parse(readFileSync(settingsFile, 'utf8'));
  if (!names.every((name) => /^[0-9a-f]{64}$/.test(saved?.[name] ?? ''))) {
    throw new SetupError('Saved local database credentials are invalid.');
  }
  return saved;
}

function updateEnv(passwords, save) {
  const original = existsSync(envFile) ? readFileSync(envFile, 'utf8') : '';
  const current = parseEnv(original);
  let updated = original;
  const ending = original.includes('\r\n') ? '\r\n' : '\n';
  for (const { env, user } of accounts) {
    const value = `postgresql://${user}:${passwords[user]}@${host}:${port}/${database}`;
    if (current[env] && current[env] !== value) throw new SetupError(`Existing ${env} differs from the local database. Setup left it untouched.`);
    if (current[env] === value) continue;
    const blank = new RegExp(`^[\\t ]*(?:export[\\t ]+)?${env}[\\t ]*=[\\t ]*(?:""|'')?[\\t ]*(?:#[^\\r\\n]*)?(?=\\r?$)`, 'm');
    if (blank.test(updated)) updated = updated.replace(blank, `${env}=${value}`);
    else updated += (updated && !updated.endsWith('\n') ? ending : '') + `${env}=${value}${ending}`;
    if (parseEnv(updated)[env] !== value) throw new SetupError(`Cannot update ${env} safely.`);
  }
  if (!save || updated === original) return;
  const temporary = `${envFile}.runspell-${randomBytes(8).toString('hex')}`;
  writeFileSync(temporary, updated, { flag: 'wx', mode: 0o600 });
  try {
    const latest = existsSync(envFile) ? readFileSync(envFile, 'utf8') : '';
    if (latest !== original) throw new SetupError('.env changed during setup. Run setup again.');
    renameSync(temporary, envFile);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function startCluster(passwords) {
  if (!existsSync(join(data, 'PG_VERSION'))) {
    const passwordFile = join(state, `initdb-${randomBytes(8).toString('hex')}`);
    writeFileSync(passwordFile, passwords[admin] + '\n', { mode: 0o600, flag: 'wx' });
    try {
      checked('initdb', ['-D', data, '-U', admin, '--auth=scram-sha-256', `--pwfile=${passwordFile}`,
        '--no-locale', '--encoding=UTF8'], 'Could not initialize the isolated local PostgreSQL cluster.');
    } finally {
      unlinkSync(passwordFile);
    }
  }
  const status = command('pg_ctl', ['-D', data, 'status']);
  if (status === 0) return;
  if (status !== 3) throw new SetupError('Unexpected status for the isolated local PostgreSQL cluster.');
  checked('pg_ctl', ['-D', data, '-l', join(state, 'postgres.log'), '-w', 'start',
    '-o', `-h ${host} -p ${port} -c unix_socket_directories= -c password_encryption=scram-sha-256`],
  `Could not start the isolated PostgreSQL cluster on ${host}:${port}. Check the port and its local PostgreSQL log.`);
}

async function withAdmin(password, name, work) {
  const client = new Client({
    host, port, database: name, user: admin, password, ssl: false, connectionTimeoutMillis: 5_000,
  });
  try {
    await client.connect();
    const { rows: [info] } = await client.query('SHOW data_directory');
    if (realpathSync(info.data_directory) !== realpathSync(data)) throw new SetupError('Unexpected PostgreSQL cluster.');
    return await work(client);
  } finally {
    await client.end();
  }
}

async function provision(passwords) {
  await withAdmin(passwords[admin], 'postgres', async (client) => {
    // Keep initial generated passwords out of statements in the server log.
    await client.query("SET log_statement = 'none'; SET log_min_error_statement = 'panic'");
    for (const { user, role } of accounts) {
      const existing = await client.query('SELECT rolname FROM pg_roles WHERE rolname IN ($1, $2)', [role, user]);
      const names = new Set(existing.rows.map(({ rolname }) => rolname));
      const permissions = 'NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION';
      if (!names.has(role)) await client.query(`CREATE ROLE ${role} NOLOGIN ${permissions}`);
      if (!names.has(user)) await client.query(`CREATE ROLE ${user} LOGIN NOINHERIT ${permissions} PASSWORD '${passwords[user]}'`);
      await client.query(`GRANT ${role} TO ${user}`);
    }
    const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
    if (!existing.rowCount) await client.query(`CREATE DATABASE ${database} OWNER ${admin}`);
    await client.query(`REVOKE CONNECT, TEMP ON DATABASE ${database} FROM PUBLIC`);
    for (const { user } of accounts) await client.query(`GRANT CONNECT ON DATABASE ${database} TO ${user}`);
  });
}

async function migrate(password) {
  return withAdmin(password, database, async (client) => {
    const directory = join(root, 'server', 'migrations');
    const names = readdirSync(directory).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
    await client.query(`CREATE SCHEMA IF NOT EXISTS runspell_local_admin;
      CREATE TABLE IF NOT EXISTS runspell_local_admin.migrations (name text PRIMARY KEY, checksum text NOT NULL)`);
    const { rows } = await client.query('SELECT name, checksum FROM runspell_local_admin.migrations');
    const applied = new Map(rows.map(({ name, checksum }) => [name, checksum]));
    for (const name of applied.keys()) {
      if (!names.includes(name)) throw new SetupError('An applied local migration is missing from the workspace.');
    }
    if (names.slice(0, applied.size).some((name) => !applied.has(name))) {
      throw new SetupError('Local migrations must be applied in order.');
    }
    for (const name of names) {
      const sql = readFileSync(join(directory, name), 'utf8').replaceAll('\r\n', '\n').trim();
      const checksum = createHash('sha256').update(sql).digest('hex');
      if (applied.has(name)) {
        if (applied.get(name) !== checksum) throw new SetupError(`Applied migration changed: ${name}`);
        continue;
      }
      const transaction = /^BEGIN;\s*([\s\S]+)\s*COMMIT;$/.exec(sql);
      if (!transaction) throw new SetupError(`Expected a transactional migration: ${name}`);
      await client.query('BEGIN');
      try {
        await client.query(transaction[1]);
        await client.query('INSERT INTO runspell_local_admin.migrations VALUES ($1, $2)', [name, checksum]);
        await client.query('COMMIT');
      } catch {
        await client.query('ROLLBACK');
        throw new SetupError(`Could not apply local migration: ${name}`);
      }
    }
    return names.length;
  });
}

function clerkEnrollment() {
  const arguments_ = process.argv.slice(2);
  if (!arguments_.length) return null;
  if (arguments_.length !== 1 || arguments_[0] !== '--enroll-clerk') {
    throw new SetupError('The only optional setup argument is --enroll-clerk.');
  }
  const local = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {};
  const publishableKey = process.env.CLERK_PUBLISHABLE_KEY || local.CLERK_PUBLISHABLE_KEY;
  const subject = process.env.RUNSPELL_CLERK_SUBJECT || local.RUNSPELL_CLERK_SUBJECT;
  if (!publishableKey || !/^user_[A-Za-z0-9]{1,250}$/.test(subject ?? '')) {
    throw new SetupError('Set CLERK_PUBLISHABLE_KEY to a development key and RUNSPELL_CLERK_SUBJECT to a Clerk user ID.');
  }
  let issuer;
  try { issuer = localClerkConfig(publishableKey).frontendApi; }
  catch { throw new SetupError('CLERK_PUBLISHABLE_KEY must be a Clerk development publishable key.'); }
  return { issuer, subject };
}

async function provisionWorkspace(password, enrollment) {
  await withAdmin(password, database, async (client) => {
    await client.query('BEGIN');
    try {
      await client.query('INSERT INTO runspell.workspaces (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
        [workspaceId, 'Local Runspell']);
      if (enrollment) {
        const identity = [enrollment.issuer, enrollment.subject];
        await client.query('INSERT INTO runspell.users (identity_issuer, identity_subject) VALUES ($1, $2) ON CONFLICT DO NOTHING', identity);
        await client.query(`INSERT INTO runspell.workspace_members (user_id, workspace_id, role)
          SELECT id, $3, CASE WHEN EXISTS (SELECT 1 FROM runspell.workspace_members WHERE workspace_id = $3)
            THEN 'viewer' ELSE 'owner' END
          FROM runspell.users WHERE identity_issuer = $1 AND identity_subject = $2
          ON CONFLICT (user_id, workspace_id) DO NOTHING`, [...identity, workspaceId]);
      }
      await client.query('COMMIT');
    } catch {
      await client.query('ROLLBACK');
      throw new SetupError('Could not provision the local workspace.');
    }
  });
}

async function setup() {
  checked('git', ['check-ignore', '-q', '--', '.env'], 'Setup requires an untracked, Git-ignored .env.');
  const enrollment = clerkEnrollment();
  mkdirSync(state, { recursive: true, mode: 0o700 });
  const lockFile = join(state, 'setup.lock');
  let lock;
  try {
    lock = openSync(lockFile, 'wx', 0o600);
  } catch {
    throw new SetupError('Another local database setup may be running. If it stopped unexpectedly, check setup.lock.');
  }
  try {
    const passwords = settings();
    updateEnv(passwords, false);
    startCluster(passwords);
    await provision(passwords);
    const count = await migrate(passwords[admin]);
    await provisionWorkspace(passwords[admin], enrollment);
    updateEnv(passwords, true);
    console.log(`Local PostgreSQL is ready on ${host}:${port} with ${count} migrations. Connection settings are in the ignored .env.`);
    console.log(enrollment ? 'Clerk identity enrolled in Local Runspell.' : 'Local Runspell workspace is ready for explicit Clerk enrollment.');
  } finally {
    closeSync(lock);
    unlinkSync(lockFile);
  }
}

try {
  await setup();
} catch (error) {
  // Database and process errors can contain connection details or query text.
  console.error(error instanceof SetupError ? error.message : 'Local PostgreSQL setup failed. Check the isolated cluster log.');
  process.exitCode = 1;
}
