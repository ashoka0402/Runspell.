import { z } from 'zod';
import {
  actionRegistry, compileWorkflow, ContractError, createDraftSnapshot, DraftEventSchema,
  DraftSnapshotSchema, NodeSchema, replayDraftEvents, WorkflowSchema,
  type ActionType, type DraftEvent, type DraftSnapshot, type Workflow,
} from '../shared/index.js';
import { invoicePolicy, invoiceWorkflow } from '../fixtures/m0/invoice.js';

export const STUDIO_STORAGE_KEY = 'relay.studio.v1';
export const EXAMPLE_PROMPT = 'Collect one invoice, check its amount, request approval above 50000, download it and notify my team.';
export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const PositionSchema = z.strictObject({ x: z.number().finite().min(-10000).max(10000), y: z.number().finite().min(-10000).max(10000) });
export const StudioDocumentSchema = z.strictObject({
  version: z.literal(1), storageRevision: z.number().int().nonnegative(),
  prompt: z.string().max(2000), assumptions: z.array(z.string().max(500)).max(12),
  snapshot: DraftSnapshotSchema, pendingEvents: z.array(DraftEventSchema).max(1000),
  targetWorkflow: WorkflowSchema.nullable(), positions: z.record(z.string(), PositionSchema),
});
export type StudioDocument = z.infer<typeof StudioDocumentSchema>;
export type Proposal = { generationId: string; expectedRevision: number; before: string; after: string; description: string; workflow: Workflow };
export type LegacyDraftChoice = { id: string; name: string; compatible: boolean; reason: string; draft: unknown };

const fail = (code: string, message: string): never => { throw new ContractError(code, message); };
const clone = <T>(value: T): T => structuredClone(value);
const id = () => globalThis.crypto.randomUUID();

function validatePartial(workflow: Workflow) {
  WorkflowSchema.parse(workflow);
  if (workflow.workspaceId !== invoicePolicy.workspaceId) fail('WORKSPACE_MISMATCH', 'This offline studio only accepts the fixture workspace.');
  if (new Set(workflow.nodes.map(node => node.id)).size !== workflow.nodes.length) fail('DUPLICATE_ID', 'Duplicate node ID.');
  for (const node of workflow.nodes) {
    if (!Object.hasOwn(actionRegistry, node.actionType)) fail('UNSUPPORTED_ACTION', `Unsupported fixture action: ${node.actionType}`);
    actionRegistry[node.actionType as ActionType].config.parse(node.config);
    if ('url' in node.config && !invoicePolicy.allowedOrigins.includes(new URL(node.config.url as string).origin)) fail('DESTINATION_NOT_ALLOWED', 'The destination is outside the offline fixture policy.');
  }
}

function validateDocument(input: unknown): StudioDocument {
  const document = StudioDocumentSchema.parse(input);
  validatePartial(document.snapshot.workflow);
  if (document.snapshot.status === 'ready') compileWorkflow(document.snapshot.workflow, invoicePolicy);
  if (document.targetWorkflow) {
    compileWorkflow(document.targetWorkflow, invoicePolicy);
    if (document.targetWorkflow.id !== document.snapshot.workflow.id) fail('DRAFT_IDENTITY_CHANGED', 'Stored target does not belong to this draft.');
    for (const node of document.snapshot.workflow.nodes) {
      if (!document.targetWorkflow.nodes.some(item => item.id === node.id && JSON.stringify(item) === JSON.stringify(node))) fail('SNAPSHOT_REQUIRED', 'Accepted nodes differ from the stored candidate; recover the saved draft before continuing.');
    }
    for (const edge of document.snapshot.workflow.edges) {
      if (!document.targetWorkflow.edges.some(item => item.id === edge.id && JSON.stringify(item) === JSON.stringify(edge))) fail('SNAPSHOT_REQUIRED', 'Accepted edges differ from the stored candidate.');
    }
  }
  let nextSequence = document.snapshot.sequence + 1;
  for (const event of document.pendingEvents) {
    if (event.generationId !== document.snapshot.generationId || event.sequence !== nextSequence++ || event.eventId !== `${event.generationId}:${event.sequence}`) fail('SNAPSHOT_REQUIRED', 'Stored events are incomplete or conflicting; recover from the accepted snapshot.');
  }
  return document;
}

export function createStudioDocument(): StudioDocument {
  const workflow = { ...clone(invoiceWorkflow), name: 'Untitled studio draft', nodes: [], edges: [] };
  return { version: 1, storageRevision: 0, prompt: '', assumptions: [], snapshot: createDraftSnapshot(id(), workflow), pendingEvents: [], targetWorkflow: null, positions: {} };
}

function streamFor(snapshot: DraftSnapshot, target: Workflow): DraftEvent[] {
  const events: DraftEvent[] = [];
  let revision = snapshot.revision;
  function add(type: DraftEvent['type'], payload: unknown) {
    const sequence = events.length + 1;
    if (['draft.node_added', 'draft.edge_added', 'draft.node_configured'].includes(type)) revision++;
    events.push(DraftEventSchema.parse({ generationId: snapshot.generationId, eventId: `${snapshot.generationId}:${sequence}`, sequence, draftRevision: revision, type, payload }));
  }
  add('plan.started', {});
  for (const node of target.nodes) if (!snapshot.workflow.nodes.some(existing => existing.id === node.id)) add('draft.node_added', { node });
  for (const edge of target.edges) if (!snapshot.workflow.edges.some(existing => existing.id === edge.id)) add('draft.edge_added', { edge });
  for (const requirement of compileWorkflow(target, invoicePolicy).connectionRequirements) add('draft.connection_required', { nodeId: requirement.nodeId, kind: requirement.kind });
  add('plan.ready', {});
  return events;
}

function clarification(document: StudioDocument, prompt: string, question: string): StudioDocument {
  const snapshot = createDraftSnapshot(id(), document.snapshot.workflow, document.snapshot.revision);
  const events = [
    { generationId: snapshot.generationId, eventId: `${snapshot.generationId}:1`, sequence: 1, draftRevision: snapshot.revision, type: 'plan.started', payload: {} },
    { generationId: snapshot.generationId, eventId: `${snapshot.generationId}:2`, sequence: 2, draftRevision: snapshot.revision, type: 'plan.needs_clarification', payload: { question } },
  ];
  return { ...document, prompt, snapshot: replayDraftEvents(snapshot, events, invoicePolicy), pendingEvents: [], targetWorkflow: null };
}

export function startGeneration(input: StudioDocument, rawPrompt: string): StudioDocument {
  const document = validateDocument(input);
  const prompt = z.string().trim().min(1, 'Describe a workflow first.').max(2000).parse(rawPrompt);
  if (!/\binvoices?\b/i.test(prompt)) return clarification(document, prompt, 'This offline planner supports the one-invoice fixture only. Try the example prompt; real AI authoring arrives in M3.');
  if (/\b(gmail|outlook|slack|sheets|spreadsheet|refund|payment|delete|scrape|all|each|batch|multiple|daily|weekly|monday|schedule|webhook)\b|every\s+(morning|day|week)|send\s+(an?\s+)?email/i.test(prompt)) {
    return clarification(document, prompt, 'That request includes a capability or trigger configuration outside this offline fixture. Use one invoice with a manual start, browser download, optional amount approval, and generic result delivery.');
  }
  // shortcut: a small prompt vocabulary selects one fixture, replace with validated model planning in M3.
  const supportedWords = new Set('please collect download one a an invoice invoices check its amount request approval above over exceeds threshold to it and notify my team before sending the result from vendor portal then if needed workflow generate build create'.split(' '));
  const words = prompt.toLowerCase().replace(/[\d,.$₹]/g, ' ').match(/[a-z]+/g) ?? [];
  if (words.some(word => !supportedWords.has(word))) return clarification(document, prompt, 'The offline fixture cannot interpret part of that request. Use the example prompt or edit the supported node parameters directly; unsupported actions are not silently added.');
  const target = clone(invoiceWorkflow);
  target.id = document.snapshot.workflow.id;
  const threshold = prompt.match(/(?:above|over|exceeds?|threshold(?:\s+to)?)\s*(?:₹|\$)?\s*([\d,]+(?:\.\d+)?)/i);
  if (threshold) {
    const amount = Number(threshold[1]!.replaceAll(',', ''));
    if (!Number.isFinite(amount) || amount < 0 || amount > 1e12) fail('INVALID_THRESHOLD', 'Use an amount between 0 and 1,000,000,000,000.');
    target.nodes.find(node => node.id === 'check_amount')!.config.threshold = amount;
    target.nodes.find(node => node.id === 'check_amount')!.label = `Amount exceeds ${amount.toLocaleString('en-US')}?`;
  }
  compileWorkflow(target, invoicePolicy);
  const snapshot = createDraftSnapshot(id(), { ...target, nodes: [], edges: [] }, document.snapshot.revision + 1);
  return {
    ...document, prompt, snapshot, targetWorkflow: target, pendingEvents: streamFor(snapshot, target), positions: {},
    assumptions: [
      'A fixed one-invoice template is selected locally; no AI model has interpreted this prompt.',
      'The portal and delivery API use placeholder .example URLs and require real connections later.',
      'The fixture uses a manual trigger. No schedule, endpoint, account, or external action is configured.',
      'Other wording does not create additional actions. Review every node and its parameters.',
    ],
  };
}

export function receiveDraftEvent(input: StudioDocument, event: unknown): StudioDocument {
  const document = validateDocument(input);
  const snapshot = replayDraftEvents(document.snapshot, [event], invoicePolicy);
  return { ...document, snapshot, pendingEvents: document.pendingEvents.filter(item => item.sequence > snapshot.sequence) };
}

export function advanceGeneration(input: StudioDocument): StudioDocument {
  const document = validateDocument(input);
  if (!document.pendingEvents.length) return document;
  if (!['idle', 'planning'].includes(document.snapshot.status)) fail('GENERATION_STOPPED', 'Resume the interrupted generation explicitly before advancing.');
  return receiveDraftEvent(document, document.pendingEvents[0]);
}

export function cancelGeneration(input: StudioDocument): StudioDocument {
  let document = validateDocument(input);
  if (!document.pendingEvents.length || !['idle', 'planning'].includes(document.snapshot.status)) return document;
  if (document.snapshot.status === 'idle') document = advanceGeneration(document);
  const sequence = document.snapshot.sequence + 1;
  const event = { generationId: document.snapshot.generationId, eventId: `${document.snapshot.generationId}:${sequence}`, sequence, draftRevision: document.snapshot.revision, type: 'plan.cancelled', payload: {} };
  return { ...document, snapshot: replayDraftEvents(document.snapshot, [event], invoicePolicy), pendingEvents: [] };
}

export function resumeGeneration(input: StudioDocument): StudioDocument {
  const document = validateDocument(input);
  if (!document.targetWorkflow || document.snapshot.status === 'ready') return document;
  const snapshot = createDraftSnapshot(id(), document.snapshot.workflow, document.snapshot.revision);
  return { ...document, snapshot, pendingEvents: streamFor(snapshot, document.targetWorkflow) };
}

export const reconnectGeneration = resumeGeneration;

export function editNode(input: StudioDocument, nodeId: string, edit: { label: string; config: Record<string, unknown> }, expectedRevision: number): StudioDocument {
  let document = validateDocument(input);
  if (expectedRevision !== document.snapshot.revision) fail('REVISION_CONFLICT', 'The draft changed. Reload it before saving this edit.');
  const index = document.snapshot.workflow.nodes.findIndex(node => node.id === nodeId);
  if (index < 0) fail('MISSING_NODE', 'Choose an existing node.');
  if (document.pendingEvents.length) document = cancelGeneration(document);
  const workflow = clone(document.snapshot.workflow);
  const node = NodeSchema.parse({ ...workflow.nodes[index], label: edit.label, config: edit.config });
  actionRegistry[node.actionType as ActionType].config.parse(node.config);
  workflow.nodes[index] = node;
  validatePartial(workflow);
  if (document.snapshot.status === 'ready') compileWorkflow(workflow, invoicePolicy);
  const targetWorkflow = document.targetWorkflow ? clone(document.targetWorkflow) : null;
  if (targetWorkflow) {
    targetWorkflow.nodes[targetWorkflow.nodes.findIndex(item => item.id === nodeId)] = node;
    compileWorkflow(targetWorkflow, invoicePolicy);
  }
  return { ...document, snapshot: { ...document.snapshot, workflow, revision: document.snapshot.revision + 1 }, targetWorkflow };
}

export function proposeEdit(input: StudioDocument, rawPrompt: string): Proposal {
  const document = validateDocument(input);
  if (document.snapshot.status !== 'ready') fail('INCOMPLETE_DRAFT', 'Finish or resume the fixture before requesting a complete-plan suggestion. Partial nodes remain manually editable.');
  const prompt = z.string().trim().min(1).max(1000).parse(rawPrompt);
  const workflow = clone(document.snapshot.workflow);
  let before: string, after: string, description: string;
  const threshold = prompt.match(/^(?:change|set)(?: the)? threshold to ([\d,]+(?:\.\d+)?)$/i);
  const rename = prompt.match(/^rename workflow to (.+)$/i);
  const nodeRename = prompt.match(/^rename (?:node|step) ([a-z][a-z0-9_]*) to (.+)$/i);
  const trigger = prompt.match(/^(?:switch|change)(?: the)? trigger to (manual|schedule|webhook)$/i);
  if (threshold) {
    const node = workflow.nodes.find(item => item.actionType === 'condition.compare');
    if (!node) fail('UNSUPPORTED_EDIT', 'This draft has no supported threshold condition.');
    const amount = Number(threshold[1]!.replaceAll(',', ''));
    if (!Number.isFinite(amount) || amount < 0 || amount > 1e12) fail('INVALID_THRESHOLD', 'Use a valid nonnegative threshold within the fixture limit.');
    before = `Threshold: ${node!.config.threshold}`; after = `Threshold: ${amount}`; description = 'Change the amount approval threshold.';
    node!.config.threshold = amount; node!.label = `Amount exceeds ${amount.toLocaleString('en-US')}?`;
  } else if (rename) {
    before = workflow.name; after = rename[1]!.trim(); description = 'Rename the workflow.'; workflow.name = after;
  } else if (nodeRename) {
    const node = workflow.nodes.find(item => item.id === nodeRename[1]);
    if (!node) fail('MISSING_NODE', 'That node is not in this draft.');
    before = node!.label; after = nodeRename[2]!.trim(); description = `Rename ${node!.id}.`; node!.label = after;
  } else if (trigger) {
    before = workflow.triggers.map(item => item.type).join(', '); after = trigger[1]!.toLowerCase();
    description = 'Change fixture trigger kind only. Timing and actual webhook endpoints remain unconfigured.';
    workflow.triggers = [{ id: 'fixture_start', type: after as 'manual' | 'schedule' | 'webhook' }];
  } else return fail('UNSUPPORTED_EDIT', 'Mock suggestions support: change threshold to 25000; rename workflow to Vendor invoices; rename node read_invoice to Read vendor invoice; switch trigger to webhook.');
  compileWorkflow(workflow, invoicePolicy);
  return { generationId: document.snapshot.generationId, expectedRevision: document.snapshot.revision, before, after, description, workflow };
}

export function acceptProposal(input: StudioDocument, proposal: Proposal): StudioDocument {
  const document = validateDocument(input);
  if (proposal.generationId !== document.snapshot.generationId || proposal.expectedRevision !== document.snapshot.revision || document.snapshot.status !== 'ready') fail('REVISION_CONFLICT', 'The draft changed since this suggestion. Request a new suggestion.');
  const workflow = WorkflowSchema.parse(proposal.workflow);
  if (workflow.id !== document.snapshot.workflow.id || workflow.workspaceId !== document.snapshot.workflow.workspaceId) fail('DRAFT_IDENTITY_CHANGED', 'A suggestion cannot replace the draft identity.');
  compileWorkflow(workflow, invoicePolicy);
  return { ...document, snapshot: { ...document.snapshot, workflow, revision: document.snapshot.revision + 1 }, targetWorkflow: clone(workflow), pendingEvents: [] };
}

export function setNodePosition(input: StudioDocument, nodeId: string, position: { x: number; y: number }): StudioDocument {
  const document = validateDocument(input);
  if (!document.snapshot.workflow.nodes.some(node => node.id === nodeId)) fail('MISSING_NODE', 'Unknown canvas node.');
  return { ...document, positions: { ...document.positions, [nodeId]: PositionSchema.parse(position) } };
}

export function importWorkflow(input: StudioDocument, imported: unknown, expectedRevision: number): StudioDocument {
  const document = validateDocument(input);
  if (expectedRevision !== document.snapshot.revision) fail('REVISION_CONFLICT', 'Reload the draft before importing.');
  let workflow: Workflow;
  if (imported && typeof imported === 'object' && 'steps' in imported) {
    const legacy = z.object({ name: z.string().trim().min(1).max(100), steps: z.array(z.unknown()) }).parse(imported);
    if (legacy.steps.length) fail('UNSUPPORTED_LEGACY', 'Legacy app modules cannot be mapped safely to this fixture. The original local draft is unchanged. Import a supported canonical workflow JSON instead.');
    workflow = { ...clone(invoiceWorkflow), id: document.snapshot.workflow.id, name: legacy.name, nodes: [], edges: [] };
  } else {
    workflow = WorkflowSchema.parse(imported);
    validatePartial(workflow);
    if (workflow.nodes.length) compileWorkflow(workflow, invoicePolicy);
    else if (workflow.edges.length) fail('INVALID_EDGE', 'An empty workflow cannot contain edges.');
    workflow.id = document.snapshot.workflow.id;
  }
  const snapshot = createDraftSnapshot(id(), workflow, document.snapshot.revision + 1);
  if (workflow.nodes.length) snapshot.status = 'ready';
  return { ...document, snapshot, targetWorkflow: workflow.nodes.length ? clone(workflow) : null, pendingEvents: [], positions: {}, assumptions: ['Explicitly imported local draft. No live account, trigger, or execution is configured.'] };
}

export function inspectLegacyDrafts(raw: string | null): LegacyDraftChoice[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return fail('LEGACY_INVALID', 'Existing legacy storage is not valid JSON; it has not been changed.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fail('LEGACY_INVALID', 'Existing legacy drafts are not a draft collection; they have not been changed.');
  return Object.entries(parsed).map(([key, draft]) => {
    const value = draft as { name?: unknown; steps?: unknown } | null;
    const compatible = !!value && typeof value.name === 'string' && Array.isArray(value.steps) && value.steps.length === 0;
    return { id: key, name: value && typeof value.name === 'string' ? value.name : key, draft, compatible, reason: compatible ? 'Empty legacy draft can be imported as an inert blank workflow.' : 'Legacy app modules are unsupported; original data will be preserved.' };
  });
}

export function loadStudio(storage: StorageLike): StudioDocument | null {
  let raw: string | null;
  try { raw = storage.getItem(STUDIO_STORAGE_KEY); } catch { return fail('STORAGE_UNAVAILABLE', 'Browser storage is unavailable. Existing data has not been changed.'); }
  if (raw === null) return null;
  try { return validateDocument(JSON.parse(raw)); } catch { return fail('STORAGE_INVALID', 'Saved Studio data is invalid or incompatible. It has not been overwritten; export or repair it before continuing.'); }
}

export function saveStudio(storage: StorageLike, next: StudioDocument, expectedStorageRevision: number | null): StudioDocument {
  const current = loadStudio(storage);
  if ((current?.storageRevision ?? null) !== expectedStorageRevision) fail('STORAGE_CONFLICT', 'Another tab or action changed this draft. Reload the saved draft before continuing.');
  if (next.storageRevision !== (expectedStorageRevision ?? 0)) fail('STORAGE_CONFLICT', 'This change was created from an older saved draft. Reload before saving.');
  const saved = validateDocument({ ...next, storageRevision: (expectedStorageRevision ?? 0) + 1 });
  try { storage.setItem(STUDIO_STORAGE_KEY, JSON.stringify(saved)); } catch { return fail('STORAGE_UNAVAILABLE', 'The draft could not be saved, possibly because storage is full. The previous saved draft is unchanged.'); }
  return saved;
}
