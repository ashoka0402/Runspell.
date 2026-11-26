import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  actionRegistry, applyDraftPatch, ApprovalStatusSchema, compileWorkflow, ContractError, contractJsonSchemas,
  createDraftSnapshot, DraftEventSchema, DraftSnapshotSchema, EvidenceOutcomeSchema, GenerationStatusSchema, ManifestSchema,
  manifestSchemas, replayDraftEvents, RunStatusSchema, TestModePolicies, TestModeSchema,
} from '../../shared/index.js';
import { invoiceEvents, invoiceFinalSnapshot, invoiceInitialSnapshot, invoiceMockEvidence, invoicePolicy, invoiceWorkflow } from '../../fixtures/m0/invoice.js';

const copy = <T>(value: T): T => structuredClone(value);
const code = (expected: string) => (error: unknown) => error instanceof ContractError && error.code === expected;

test('invoice fixture compiles with explicit missing connections, without claiming execution', () => {
  const result = compileWorkflow(invoiceWorkflow, invoicePolicy);
  assert.equal(result.order.length, 6);
  assert.deepEqual(result.order, ['open_portal', 'read_invoice', 'check_amount', 'approve_invoice', 'download_invoice', 'notify_team']);
  assert.equal(result.connectionRequirements.length, 4);
  assert.equal(invoiceMockEvidence.mode, 'mock');
  assert.equal(invoiceMockEvidence.outcome, 'simulated');
  assert.equal(invoiceFinalSnapshot.status, 'ready');
  assert.deepEqual(invoiceFinalSnapshot.workflow, invoiceWorkflow);
});

test('versioned manifests export config/input/output JSON schemas and conservative side-effect policies', () => {
  assert.equal(manifestSchemas.length, 6);
  for (const manifest of manifestSchemas) {
    assert.deepEqual(ManifestSchema.parse(manifest), manifest);
    assert.equal(manifest.configSchema.type, 'object');
    assert.equal(manifest.inputSchema.type, 'object');
    assert.equal(manifest.outputSchema.type, 'object');
    assert(manifest.evidence.length);
  }
  assert.equal(actionRegistry['browser.download'].manifest.retry, 'verify_before_retry');
  assert.equal(actionRegistry['browser.download'].manifest.sideEffect, 'unsafe_write');
  assert.throws(() => ManifestSchema.parse({ ...manifestSchemas[0], sideEffect: 'unsafe_write', retry: 'safe' }));
  assert.equal(contractJsonSchemas.workflow.type, 'object');
  assert(contractJsonSchemas.event.oneOf);
});

test('compiler rejects unsupported action/schema versions and reserved keys', () => {
  const unsupported = copy(invoiceWorkflow); unsupported.nodes[0]!.actionType = 'code.execute';
  assert.throws(() => compileWorkflow(unsupported, invoicePolicy), code('UNSUPPORTED_ACTION'));
  assert.throws(() => compileWorkflow({ ...invoiceWorkflow, schemaVersion: 2 }, invoicePolicy));
  const reserved = copy(invoiceWorkflow); reserved.nodes[0]!.id = 'constructor';
  assert.throws(() => compileWorkflow(reserved, invoicePolicy));
  const inputs = copy(invoiceWorkflow); Object.defineProperty(inputs.nodes[2]!.inputs, 'constructor', { enumerable: true, value: { kind: 'literal', value: 1 } });
  assert.throws(() => compileWorkflow(inputs, invoicePolicy));
  assert.throws(() => compileWorkflow({ ...invoiceWorkflow, arbitraryCode: 'run()' }, invoicePolicy));
});

test('compiler rejects duplicate IDs, missing endpoints, cycles and unstructured branches', () => {
  const duplicate = copy(invoiceWorkflow); duplicate.nodes.push(copy(duplicate.nodes[0]!));
  assert.throws(() => compileWorkflow(duplicate, invoicePolicy), code('DUPLICATE_ID'));
  const missing = copy(invoiceWorkflow); missing.edges[0]!.target = 'unknown';
  assert.throws(() => compileWorkflow(missing, invoicePolicy), code('INVALID_EDGE'));
  const cycle = copy(invoiceWorkflow); cycle.edges.push({ id: 'cycle', source: 'notify_team', target: 'read_invoice' });
  assert.throws(() => compileWorkflow(cycle, invoicePolicy), code('CYCLIC_GRAPH'));
  const branches = copy(invoiceWorkflow); branches.edges = branches.edges.filter((edge) => edge.id !== 'check_download');
  assert.throws(() => compileWorkflow(branches, invoicePolicy), code('INVALID_BRANCH'));
  const oversized = copy(invoiceWorkflow); oversized.nodes = Array.from({ length: 51 }, () => copy(invoiceWorkflow.nodes[0]!));
  assert.throws(() => compileWorkflow(oversized, invoicePolicy));
});

test('compiler checks output existence, type, and dominance rather than topological order alone', () => {
  const missing = copy(invoiceWorkflow); missing.nodes[2]!.inputs.value = { kind: 'output', nodeId: 'read_invoice', field: 'missing' };
  assert.throws(() => compileWorkflow(missing, invoicePolicy), code('INVALID_REFERENCE'));
  const wrongType = copy(invoiceWorkflow); wrongType.nodes[2]!.inputs.value = { kind: 'output', nodeId: 'read_invoice', field: 'invoiceId' };
  assert.throws(() => compileWorkflow(wrongType, invoicePolicy), code('INCOMPATIBLE_REFERENCE'));
  const future = copy(invoiceWorkflow); future.nodes[2]!.inputs.value = { kind: 'output', nodeId: 'notify_team', field: 'status' };
  assert.throws(() => compileWorkflow(future, invoicePolicy), code('INVALID_REFERENCE'));
  const conditional = copy(invoiceWorkflow); conditional.nodes[5]!.inputs.invoiceId = { kind: 'output', nodeId: 'approve_invoice', field: 'approved' };
  assert.throws(() => compileWorkflow(conditional, invoicePolicy), code('INVALID_REFERENCE'));
  const literal = copy(invoiceWorkflow); literal.nodes[2]!.inputs.value = { kind: 'literal', value: '64000' };
  assert.throws(() => compileWorkflow(literal, invoicePolicy));
});

test('connection authorization distinguishes absent planning connections from invalid supplied connections', () => {
  const workflow = copy(invoiceWorkflow); workflow.nodes[0]!.connectionId = 'portal_account';
  assert.throws(() => compileWorkflow(workflow, invoicePolicy), code('CONNECTION_NOT_ALLOWED'));
  const policy = copy(invoicePolicy);
  policy.connections.push({ id: 'portal_account', workspaceId: 'other_workspace', kind: 'browser', scopes: ['browser:read'] });
  assert.throws(() => compileWorkflow(workflow, policy), code('CONNECTION_NOT_ALLOWED'));
  policy.connections[0]!.workspaceId = policy.workspaceId; policy.connections[0]!.scopes = [];
  assert.throws(() => compileWorkflow(workflow, policy), code('CONNECTION_NOT_ALLOWED'));
  policy.connections[0]!.scopes = ['browser:read'];
  assert.equal(compileWorkflow(workflow, policy).connectionRequirements.length, 3);
  assert.throws(() => compileWorkflow({ ...workflow, workspaceId: 'other_workspace' }, policy), code('WORKSPACE_MISMATCH'));
});

test('compiler validates destinations, action config, fields and declared admission budgets', () => {
  const destination = copy(invoiceWorkflow); destination.nodes[0]!.config.url = 'https://unapproved.example/';
  assert.throws(() => compileWorkflow(destination, invoicePolicy), code('DESTINATION_NOT_ALLOWED'));
  const credentials = copy(invoiceWorkflow); credentials.nodes[0]!.config.url = 'https://user:password@portal.example/';
  assert.throws(() => compileWorkflow(credentials, invoicePolicy));
  const config = copy(invoiceWorkflow); config.nodes[0]!.config.script = 'alert(1)';
  assert.throws(() => compileWorkflow(config, invoicePolicy));
  const fields = copy(invoiceWorkflow); fields.nodes[2]!.inputs.extra = { kind: 'literal', value: 0 };
  assert.throws(() => compileWorkflow(fields, invoicePolicy), code('INVALID_INPUT'));
  assert.throws(() => compileWorkflow({ ...invoiceWorkflow, budget: { ...invoiceWorkflow.budget, maxCostUsd: .01 } }, invoicePolicy), code('BUDGET_EXCEEDED'));
});

test('four test modes and run/approval/evidence vocabularies keep simulation and uncertain outcomes distinct', () => {
  assert.deepEqual(TestModeSchema.options, ['validate', 'mock', 'read_only', 'controlled_write']);
  assert.equal(TestModePolicies.mock.externalWrites, false);
  assert.equal(TestModePolicies.read_only.externalWrites, false);
  assert.equal(TestModePolicies.controlled_write.requiresControlledAccount, true);
  assert.equal(RunStatusSchema.parse('needs_attention'), 'needs_attention');
  assert.equal(RunStatusSchema.parse('cancel_requested'), 'cancel_requested');
  assert.equal(ApprovalStatusSchema.parse('expired'), 'expired');
  assert.equal(EvidenceOutcomeSchema.parse('unknown'), 'unknown');
  assert.equal(GenerationStatusSchema.parse('needs_clarification'), 'needs_clarification');
});

test('complete event envelopes are strict and reconstruct the same fixture incrementally', () => {
  assert.deepEqual(DraftEventSchema.parse(invoiceEvents[0]), invoiceEvents[0]);
  assert.throws(() => DraftEventSchema.parse({ ...invoiceEvents[0], fakeSuccess: true }));
  let state = copy(invoiceInitialSnapshot);
  for (const event of invoiceEvents) state = replayDraftEvents(state, [event], invoicePolicy);
  assert.deepEqual(state, invoiceFinalSnapshot);
  assert.deepEqual(invoiceInitialSnapshot.workflow.nodes, []);
  assert.deepEqual(replayDraftEvents(state, invoiceEvents, invoicePolicy), state);
});

test('event gaps require snapshot recovery; duplicate conflicts and generation mismatches fail', () => {
  assert.throws(() => replayDraftEvents(invoiceInitialSnapshot, [invoiceEvents[1]], invoicePolicy), code('SNAPSHOT_REQUIRED'));
  const prefix = replayDraftEvents(invoiceInitialSnapshot, invoiceEvents.slice(0, 5), invoicePolicy);
  assert.throws(() => replayDraftEvents(prefix, invoiceEvents.slice(6), invoicePolicy), code('SNAPSHOT_REQUIRED'));
  assert.deepEqual(replayDraftEvents(prefix, invoiceEvents.slice(5), invoicePolicy), invoiceFinalSnapshot);
  const conflicting = copy(invoiceEvents[0]!); conflicting.draftRevision = 1;
  assert.throws(() => replayDraftEvents(prefix, [conflicting], invoicePolicy), code('EVENT_CONFLICT'));
  const another = { ...invoiceEvents[0], generationId: '01f00000-0000-4000-8000-000000000002' };
  assert.throws(() => replayDraftEvents(invoiceInitialSnapshot, [another], invoicePolicy), code('GENERATION_MISMATCH'));
});

test('draft revision and generation lifecycle prevent stale edits or terminal-generation changes', () => {
  const prefix = replayDraftEvents(invoiceInitialSnapshot, invoiceEvents.slice(0, 1), invoicePolicy);
  assert.throws(() => replayDraftEvents(prefix, [{ ...invoiceEvents[1], draftRevision: 42 }], invoicePolicy), code('REVISION_CONFLICT'));
  const sequence = invoiceFinalSnapshot.sequence + 1;
  const event = { ...invoiceEvents[0], sequence, eventId: `${invoiceFinalSnapshot.generationId}:${sequence}`, draftRevision: invoiceFinalSnapshot.revision };
  assert.throws(() => replayDraftEvents(invoiceFinalSnapshot, [event], invoicePolicy), code('INVALID_GENERATION_STATE'));
  const modified = copy(invoiceWorkflow); modified.name = 'Reviewed edit';
  const next = applyDraftPatch(invoiceFinalSnapshot, { expectedRevision: invoiceFinalSnapshot.revision, workflow: modified }, invoicePolicy);
  assert.equal(next.revision, invoiceFinalSnapshot.revision + 1);
  assert.equal(invoiceFinalSnapshot.workflow.name, invoiceWorkflow.name);
  assert.throws(() => applyDraftPatch(next, { expectedRevision: invoiceFinalSnapshot.revision, workflow: modified }, invoicePolicy), code('REVISION_CONFLICT'));
  assert.throws(() => applyDraftPatch(next, { expectedRevision: next.revision, workflow: { ...modified, workspaceId: 'other' } }, invoicePolicy), code('DRAFT_IDENTITY_CHANGED'));
  const resumed = createDraftSnapshot('01f00000-0000-4000-8000-000000000002', modified, next.revision);
  assert.equal(resumed.revision, next.revision); assert.equal(resumed.sequence, 0);
});

test('malformed node/edge events and invalid final graphs never become ready', () => {
  const events = copy(invoiceEvents);
  const nodeEvent = events.find((event) => event.type === 'draft.node_added')!;
  if (nodeEvent.type === 'draft.node_added') nodeEvent.payload.node.actionType = 'ai.invented';
  assert.throws(() => replayDraftEvents(invoiceInitialSnapshot, events, invoicePolicy), code('UNSUPPORTED_ACTION'));
  const missingEdge = invoiceEvents.filter((event) => event.type !== 'draft.edge_added');
  assert.throws(() => replayDraftEvents(invoiceInitialSnapshot, missingEdge, invoicePolicy), code('SNAPSHOT_REQUIRED'));
  const invalidSnapshot = copy(invoiceFinalSnapshot); invalidSnapshot.workflow.nodes[0]!.actionType = 'ai.invented';
  assert.throws(() => replayDraftEvents(invalidSnapshot, [], invoicePolicy), code('UNSUPPORTED_ACTION'));
  const foreignSnapshot = copy(invoiceInitialSnapshot); foreignSnapshot.workflow.workspaceId = 'other_workspace';
  assert.throws(() => replayDraftEvents(foreignSnapshot, invoiceEvents, invoicePolicy), code('WORKSPACE_MISMATCH'));
});

test('snapshot recovery preserves current clarification, failure and warnings without parsing event digests', () => {
  const initial = createDraftSnapshot(invoiceInitialSnapshot.generationId, invoiceWorkflow, 7);
  const events = [
    { type: 'plan.started', payload: {} },
    { type: 'draft.validation_warning', payload: { message: 'The portal account must be connected.' } },
    { type: 'plan.needs_clarification', payload: { question: 'Which team should receive the invoice?' } },
  ].map((body, index) => ({ ...body, generationId: initial.generationId, eventId: `${initial.generationId}:${index + 1}`, sequence: index + 1, draftRevision: initial.revision }));
  const awaiting = replayDraftEvents(initial, events, invoicePolicy);
  const restored = DraftSnapshotSchema.parse(JSON.parse(JSON.stringify(awaiting)));
  assert.deepEqual(restored.clarification, { question: 'Which team should receive the invoice?' });
  assert.equal(restored.failure, null);
  assert.deepEqual(restored.warnings, [{ eventId: events[1]!.eventId, message: 'The portal account must be connected.' }]);
  assert.deepEqual(replayDraftEvents(restored, events, invoicePolicy), restored);
  const failure = { generationId: initial.generationId, eventId: `${initial.generationId}:4`, sequence: 4, draftRevision: 7, type: 'plan.failed', payload: { message: 'The selected connector is unsupported.' } };
  const failed = DraftSnapshotSchema.parse(JSON.parse(JSON.stringify(replayDraftEvents(restored, [failure], invoicePolicy))));
  assert.equal(failed.status, 'failed');
  assert.equal(failed.clarification, null);
  assert.deepEqual(failed.failure, failure.payload);
  assert.deepEqual(failed.warnings, restored.warnings);
  const fresh = createDraftSnapshot('01f00000-0000-4000-8000-000000000002', failed.workflow, failed.revision);
  assert.equal(fresh.revision, 7);
  assert.equal(fresh.clarification, null);
  assert.equal(fresh.failure, null);
  assert.deepEqual(fresh.warnings, []);
});

test('resuming planning and terminal transitions clear stale questions while retaining warnings', () => {
  const initial = createDraftSnapshot(invoiceInitialSnapshot.generationId, invoiceWorkflow);
  const bodies = [
    { type: 'plan.started', payload: {} },
    { type: 'draft.validation_warning', payload: { message: 'This is a fixture draft.' } },
    { type: 'plan.needs_clarification', payload: { question: 'Confirm the threshold.' } },
  ];
  const events = bodies.map((body, index) => ({ ...body, generationId: initial.generationId, eventId: `${initial.generationId}:${index + 1}`, sequence: index + 1, draftRevision: 0 }));
  const awaiting = replayDraftEvents(initial, events, invoicePolicy);
  const envelope = { generationId: initial.generationId, eventId: `${initial.generationId}:4`, sequence: 4, draftRevision: 0 };
  for (const type of ['plan.ready', 'plan.cancelled']) {
    const terminal = replayDraftEvents(awaiting, [{ ...envelope, type, payload: {} }], invoicePolicy);
    assert.equal(terminal.status, type === 'plan.ready' ? 'ready' : 'cancelled');
    assert.equal(terminal.clarification, null);
    assert.equal(terminal.failure, null);
    assert.deepEqual(terminal.warnings, awaiting.warnings);
  }
  const node = copy(invoiceWorkflow.nodes[0]!); node.label = 'Reviewed portal';
  const resumed = replayDraftEvents(awaiting, [{ ...envelope, draftRevision: 1, type: 'draft.node_configured', payload: { node } }], invoicePolicy);
  assert.equal(resumed.status, 'planning');
  assert.equal(resumed.clarification, null);
  assert.deepEqual(resumed.warnings, awaiting.warnings);
  assert.throws(() => DraftSnapshotSchema.parse({ ...resumed, clarification: { question: 'Stale question' } }));
  assert.throws(() => DraftSnapshotSchema.parse({ ...awaiting, clarification: null }));
  assert.throws(() => DraftSnapshotSchema.parse({ ...resumed, warnings: [{ eventId: 'warning', message: 'x'.repeat(501) }] }));
});
