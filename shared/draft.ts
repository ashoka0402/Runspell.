import { z } from 'zod';
import { actionRegistry, type ActionType } from './registry.js';
import { compileWorkflow, ContractError, EdgeSchema, NodeSchema, WorkflowSchema, type CompilePolicy } from './workflow.js';

export const TestModeSchema = z.enum(['validate', 'mock', 'read_only', 'controlled_write']);
export const GenerationStatusSchema = z.enum(['idle', 'planning', 'needs_clarification', 'ready', 'failed', 'cancelled']);
export const RunStatusSchema = z.enum(['accepted', 'queued', 'running', 'waiting_for_approval', 'cancel_requested', 'succeeded', 'failed', 'cancelled', 'rejected', 'expired', 'needs_attention']);
export const EvidenceOutcomeSchema = z.enum(['simulated', 'observed', 'verified', 'unknown']);
export const ApprovalStatusSchema = z.enum(['pending', 'approved', 'rejected', 'expired']);
export const TestModePolicies = {
  validate: { externalReads: false, externalWrites: false, requiresControlledAccount: false, evidence: 'No external execution' },
  mock: { externalReads: false, externalWrites: false, requiresControlledAccount: false, evidence: 'Simulated only' },
  read_only: { externalReads: true, externalWrites: false, requiresControlledAccount: true, evidence: 'Observed reads only; no business-write claim' },
  controlled_write: { externalReads: true, externalWrites: true, requiresControlledAccount: true, evidence: 'Explicit write approval and external outcome verification required' },
} as const;

const empty = z.strictObject({});
const envelope = z.strictObject({ generationId: z.uuid(), eventId: z.string().max(64), sequence: z.number().int().positive().max(1000), draftRevision: z.number().int().nonnegative() });
export const DraftEventSchema = z.discriminatedUnion('type', [
  envelope.extend({ type: z.literal('plan.started'), payload: empty }),
  envelope.extend({ type: z.literal('plan.needs_clarification'), payload: z.strictObject({ question: z.string().min(1).max(500) }) }),
  envelope.extend({ type: z.literal('draft.node_added'), payload: z.strictObject({ node: NodeSchema }) }),
  envelope.extend({ type: z.literal('draft.edge_added'), payload: z.strictObject({ edge: EdgeSchema }) }),
  envelope.extend({ type: z.literal('draft.node_configured'), payload: z.strictObject({ node: NodeSchema }) }),
  envelope.extend({ type: z.literal('draft.connection_required'), payload: z.strictObject({ nodeId: z.string().min(1), kind: z.enum(['browser', 'api']) }) }),
  envelope.extend({ type: z.literal('draft.validation_warning'), payload: z.strictObject({ message: z.string().min(1).max(500) }) }),
  envelope.extend({ type: z.literal('plan.ready'), payload: empty }),
  envelope.extend({ type: z.literal('plan.failed'), payload: z.strictObject({ message: z.string().min(1).max(500) }) }),
  envelope.extend({ type: z.literal('plan.cancelled'), payload: empty }),
]);
export type DraftEvent = z.infer<typeof DraftEventSchema>;
export const DraftSnapshotSchema = z.strictObject({
  generationId: z.uuid(), revision: z.number().int().nonnegative(), sequence: z.number().int().min(0).max(1000),
  status: GenerationStatusSchema, workflow: WorkflowSchema,
  clarification: z.strictObject({ question: z.string().min(1).max(500) }).nullable(),
  failure: z.strictObject({ message: z.string().min(1).max(500) }).nullable(),
  warnings: z.array(z.strictObject({ eventId: z.string().max(64), message: z.string().min(1).max(500) })).max(1000),
  eventDigests: z.record(z.string(), z.string()),
}).superRefine((snapshot, context) => {
  if ((snapshot.status === 'needs_clarification') !== (snapshot.clarification !== null)) context.addIssue({ code: 'custom', message: 'Clarification state must include its current question only while awaiting clarification' });
  if ((snapshot.status === 'failed') !== (snapshot.failure !== null)) context.addIssue({ code: 'custom', message: 'Failure state must include its error only while failed' });
});
export type DraftSnapshot = z.infer<typeof DraftSnapshotSchema>;

// A new generation resets its event cursor, while an existing draft keeps its accepted revision.
export function createDraftSnapshot(generationId: string, workflow: unknown, revision = 0): DraftSnapshot {
  return DraftSnapshotSchema.parse({ generationId, revision, sequence: 0, status: 'idle', workflow, clarification: null, failure: null, warnings: [], eventDigests: {} });
}

export function applyDraftPatch(input: unknown, inputPatch: unknown, policy: CompilePolicy): DraftSnapshot {
  const snapshot = DraftSnapshotSchema.parse(input);
  const patch = z.strictObject({ expectedRevision: z.number().int().nonnegative(), workflow: WorkflowSchema }).parse(inputPatch);
  if (patch.expectedRevision !== snapshot.revision) throw new ContractError('REVISION_CONFLICT', 'Reload the authoritative draft before applying this patch');
  if (patch.workflow.id !== snapshot.workflow.id || patch.workflow.workspaceId !== snapshot.workflow.workspaceId) throw new ContractError('DRAFT_IDENTITY_CHANGED', 'A patch cannot move or replace a workflow identity');
  compileWorkflow(patch.workflow, policy);
  return { ...snapshot, revision: snapshot.revision + 1, workflow: patch.workflow };
}

export function replayDraftEvents(input: unknown, inputEvents: readonly unknown[], policy: CompilePolicy): DraftSnapshot {
  let snapshot = DraftSnapshotSchema.parse(input);
  if (snapshot.workflow.workspaceId !== policy.workspaceId) throw new ContractError('WORKSPACE_MISMATCH', 'Snapshot is outside the current workspace');
  if (snapshot.status === 'ready') compileWorkflow(snapshot.workflow, policy);
  for (const inputEvent of inputEvents) {
    const event = DraftEventSchema.parse(inputEvent);
    if (event.generationId !== snapshot.generationId || event.eventId !== `${event.generationId}:${event.sequence}`) throw new ContractError('GENERATION_MISMATCH', 'Event identity does not match this generation');
    const digest = JSON.stringify(event);
    if (event.sequence <= snapshot.sequence) {
      if (snapshot.eventDigests[event.eventId] !== digest) throw new ContractError('EVENT_CONFLICT', 'Conflicting or unverifiable duplicate event; fetch an authoritative snapshot');
      continue;
    }
    if (event.sequence !== snapshot.sequence + 1) throw new ContractError('SNAPSHOT_REQUIRED', 'Event gap: resume at the last cursor or fetch an authoritative snapshot');
    const changesDraft = ['draft.node_added', 'draft.edge_added', 'draft.node_configured'].includes(event.type);
    if (event.draftRevision !== snapshot.revision + Number(changesDraft)) throw new ContractError('REVISION_CONFLICT', 'Event is based on a stale or missing draft revision');
    if (event.type === 'plan.started') {
      if (snapshot.status !== 'idle') throw new ContractError('INVALID_GENERATION_STATE', 'Generation has already started');
    } else if (!['planning', 'needs_clarification'].includes(snapshot.status)) throw new ContractError('INVALID_GENERATION_STATE', 'Generation is not accepting changes');
    const next = structuredClone(snapshot);
    switch (event.type) {
      case 'plan.started': next.status = 'planning'; next.clarification = null; next.failure = null; next.warnings = []; break;
      case 'plan.needs_clarification': next.status = 'needs_clarification'; next.clarification = event.payload; break;
      case 'draft.node_added':
      case 'draft.node_configured': {
        const node = event.payload.node;
        if (!Object.hasOwn(actionRegistry, node.actionType)) throw new ContractError('UNSUPPORTED_ACTION', node.actionType);
        actionRegistry[node.actionType as ActionType].config.parse(node.config);
        const index = next.workflow.nodes.findIndex((item) => item.id === node.id);
        if (event.type === 'draft.node_added') {
          if (index !== -1) throw new ContractError('DUPLICATE_ID', 'Node already exists');
          next.workflow.nodes.push(node);
        } else {
          if (index === -1) throw new ContractError('MISSING_NODE', 'Cannot configure a missing node');
          next.workflow.nodes[index] = node;
        }
        next.status = 'planning'; next.clarification = null; break;
      }
      case 'draft.edge_added': {
        const edge = event.payload.edge;
        if (next.workflow.edges.some((item) => item.id === edge.id)) throw new ContractError('DUPLICATE_ID', 'Edge already exists');
        if (![edge.source, edge.target].every((id) => next.workflow.nodes.some((node) => node.id === id))) throw new ContractError('INVALID_EDGE', 'Add edge endpoints first');
        next.workflow.edges.push(edge); next.status = 'planning'; next.clarification = null; break;
      }
      case 'draft.connection_required':
        if (!next.workflow.nodes.some((node) => node.id === event.payload.nodeId && Object.hasOwn(actionRegistry, node.actionType) && actionRegistry[node.actionType as ActionType].manifest.connection === event.payload.kind)) throw new ContractError('INVALID_CONNECTION_EVENT', 'Connection requirement does not match a node');
        break;
      case 'draft.validation_warning': next.warnings.push({ eventId: event.eventId, message: event.payload.message }); break;
      case 'plan.ready': compileWorkflow(next.workflow, policy); next.status = 'ready'; next.clarification = null; next.failure = null; break;
      case 'plan.failed': next.status = 'failed'; next.clarification = null; next.failure = event.payload; break;
      case 'plan.cancelled': next.status = 'cancelled'; next.clarification = null; next.failure = null; break;
    }
    next.sequence = event.sequence; next.revision = event.draftRevision; next.eventDigests[event.eventId] = digest;
    snapshot = DraftSnapshotSchema.parse(next);
  }
  return snapshot;
}

export const contractJsonSchemas = {
  workflow: z.toJSONSchema(WorkflowSchema), node: z.toJSONSchema(NodeSchema), edge: z.toJSONSchema(EdgeSchema),
  event: z.toJSONSchema(DraftEventSchema), testMode: z.toJSONSchema(TestModeSchema),
};
