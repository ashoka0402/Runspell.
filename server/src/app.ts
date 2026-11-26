import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { CompilePolicySchema, compileWorkflow, ContractError, WorkflowSchema, type Workflow } from '../../shared/index.js';

const uuid = z.uuid().transform((id) => id.toLowerCase());
const workspacePath = z.object({ wid: uuid });
const workflowPath = workspacePath.extend({ id: uuid });
const listQuery = z.strictObject({ after: uuid.optional() });
const definitionSchema = WorkflowSchema.omit({ id: true, workspaceId: true }).extend({
  name: z.string().trim().min(1).max(100),
});
const createBody = z.strictObject({ definition: definitionSchema });
const updateBody = createBody.extend({ expectedRevision: z.int().min(0).max(2147483647) });
const route = '/api/v1/workspaces/:wid/workflows';
const pageSize = 50;
const summaryColumns = 'id, workspace_id AS "workspaceId", name, draft_revision AS revision';
const columns = `${summaryColumns}, draft_definition AS definition`;

type DraftSummary = { id: string; workspaceId: string; name: string; revision: number };
type Draft = DraftSummary & { definition: Workflow };
type Options = {
  pool: Pool;
  authenticate: (request: FastifyRequest) => Promise<string | null>;
  allowedOrigins: string[];
};

class ApiError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

function parse<T>(schema: z.ZodType<T>, input: unknown, status: number, code: string) {
  const result = schema.safeParse(input);
  if (!result.success) throw new ApiError(status, code);
  return result.data;
}

async function requireWorkspace(client: PoolClient, workspaceId: string, write: boolean) {
  const result = await client.query<{ role: string | null }>(
    'SELECT runspell.workspace_role($1) AS role', [workspaceId],
  );
  const role = result.rows[0]?.role;
  if (!role) throw new ApiError(404, 'WORKSPACE_NOT_FOUND');
  if (write && role === 'viewer') throw new ApiError(403, 'FORBIDDEN');
}

function workflowNotFound(): never {
  throw new ApiError(404, 'WORKFLOW_NOT_FOUND');
}

export function buildDraftApi({ pool, authenticate, allowedOrigins }: Options) {
  const policy = CompilePolicySchema.parse({
    workspaceId: 'server_config',
    allowedOrigins: allowedOrigins.map((value) => new URL(value).origin),
    connections: [],
  });
  const app = Fastify({ bodyLimit: 256 * 1024 });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) return reply.code(error.status).send({ code: error.code });
    const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
    const status = error instanceof Error && 'statusCode' in error ? error.statusCode : undefined;
    if (code === '42501') return reply.code(403).send({ code: 'FORBIDDEN' });
    if (['22P02', '22P05', '22021'].includes(code ?? '')) {
      return reply.code(422).send({ code: 'INVALID_DEFINITION' });
    }
    if (typeof status === 'number' && status >= 400 && status < 500) {
      return reply.code(status).send({ code: 'INVALID_REQUEST' });
    }
    request.log.error({ code, requestId: request.id }, 'Draft API request failed');
    return reply.code(500).send({ code: 'INTERNAL_ERROR' });
  });

  async function inWorkspace<T>(
    request: FastifyRequest, workspaceId: string, write: boolean, work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const actor = parse(uuid, await authenticate(request), 401, 'UNAUTHENTICATED');
    const client = await pool.connect();
    let discard = false;
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE runspell_runtime');
      await client.query("SELECT set_config('runspell.user_id', $1, true)", [actor]);
      await requireWorkspace(client, workspaceId, write);
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

  function validateDefinition(definition: z.infer<typeof definitionSchema>, workspaceId: string, id: string) {
    const workflow: Workflow = {
      ...definition,
      id: `workflow_${id.replaceAll('-', '')}`,
      workspaceId: `workspace_${workspaceId.replaceAll('-', '')}`,
    };
    if (!workflow.nodes.length && !workflow.edges.length) return workflow;
    try {
      return compileWorkflow(workflow, { ...policy, workspaceId: workflow.workspaceId }).workflow;
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof ContractError) {
        throw new ApiError(422, 'INVALID_DEFINITION');
      }
      throw error;
    }
  }

  app.get(route, async (request) => {
    const { wid } = parse(workspacePath, request.params, 400, 'INVALID_PATH');
    const { after } = parse(listQuery, request.query, 400, 'INVALID_CURSOR');
    return inWorkspace(request, wid, false, async (client) => {
      const result = await client.query<DraftSummary>(
        `SELECT ${summaryColumns} FROM runspell.workflows
         WHERE workspace_id = $1 AND ($2::uuid IS NULL OR id > $2) ORDER BY id LIMIT $3`,
        [wid, after ?? null, pageSize + 1],
      );
      const workflows = result.rows.slice(0, pageSize);
      return { workflows, nextCursor: result.rows.length > pageSize ? workflows.at(-1)!.id : null };
    });
  });

  app.post(route, async (request, reply) => {
    const { wid } = parse(workspacePath, request.params, 400, 'INVALID_PATH');
    const draft = await inWorkspace(request, wid, true, async (client) => {
      const { definition } = parse(createBody, request.body, 422, 'INVALID_DEFINITION');
      const id = randomUUID();
      const workflow = validateDefinition(definition, wid, id);
      const result = await client.query<Draft>(
        `INSERT INTO runspell.workflows (id, workspace_id, name, draft_definition)
         VALUES ($1, $2, $3, $4) RETURNING ${columns}`, [id, wid, workflow.name, workflow],
      );
      return result.rows[0];
    });
    return reply.code(201).send(draft);
  });

  app.get(`${route}/:id`, async (request) => {
    const { wid, id } = parse(workflowPath, request.params, 400, 'INVALID_PATH');
    return inWorkspace(request, wid, false, async (client) => {
      const result = await client.query<Draft>(
        `SELECT ${columns} FROM runspell.workflows WHERE workspace_id = $1 AND id = $2`, [wid, id],
      );
      return result.rows[0] ?? workflowNotFound();
    });
  });

  app.patch(`${route}/:id`, async (request) => {
    const { wid, id } = parse(workflowPath, request.params, 400, 'INVALID_PATH');
    return inWorkspace(request, wid, true, async (client) => {
      const { definition, expectedRevision } = parse(updateBody, request.body, 422, 'INVALID_DRAFT_UPDATE');
      const workflow = validateDefinition(definition, wid, id);
      const result = await client.query<Draft>(
        `UPDATE runspell.workflows
         SET name = $3, draft_definition = $4, draft_revision = draft_revision + 1
         WHERE workspace_id = $1 AND id = $2 AND draft_revision = $5 AND draft_revision < 2147483647
         RETURNING ${columns}`, [wid, id, workflow.name, workflow, expectedRevision],
      );
      if (result.rows[0]) return result.rows[0];
      await requireWorkspace(client, wid, true);
      const existing = await client.query(
        'SELECT 1 FROM runspell.workflows WHERE workspace_id = $1 AND id = $2', [wid, id],
      );
      if (!existing.rowCount) workflowNotFound();
      throw new ApiError(409, 'REVISION_CONFLICT');
    });
  });

  return app;
}
