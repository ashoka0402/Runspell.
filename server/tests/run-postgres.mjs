import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const host = '127.0.0.1';
const admin = 'runspell_test_admin';
const root = fileURLToPath(new URL('../../', import.meta.url));
const postgresEnv = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith('PG')),
);

function run(command, args, env = postgresEnv) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status ?? result.signal}`);
}

const listener = createServer();
const port = await new Promise((resolve, reject) => {
  listener.once('error', reject);
  listener.listen(0, host, () => {
    const { port } = listener.address();
    listener.close(error => error ? reject(error) : resolve(port));
  });
});

const directory = mkdtempSync(join(tmpdir(), 'runspell-postgres-'));
const data = join(directory, 'data');
const log = join(directory, 'postgres.log');
const psql = ['-X', '-w', '-h', host, '-p', String(port), '-U', admin, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'];
let started = false;

try {
  // This cluster contains synthetic test data and listens only on loopback.
  run('initdb', ['-D', data, '-U', admin, '--auth=trust', '--no-locale', '--encoding=UTF8']);
  run('pg_ctl', ['-D', data, '-l', log, '-w', 'start', '-o', `-h ${host} -p ${port} -c unix_socket_directories=`]);
  started = true;
  run('psql', [
    ...psql,
    '-c', 'CREATE ROLE runspell_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS',
    '-c', 'CREATE ROLE runspell_test_api LOGIN NOINHERIT',
    '-c', 'GRANT runspell_runtime TO runspell_test_api',
    '-f', 'server/migrations/001_workspace_workflows.sql',
    '-f', 'server/migrations/002_workflow_ids.sql',
    '-f', 'server/migrations/003_ai_generations.sql',
    '-f', 'server/tests/workspace-isolation.sql',
  ]);
  run(process.execPath, ['--import', 'tsx', '--test', 'server/tests/workflows-api.test.ts', 'server/tests/planner-api.test.ts'], {
    ...postgresEnv, RUNSPELL_TEST_PG_PORT: String(port),
  });
} finally {
  if (started) run('pg_ctl', ['-D', data, '-w', 'stop', '-m', 'fast']);
  rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
}
