import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { CompilePolicySchema, compileWorkflow, ContractError, WorkflowSchema, type Workflow } from '../../shared/index.js';
import { geminiFromEnv, type PlannerProvider, type PlannerResult } from './gemini.js';
import { buildMockReceipt } from './flight-recorder.js';
import { withDatabaseRole } from './database.js';
import { registerConnectionRoutes } from './connections.js';
import { definitionSchema, plannerInput, plannerOutput, promptSchema, restoreUnchangedValues, revisionSchema } from './planner.js';

const uuid = z.uuid().transform((id) => id.toLowerCase());
const workspacePath = z.object({ wid: uuid });
const workflowPath = workspacePath.extend({ id: uuid });
const listQuery = z.strictObject({ after: uuid.optional() });
const createBody = z.strictObject({ definition: definitionSchema });
const updateBody = createBody.extend({ expectedRevision: revisionSchema });
const route = '/api/v1/workspaces/:wid/workflows';
const generations = '/api/v1/workspaces/:wid/ai/generations';
const generationPath = workspacePath.extend({ gid: uuid });
const promptBody = z.strictObject({ prompt: promptSchema, requestId: uuid.optional() });
const editBody = promptBody.extend({ expectedRevision: revisionSchema });
const applyBody = z.strictObject({ generationId: uuid });
const mockBody = z.strictObject({ mode: z.literal('mock') });
const activateBody = mockBody.extend({ expectedRevision: revisionSchema });
const validateBody = z.strictObject({ expectedRevision: revisionSchema, mode: z.literal('validate') });
const idempotencyKey = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/);
const runCollection = '/api/v1/workspaces/:wid/runs';
const runRoute = `${runCollection}/:runId`;
const runPath = workspacePath.extend({ runId: uuid });
const runListQuery = listQuery.extend({
  status: z.enum(['accepted', 'succeeded', 'failed']).optional(),
  limit: z.string().regex(/^(?:[1-9]|[1-4][0-9]|50)$/).transform(Number).optional(),
});
const generationWindow = "interval '2 minutes'";
const pageSize = 50;
const summaryColumns = 'id, workspace_id AS "workspaceId", name, draft_revision AS revision';
const columns = `${summaryColumns}, draft_definition AS definition`;

type DraftSummary = { id: string; workspaceId: string; name: string; revision: number };
type Draft = DraftSummary & { definition: Workflow };
type MockVersion = { id: string; versionNumber: number; draftRevision: number };
type RunSummary = {
  id: string;
  workflowId: string;
  workflowVersionId: string;
  status: 'accepted' | 'succeeded' | 'failed';
  mode: 'mock';
  createdAt: Date;
  finishedAt: Date | null;
};
type MockRun = RunSummary & { result: unknown };
const runColumns = `r.id, r.workflow_id AS "workflowId", r.workflow_version_id AS "workflowVersionId",
  r.status, r.mode, r.created_at AS "createdAt", r.finished_at AS "finishedAt"`;
type Proposal = { workflowId: string; expectedRevision: number; definition: Workflow };
type Outcome = (
  { status: 'ready'; assumptions: string[]; connectionRequirements: ReturnType<typeof compileWorkflow>['connectionRequirements'] }
    & ({ draft: Draft } | { proposal: Proposal }) |
  { status: 'clarification' | 'unsupported' | 'failed'; message: string }
) & { usage?: PlannerResult['usage'] };
type GenerationRow = { result: Outcome | null; expired: boolean; workflowId: string | null; requestedBy: string };
type Options = {
  pool: Pool;
  authenticate: (request: FastifyRequest) => Promise<string | null>;
  allowedOrigins: string[];
  planner?: PlannerProvider;
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

export function buildDraftApi({ pool, authenticate, allowedOrigins, planner = geminiFromEnv() }: Options) {
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

  async function asActor<T>(request: FastifyRequest, work: (client: PoolClient, actor: string) => Promise<T>) {
    const actor = parse(uuid, await authenticate(request), 401, 'UNAUTHENTICATED');
    return withDatabaseRole(pool, 'runspell_runtime', async (client) => {
      await client.query("SELECT set_config('runspell.user_id', $1, true)", [actor]);
      return work(client, actor);
    });
  }

  function inWorkspace<T>(
    request: FastifyRequest, workspaceId: string, write: boolean, work: (client: PoolClient, actor: string) => Promise<T>,
  ) {
    return asActor(request, async (client, actor) => {
      await requireWorkspace(client, workspaceId, write);
      return work(client, actor);
    });
  }

  function validateDefinition(definition: z.infer<typeof definitionSchema>, workspaceId: string, id: string) {
    const workflow: Workflow = {
      ...definition,
      id: `workflow_${id.replaceAll('-', '')}`,
      workspaceId: `workspace_${workspaceId.replaceAll('-', '')}`,
    };
    if (!workflow.nodes.length && !workflow.edges.length) return { workflow, connectionRequirements: [] };
    try {
      return compileWorkflow(workflow, { ...policy, workspaceId: workflow.workspaceId });
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof ContractError) {
        throw new ApiError(422, 'INVALID_DEFINITION');
      }
      throw error;
    }
  }

  async function readDraft(client: PoolClient, workspaceId: string, id: string) {
    const result = await client.query<Draft>(
      `SELECT ${columns} FROM runspell.workflows WHERE workspace_id = $1 AND id = $2`, [workspaceId, id],
    );
    return result.rows[0] ?? workflowNotFound();
  }

  function compileStoredDraft(draft: Draft) {
    const { id: storedId, workspaceId: storedWorkspace, ...definition } =
      parse(WorkflowSchema, draft.definition, 422, 'INVALID_DEFINITION');
    const compiled = validateDefinition(definition, draft.workspaceId, draft.id);
    const { workflow } = compiled;
    if (!workflow.nodes.length || storedId !== workflow.id || storedWorkspace !== workflow.workspaceId) {
      throw new ApiError(422, 'INVALID_DEFINITION');
    }
    return compiled;
  }

  async function insertDraft(client: PoolClient, workspaceId: string, id: string, workflow: Workflow) {
    const result = await client.query<Draft>(
      `INSERT INTO runspell.workflows (id, workspace_id, name, draft_definition)
       VALUES ($1, $2, $3, $4) RETURNING ${columns}`, [id, workspaceId, workflow.name, workflow],
    );
    return result.rows[0];
  }

  async function replaceDraft(client: PoolClient, workspaceId: string, id: string, workflow: Workflow, revision: number) {
    const result = await client.query<Draft>(
      `UPDATE runspell.workflows
       SET name = $3, draft_definition = $4, draft_revision = draft_revision + 1
       WHERE workspace_id = $1 AND id = $2 AND draft_revision = $5 AND draft_revision < 2147483647
       RETURNING ${columns}`, [workspaceId, id, workflow.name, workflow, revision],
    );
    if (result.rows[0]) return result.rows[0];
    await requireWorkspace(client, workspaceId, true);
    await readDraft(client, workspaceId, id);
    throw new ApiError(409, 'REVISION_CONFLICT');
  }

  async function readRun(client: PoolClient, workspaceId: string, id: string) {
    const result = await client.query<MockRun>(
      `SELECT ${runColumns}, r.result FROM runspell.runs AS r
       WHERE r.workspace_id = $1 AND r.id = $2`, [workspaceId, id],
    );
    if (!result.rows[0]) throw new ApiError(404, 'RUN_NOT_FOUND');
    return result.rows[0];
  }

  app.get('/api/v1/me', (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    return asActor(request, async (client, actor) => {
      const result = await client.query<{ id: string; name: string; role: string }>(
        `SELECT w.id, w.name, m.role FROM runspell.workspace_members AS m
         JOIN runspell.workspaces AS w ON w.id = m.workspace_id
         WHERE m.user_id = $1 ORDER BY w.name, w.id`, [actor],
      );
      return { id: actor, workspaces: result.rows };
    });
  });

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
      return insertDraft(client, wid, id, validateDefinition(definition, wid, id).workflow);
    });
    return reply.code(201).send(draft);
  });

  app.get(`${route}/:id`, async (request) => {
    const { wid, id } = parse(workflowPath, request.params, 400, 'INVALID_PATH');
    return inWorkspace(request, wid, false, (client) => readDraft(client, wid, id));
  });

  app.patch(`${route}/:id`, async (request) => {
    const { wid, id } = parse(workflowPath, request.params, 400, 'INVALID_PATH');
    return inWorkspace(request, wid, true, async (client) => {
      const { definition, expectedRevision } = parse(updateBody, request.body, 422, 'INVALID_DRAFT_UPDATE');
      const { workflow } = validateDefinition(definition, wid, id);
      return replaceDraft(client, wid, id, workflow, expectedRevision);
    });
  });

  app.post(`${route}/:id/activate`, async (request) => {
    const { wid, id } = parse(workflowPath, request.params, 400, 'INVALID_PATH');
    return inWorkspace(request, wid, true, async (client) => {
      const { expectedRevision } = parse(activateBody, request.body, 422, 'INVALID_ACTIVATION');
      const draft = await readDraft(client, wid, id);
      if (expectedRevision !== draft.revision) throw new ApiError(409, 'REVISION_CONFLICT');
      compileStoredDraft(draft);
      const result = await client.query<MockVersion>(
        `SELECT id, version_number AS "versionNumber", draft_revision AS "draftRevision"
         FROM runspell.activate_mock_workflow($1, $2, $3, $4)`, [wid, id, expectedRevision, draft.definition],
      );
      if (!result.rows[0]) throw new ApiError(409, 'REVISION_CONFLICT');
      return { ...result.rows[0], mode: 'mock' };
    });
  });

  app.post(`${route}/:id/validate`, async (request, reply) => {
    const { wid, id } = parse(workflowPath, request.params, 400, 'INVALID_PATH');
    reply.header('Cache-Control', 'private, no-store');
    return inWorkspace(request, wid, false, async (client) => {
      const { expectedRevision } = parse(validateBody, request.body, 422, 'INVALID_TEST_MODE');
      const draft = await readDraft(client, wid, id);
      if (expectedRevision !== draft.revision) throw new ApiError(409, 'REVISION_CONFLICT');
      const { connectionRequirements } = compileStoredDraft(draft);
      return { mode: 'validate', status: 'validated', revision: draft.revision, evidence: 'validation_only',
        externalOutcome: 'not_attempted', connectionRequirements };
    });
  });

  app.post(`${route}/:id/runs`, async (request, reply) => {
    const { wid, id } = parse(workflowPath, request.params, 400, 'INVALID_PATH');
    const run = await inWorkspace(request, wid, true, async (client) => {
      parse(mockBody, request.body, 422, 'INVALID_RUN_MODE');
      const key = parse(idempotencyKey, request.headers['idempotency-key'], 400, 'INVALID_IDEMPOTENCY_KEY');
      await readDraft(client, wid, id);
      const result = await client.query<{ id: string }>(
        'SELECT id FROM runspell.admit_mock_run($1, $2, $3)', [wid, id, key],
      );
      if (!result.rows[0]) throw new ApiError(409, 'MOCK_RUN_UNAVAILABLE');
      return readRun(client, wid, result.rows[0].id);
    });
    return reply.code(run.status === 'accepted' ? 202 : 200).send(run);
  });

  app.get(runCollection, async (request, reply) => {
    const { wid } = parse(workspacePath, request.params, 400, 'INVALID_PATH');
    const { after, status, limit = 25 } = parse(runListQuery, request.query, 400, 'INVALID_RUN_FILTER');
    reply.header('Cache-Control', 'private, no-store');
    return inWorkspace(request, wid, false, async (client) => {
      const result = await client.query<RunSummary>(
        `SELECT ${runColumns} FROM runspell.runs AS r
         WHERE r.workspace_id = $1 AND ($3::text IS NULL OR r.status = $3)
           AND ($2::uuid IS NULL OR EXISTS (
             SELECT 1 FROM runspell.runs AS anchor
             WHERE anchor.workspace_id = $1 AND anchor.id = $2
               AND (r.created_at < anchor.created_at OR (r.created_at = anchor.created_at AND r.id > anchor.id))
           ))
         ORDER BY r.created_at DESC, r.id LIMIT $4`,
        [wid, after ?? null, status ?? null, limit + 1],
      );
      const runs = result.rows.slice(0, limit);
      return { runs, nextCursor: result.rows.length > limit ? runs[runs.length - 1].id : null };
    });
  });

  app.get(runRoute, async (request, reply) => {
    const { wid, runId } = parse(runPath, request.params, 400, 'INVALID_PATH');
    reply.header('Cache-Control', 'private, no-store');
    return inWorkspace(request, wid, false, (client) => readRun(client, wid, runId));
  });

  async function recordedRun(client: PoolClient, wid: string, runId: string) {
    const run = await readRun(client, wid, runId);
    const result = await client.query<{ id: string; number: number; draftRevision: number | null }>(
      `SELECT id, version_number AS number, draft_revision AS "draftRevision"
       FROM runspell.workflow_versions WHERE workspace_id = $1 AND workflow_id = $2 AND id = $3`,
      [wid, run.workflowId, run.workflowVersionId],
    );
    const version = result.rows[0];
    if (!version || version.draftRevision === null) throw new Error('Run does not have a recorded workflow version');
    return buildMockReceipt(run, { ...version, draftRevision: version.draftRevision });
  }

  app.get(`${runRoute}/evidence`, async (request, reply) => {
    const { wid, runId } = parse(runPath, request.params, 400, 'INVALID_PATH');
    reply.header('Cache-Control', 'private, no-store');
    return inWorkspace(request, wid, false, (client) => recordedRun(client, wid, runId));
  });

  app.get(`${runRoute}/receipt`, async (request, reply) => {
    const { wid, runId } = parse(runPath, request.params, 400, 'INVALID_PATH');
    reply.header('Cache-Control', 'private, no-store');
    const receipt = await inWorkspace(request, wid, false, (client) => recordedRun(client, wid, runId));
    return reply.header('Content-Disposition', `attachment; filename="runspell-receipt-${runId}.json"`).send(receipt);
  });

  const expiredOutcome = { status: 'failed', message: 'Generation expired before it finished.' } as const;

  async function findGeneration(client: PoolClient, workspaceId: string, id: string) {
    const result = await client.query<GenerationRow>(
      `SELECT result, requested_by AS "requestedBy", workflow_id AS "workflowId",
        created_at <= now() - ${generationWindow} AS expired
       FROM runspell.ai_generations WHERE workspace_id = $1 AND id = $2`, [workspaceId, id],
    );
    return result.rows[0];
  }

  async function readGeneration(client: PoolClient, workspaceId: string, id: string) {
    const generation = await findGeneration(client, workspaceId, id);
    if (!generation) throw new ApiError(404, 'GENERATION_NOT_FOUND');
    return generation;
  }

  function generationState({ result, expired }: GenerationRow) {
    return result ?? (expired ? expiredOutcome : { status: 'running' as const });
  }

  async function generate(request: FastifyRequest, wid: string, workflowId?: string) {
    const reservation = await inWorkspace(request, wid, true, async (client, actor) => {
      const body = workflowId
        ? parse(editBody, request.body, 422, 'INVALID_PROMPT')
        : parse(promptBody, request.body, 422, 'INVALID_PROMPT');

      // Serialize reservations and retries across API instances. Provider work happens after commit.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [wid]);
      const id = body.requestId ?? randomUUID();
      const existing = body.requestId ? await findGeneration(client, wid, id) : undefined;
      if (existing) {
        if (existing.requestedBy !== actor || existing.workflowId !== (workflowId ?? null)) {
          throw new ApiError(409, 'GENERATION_ID_CONFLICT');
        }
        return { kind: 'replay' as const, id, state: generationState(existing) };
      }

      if (!planner) throw new ApiError(503, 'PLANNER_DISABLED');
      const current = workflowId ? await readDraft(client, wid, workflowId) : undefined;
      if (current && 'expectedRevision' in body && current.revision !== body.expectedRevision) {
        throw new ApiError(409, 'REVISION_CONFLICT');
      }
      const quota = await client.query<{ blocked: boolean }>(
        `SELECT count(*) >= 10 OR coalesce(bool_or(result IS NULL AND created_at > now() - ${generationWindow}), false) AS blocked
         FROM runspell.ai_generations WHERE workspace_id = $1 AND created_at > now() - interval '24 hours'`, [wid],
      );
      if (quota.rows[0].blocked) throw new ApiError(429, 'PLANNER_QUOTA_EXCEEDED');
      await client.query(
        'INSERT INTO runspell.ai_generations (id, workspace_id, requested_by, workflow_id) VALUES ($1, $2, $3, $4)',
        [id, wid, actor, workflowId ?? null],
      );
      return { kind: 'new' as const, id, prompt: body.prompt, current };
    });
    if (reservation.kind === 'replay') {
      return { statusCode: reservation.state.status === 'running' ? 202 : 200, body: { id: reservation.id, ...reservation.state } };
    }
    const { id, prompt, current } = reservation;

    let answer: z.infer<typeof plannerOutput> | undefined;
    let usage: PlannerResult['usage'];
    try {
      const response = await planner!(plannerInput(prompt, policy.allowedOrigins, current?.definition));
      usage = response.usage;
      const parsed = plannerOutput.safeParse(response.output);
      if (parsed.success) answer = parsed.data;
    } catch {
      // Store a sanitized outcome without retaining prompt text or provider errors.
    }
    const draftId = current?.id ?? randomUUID();
    let candidate: ReturnType<typeof validateDefinition> | undefined;
    if (answer?.status === 'candidate') {
      const definition = current ? restoreUnchangedValues(answer.definition, current.definition) : answer.definition;
      try {
        candidate = validateDefinition(definition, wid, draftId);
        if (!candidate.workflow.nodes.length) candidate = undefined;
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
      }
    }

    const body = await inWorkspace(request, wid, true, async (client) => {
      let outcome: Outcome;
      if (answer?.status === 'candidate' && candidate) {
        const { workflow, connectionRequirements } = candidate;
        const details = { status: 'ready' as const, assumptions: answer.assumptions, connectionRequirements, usage };
        outcome = current
          ? { ...details, proposal: { workflowId: current.id, expectedRevision: current.revision, definition: workflow } }
          : { ...details, draft: await insertDraft(client, wid, draftId, workflow) };
      } else if (answer && answer.status !== 'candidate') {
        outcome = { ...answer, usage };
      } else {
        outcome = { status: 'failed', message: 'The planner did not produce a usable result.', usage };
      }
      const updated = await client.query(
        `UPDATE runspell.ai_generations SET result = $3 WHERE workspace_id = $1 AND id = $2
         AND result IS NULL AND created_at > now() - ${generationWindow}`, [wid, id, outcome],
      );
      if (!updated.rowCount) throw new ApiError(409, 'GENERATION_EXPIRED');
      return { id, ...outcome };
    });
    return { statusCode: 201, body };
  }

  app.post(generations, async (request, reply) => {
    const { wid } = parse(workspacePath, request.params, 400, 'INVALID_PATH');
    const result = await generate(request, wid);
    return reply.header('Cache-Control', 'private, no-store').code(result.statusCode).send(result.body);
  });
  app.post(`${route}/:id/draft/ai-edit`, async (request, reply) => {
    const { wid, id } = parse(workflowPath, request.params, 400, 'INVALID_PATH');
    const result = await generate(request, wid, id);
    return reply.header('Cache-Control', 'private, no-store').code(result.statusCode).send(result.body);
  });
  app.get(`${generations}/:gid`, async (request, reply) => {
    const { wid, gid } = parse(generationPath, request.params, 400, 'INVALID_PATH');
    reply.header('Cache-Control', 'private, no-store');
    return inWorkspace(request, wid, false, async (client) => ({
      id: gid, ...generationState(await readGeneration(client, wid, gid)),
    }));
  });
  app.get(`${generations}/:gid/events`, async (request, reply) => {
    const { wid, gid } = parse(generationPath, request.params, 400, 'INVALID_PATH');
    const cursor = parse(z.enum(['0', '1', '2']), request.headers['last-event-id'] ?? '0', 400, 'INVALID_CURSOR');
    const { result, expired } = await inWorkspace(request, wid, false, (client) => readGeneration(client, wid, gid));
    const terminal = result ?? (expired ? expiredOutcome : null);
    const events = [{ id: 1, state: { status: 'running' } }, ...(terminal ? [{ id: 2, state: terminal }] : [])];
    const stream = events.filter(({ id }) => id > Number(cursor)).map(({ id, state }) =>
      `id: ${id}\nevent: generation.${state.status}\ndata: ${JSON.stringify({ id: gid, ...state })}\n\n`,
    ).join('');
    return reply.header('Cache-Control', 'private, no-store').type('text/event-stream').send(stream);
  });
  app.post(`${route}/:id/draft/apply-patch`, async (request) => {
    const { wid, id } = parse(workflowPath, request.params, 400, 'INVALID_PATH');
    return inWorkspace(request, wid, true, async (client) => {
      const { generationId } = parse(applyBody, request.body, 422, 'INVALID_PROPOSAL');
      const { result, workflowId } = await readGeneration(client, wid, generationId);
      if (workflowId !== id || result?.status !== 'ready' || !('proposal' in result)) {
        throw new ApiError(404, 'PROPOSAL_NOT_FOUND');
      }
      const { expectedRevision, definition: { id: _id, workspaceId: _workspace, ...definition } } = result.proposal;
      return replaceDraft(client, wid, id, validateDefinition(definition, wid, id).workflow, expectedRevision);
    });
  });

  registerConnectionRoutes(app, inWorkspace, policy.allowedOrigins);
  return app;
}
