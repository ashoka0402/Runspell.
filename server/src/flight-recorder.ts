import { z } from 'zod';
import { actionRegistry, IdentifierSchema, type ActionType } from '../../shared/index.js';

type RecordedRun = {
  id: string;
  workflowId: string;
  mode: 'mock';
  status: 'accepted' | 'succeeded' | 'failed';
  createdAt: Date;
  finishedAt: Date | null;
  result: unknown;
};

type WorkflowVersion = { id: string; number: number; draftRevision: number };

type Event =
  | { kind: 'accepted'; at: string }
  | { kind: 'step'; nodeId: string; actionType: string; outcome: 'simulated' | 'skipped'; outputFields: string[] }
  | { kind: 'finished'; at: string; status: 'succeeded' | 'failed' };

const step = z.object({
  nodeId: IdentifierSchema,
  actionType: z.string(),
  outcome: z.enum(['simulated', 'skipped']),
  output: z.unknown().optional(),
});
const mockResult = z.object({ evidence: z.literal('simulated'), steps: z.array(step).min(1).max(50) });
const failureResult = z.object({ evidence: z.literal('simulated'), code: z.unknown().optional() });

function stepEvents(result: unknown): Event[] {
  const { steps } = mockResult.parse(result);
  return steps.map(({ nodeId, actionType, outcome, output }) => {
    if (!Object.hasOwn(actionRegistry, actionType)) throw new Error('Unknown recorded action');
    const fields = outcome === 'simulated'
      ? Object.keys(actionRegistry[actionType as ActionType].output.parse(output))
      : [];
    return { kind: 'step', nodeId, actionType, outcome, outputFields: fields };
  });
}

export function buildMockReceipt(run: RecordedRun, workflowVersion: WorkflowVersion) {
  const acceptedAt = run.createdAt.toISOString();
  const finishedAt = run.finishedAt?.toISOString() ?? null;
  const timeline: Event[] = [{ kind: 'accepted', at: acceptedAt }];
  let failureCode: 'INVALID_MOCK_WORKFLOW' | 'MOCK_RUN_FAILED' | undefined;

  if (run.status !== 'accepted') {
    if (!finishedAt) throw new Error('Finished run has no finish timestamp');
    if (run.status === 'succeeded') {
      timeline.push(...stepEvents(run.result));
    } else {
      const { code } = failureResult.parse(run.result);
      failureCode = code === 'INVALID_MOCK_WORKFLOW' ? code : 'MOCK_RUN_FAILED';
    }
    timeline.push({ kind: 'finished', at: finishedAt, status: run.status });
  }

  return {
    schemaVersion: 1,
    runId: run.id,
    workflowId: run.workflowId,
    workflowVersion,
    mode: run.mode,
    status: run.status,
    evidence: run.status === 'accepted' ? 'pending' : 'simulated',
    externalOutcome: 'not_attempted',
    acceptedAt,
    finishedAt,
    timeline,
    ...(failureCode && { failureCode }),
  };
}
