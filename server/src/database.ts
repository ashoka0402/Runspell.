import type { Pool, PoolClient } from 'pg';

type DatabaseRole = 'runspell_runtime' | 'runspell_identity_lookup' | 'runspell_mock_worker';

export async function withDatabaseRole<T>(pool: Pool, role: DatabaseRole, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${role}`);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
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

export async function resolveOidcActor(pool: Pool, issuer: string, subject: string) {
  try {
    return await withDatabaseRole(pool, 'runspell_identity_lookup', async (client) => {
      const result = await client.query<{ id: string | null }>(
        'SELECT runspell.resolve_identity($1, $2) AS id', [issuer, subject],
      );
      return result.rows[0]?.id ?? null;
    });
  } catch (error) {
    throw new Error('Identity lookup failed', { cause: error });
  }
}
