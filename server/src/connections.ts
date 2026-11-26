import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PoolClient } from 'pg';
import { z } from 'zod';

type InWorkspace = <T>(
  request: FastifyRequest, workspaceId: string, write: boolean,
  work: (client: PoolClient, actor: string) => Promise<T>,
) => Promise<T>;

type ConnectionRecord = {
  id: string;
  workspaceId: string;
  label: string;
  kind: 'api' | 'browser';
  origin: string;
  status: 'pending' | 'revoked';
  createdAt: Date;
  revokedAt: Date | null;
};

const route = '/api/v1/workspaces/:wid/connections';
const uuid = z.uuid().transform((id) => id.toLowerCase());
const workspacePath = z.object({ wid: uuid });
const connectionPath = workspacePath.extend({ id: uuid });
const listQuery = z.strictObject({ after: uuid.optional() });
const newConnection = z.strictObject({
  label: z.string().trim().min(1).max(100).refine((value) => !/[\x00-\x1f\x7f]/u.test(value)),
  kind: z.enum(['browser', 'api']),
  origin: z.url().max(512).regex(/^https:\/\/[^/?#@\\\s]+\/?$/i)
    .transform((value) => new URL(value).origin).pipe(z.string().max(512)),
});
const columns = `id, workspace_id AS "workspaceId", label, kind, origin, status,
  created_at AS "createdAt", revoked_at AS "revokedAt"`;
const pageSize = 50;

export function registerConnectionRoutes(app: FastifyInstance, inWorkspace: InWorkspace, allowedOrigins: readonly string[]) {
  const origins = new Set(allowedOrigins);

  app.get(route, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const path = workspacePath.safeParse(request.params);
    if (!path.success) return reply.code(400).send({ code: 'INVALID_PATH' });
    const query = listQuery.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ code: 'INVALID_CURSOR' });
    return inWorkspace(request, path.data.wid, false, async (client) => {
      const result = await client.query<ConnectionRecord>(
        `SELECT ${columns} FROM runspell.connections
         WHERE workspace_id = $1 AND ($2::uuid IS NULL OR id > $2)
         ORDER BY id LIMIT $3`,
        [path.data.wid, query.data.after ?? null, pageSize + 1],
      );
      const connections = result.rows.slice(0, pageSize);
      return { connections, nextCursor: result.rows.length > pageSize ? connections.at(-1)!.id : null };
    });
  });

  app.post(route, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const path = workspacePath.safeParse(request.params);
    if (!path.success) return reply.code(400).send({ code: 'INVALID_PATH' });
    const body = newConnection.safeParse(request.body);
    if (!body.success) return reply.code(422).send({ code: 'INVALID_CONNECTION' });
    const { label, kind, origin } = body.data;
    const record = await inWorkspace(request, path.data.wid, true, async (client) => {
      if (!origins.has(origin)) return null;
      const result = await client.query<ConnectionRecord>(
        `INSERT INTO runspell.connections (workspace_id, label, kind, origin)
         VALUES ($1, $2, $3, $4) RETURNING ${columns}`,
        [path.data.wid, label, kind, origin],
      );
      return result.rows[0];
    });
    if (!record) return reply.code(422).send({ code: 'UNAPPROVED_ORIGIN' });
    return reply.code(201).send(record);
  });

  app.delete(`${route}/:id`, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const path = connectionPath.safeParse(request.params);
    if (!path.success) return reply.code(400).send({ code: 'INVALID_PATH' });
    const { wid, id } = path.data;
    const record = await inWorkspace(request, wid, true, async (client) => {
      const updated = await client.query<ConnectionRecord>(
        `UPDATE runspell.connections SET revoked_at = statement_timestamp()
         WHERE workspace_id = $1 AND id = $2 AND revoked_at IS NULL RETURNING ${columns}`,
        [wid, id],
      );
      if (updated.rows[0]) return updated.rows[0];
      const revoked = await client.query<ConnectionRecord>(
        `SELECT ${columns} FROM runspell.connections
         WHERE workspace_id = $1 AND id = $2 AND revoked_at IS NOT NULL`,
        [wid, id],
      );
      return revoked.rows[0];
    });
    if (!record) return reply.code(404).send({ code: 'CONNECTION_NOT_FOUND' });
    return record;
  });
}
