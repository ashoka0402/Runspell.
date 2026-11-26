import { Pool } from 'pg';
import { dispatchNextMockRun } from './mock-worker.js';

const connectionString = process.env.RUNSPELL_MOCK_DATABASE_URL;
if (!connectionString) {
  console.error('Set RUNSPELL_MOCK_DATABASE_URL for the dedicated mock worker login.');
  process.exitCode = 1;
} else {
  const pool = new Pool({ connectionString, connectionTimeoutMillis: 3000 });
  try {
    const result = await dispatchNextMockRun(pool);
    console.log(result ? `Mock run ${result.id} ${result.status}.` : 'No accepted mock runs.');
  } catch {
    console.error('Mock dispatch failed. Check the database connection, migrations, and worker role.');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
