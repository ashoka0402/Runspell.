import type { Pool } from 'pg';
import { executeMockWorkflow } from './mock-execution.js';

export async function dispatchNextMockRun(pool: Pool) {
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE runspell_mock_worker');
    const claimed = await client.query<{ id: string; definition: unknown }>(
      'SELECT id, definition FROM runspell.claim_mock_run()',
    );
    const run = claimed.rows[0];
    if (!run) {
      await client.query('COMMIT');
      return null;
    }

    let status: 'succeeded' | 'failed' = 'succeeded';
    let result: ReturnType<typeof executeMockWorkflow> | { evidence: 'simulated'; code: string };
    try {
      result = executeMockWorkflow(run.definition);
    } catch {
      status = 'failed';
      result = { evidence: 'simulated', code: 'INVALID_MOCK_WORKFLOW' };
    }

    const finished = await client.query<{ done: boolean }>(
      'SELECT runspell.finish_mock_run($1, $2, $3) AS done', [run.id, status, result],
    );
    if (!finished.rows[0]?.done) throw new Error('Mock run was not finalized');
    await client.query('COMMIT');
    return { id: run.id, status };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      discard = true;
    }
    throw error;
  } finally {
    client.release(discard);
  }
}
