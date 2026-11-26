import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acceptProposal, advanceGeneration, cancelGeneration, createStudioDocument, editNode, EXAMPLE_PROMPT,
  importWorkflow, inspectLegacyDrafts, loadStudio, proposeEdit, receiveDraftEvent, reconnectGeneration,
  resumeGeneration, saveStudio, setNodePosition, startGeneration, STUDIO_STORAGE_KEY, type StorageLike,
} from '../../studio/model.js';
import { compileWorkflow, ContractError } from '../../shared/index.js';
import { invoicePolicy, invoiceWorkflow } from '../../fixtures/m0/invoice.js';

const copy = <T>(input: T): T => structuredClone(input);
const code = (expected: string) => (error: unknown) => error instanceof ContractError && error.code === expected;
function complete(document = startGeneration(createStudioDocument(), EXAMPLE_PROMPT)) {
  while (document.pendingEvents.length) document = advanceGeneration(document);
  return document;
}
class MemoryStorage implements StorageLike {
  values = new Map<string, string>();
  rejectWrites = false;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (this.rejectWrites) throw new Error('Quota exceeded');
    this.values.set(key, value);
  }
}

test('fixture generation advances only accepted events and persists the same graph on reload', () => {
  const storage = new MemoryStorage();
  let document = saveStudio(storage, startGeneration(createStudioDocument(), EXAMPLE_PROMPT), null);
  assert.equal(document.snapshot.workflow.nodes.length, 0);
  assert(document.assumptions.some(item => item.includes('no AI')));
  while (document.pendingEvents.length) {
    const previousSequence = document.snapshot.sequence;
    document = saveStudio(storage, advanceGeneration(document), document.storageRevision);
    assert.equal(document.snapshot.sequence, previousSequence + 1);
  }
  assert.equal(document.snapshot.status, 'ready');
  assert.equal(document.snapshot.workflow.nodes.length, 6);
  assert.equal(compileWorkflow(document.snapshot.workflow, invoicePolicy).connectionRequirements.length, 4);
  assert.deepEqual(loadStudio(storage), document);
});

test('unsupported requests ask for clarification and preserve the accepted graph', () => {
  const original = complete();
  for (const prompt of ['Send an email', 'Collect all invoices in Gmail', 'Collect one invoice every morning', 'Collect one invoice and deploy a server']) {
    const next = startGeneration(original, prompt);
    assert.equal(next.snapshot.status, 'needs_clarification');
    assert(next.snapshot.clarification?.question);
    assert.deepEqual(next.snapshot.workflow, original.snapshot.workflow);
    assert.equal(next.pendingEvents.length, 0);
  }
  assert.throws(() => startGeneration(original, '   '));
});

test('cancelled partial generation remains editable and resumes without overwriting edits', () => {
  let document = startGeneration(createStudioDocument(), EXAMPLE_PROMPT);
  for (let index = 0; index < 3; index++) document = advanceGeneration(document);
  document = cancelGeneration(document);
  const revision = document.snapshot.revision;
  document = editNode(document, 'open_portal', { label: 'Reviewed portal', config: { url: 'https://portal.example/invoice/reviewed' } }, revision);
  assert.equal(document.snapshot.status, 'cancelled');
  assert.equal(document.snapshot.workflow.nodes.length, 2);
  document = complete(resumeGeneration(document));
  assert.equal(document.snapshot.workflow.nodes.find(node => node.id === 'open_portal')!.label, 'Reviewed portal');
  assert.equal(document.snapshot.workflow.nodes[0]!.config.url, 'https://portal.example/invoice/reviewed');
  assert.equal(new Set(document.snapshot.workflow.nodes.map(node => node.id)).size, 6);
});

test('refresh preserves interrupted state and requires explicit continuation', () => {
  const storage = new MemoryStorage();
  const partial = advanceGeneration(advanceGeneration(startGeneration(createStudioDocument(), EXAMPLE_PROMPT)));
  const saved = saveStudio(storage, partial, null);
  const loaded = loadStudio(storage)!;
  assert.equal(loaded.snapshot.sequence, saved.snapshot.sequence);
  assert.equal(loaded.snapshot.workflow.nodes.length, 1);
  const recovered = complete(reconnectGeneration(loaded));
  assert.equal(recovered.snapshot.status, 'ready');
  assert.equal(recovered.snapshot.workflow.nodes.length, 6);
});

test('duplicate events are idempotent and missing events demand explicit recovery', () => {
  let document = startGeneration(createStudioDocument(), EXAMPLE_PROMPT);
  const first = copy(document.pendingEvents[0]!);
  document = receiveDraftEvent(document, first);
  assert.deepEqual(receiveDraftEvent(document, first), document);
  assert.throws(() => receiveDraftEvent(document, document.pendingEvents[1]!), code('SNAPSHOT_REQUIRED'));
  assert.equal(complete(reconnectGeneration(document)).snapshot.workflow.nodes.length, 6);
});

test('reviewed proposals change nothing until accepted and stale proposals are rejected', () => {
  const original = complete();
  const proposal = proposeEdit(original, 'change threshold to 25000');
  assert.match(proposal.before, /50000/);
  assert.match(proposal.after, /25000/);
  assert.equal(original.snapshot.workflow.nodes.find(node => node.id === 'check_amount')!.config.threshold, 50000);
  const accepted = acceptProposal(original, proposal);
  assert.equal(accepted.snapshot.workflow.nodes.find(node => node.id === 'check_amount')!.config.threshold, 25000);
  assert.equal(accepted.snapshot.revision, original.snapshot.revision + 1);
  const edited = editNode(original, 'read_invoice', { label: 'Manual change', config: copy(original.snapshot.workflow.nodes[1]!.config) }, original.snapshot.revision);
  assert.throws(() => acceptProposal(edited, proposal), code('REVISION_CONFLICT'));
  assert.throws(() => acceptProposal(startGeneration(original, EXAMPLE_PROMPT), proposal), code('REVISION_CONFLICT'));
  assert.throws(() => proposeEdit(original, 'Send payment now'), code('UNSUPPORTED_EDIT'));
});

test('mock revisions can rename and change trigger kind without claiming an endpoint or timing', () => {
  let document = complete();
  document = acceptProposal(document, proposeEdit(document, 'rename workflow to Vendor invoices'));
  document = acceptProposal(document, proposeEdit(document, 'rename node read_invoice to Read vendor invoice'));
  document = acceptProposal(document, proposeEdit(document, 'switch trigger to webhook'));
  assert.equal(document.snapshot.workflow.name, 'Vendor invoices');
  assert.equal(document.snapshot.workflow.nodes[1]!.label, 'Read vendor invoice');
  assert.deepEqual(document.snapshot.workflow.triggers, [{ id: 'fixture_start', type: 'webhook' }]);
});

test('manual changes validate supported configuration, destinations, and expected revision', () => {
  const document = complete();
  assert.throws(() => editNode(document, 'open_portal', { label: 'Wrong site', config: { url: 'https://evil.example' } }, document.snapshot.revision), code('DESTINATION_NOT_ALLOWED'));
  assert.throws(() => editNode(document, 'read_invoice', { label: '', config: {} }, document.snapshot.revision));
  assert.throws(() => editNode(document, 'read_invoice', { label: 'Stale', config: copy(document.snapshot.workflow.nodes[1]!.config) }, 0), code('REVISION_CONFLICT'));
});

test('layout remains presentation-only and does not invalidate a semantic proposal', () => {
  const document = complete();
  const proposal = proposeEdit(document, 'rename workflow to Positioned invoice');
  const moved = setNodePosition(document, 'open_portal', { x: 120, y: -20 });
  assert.equal(moved.snapshot.revision, document.snapshot.revision);
  assert.equal(acceptProposal(moved, proposal).snapshot.workflow.name, 'Positioned invoice');
  assert.throws(() => setNodePosition(document, 'open_portal', { x: Infinity, y: 0 }));
});

test('storage rejects stale writes, preserves legacy data, and leaves invalid raw data untouched', () => {
  const storage = new MemoryStorage();
  const legacyRaw = JSON.stringify({ blank: { name: 'Original', steps: [] } });
  storage.setItem('brisko.workflow.drafts', legacyRaw);
  const first = saveStudio(storage, complete(), null);
  const second = saveStudio(storage, acceptProposal(first, proposeEdit(first, 'rename workflow to Latest')), first.storageRevision);
  assert.throws(() => saveStudio(storage, first, first.storageRevision), code('STORAGE_CONFLICT'));
  assert.throws(() => saveStudio(storage, first, second.storageRevision), code('STORAGE_CONFLICT'));
  assert.deepEqual(loadStudio(storage), second);
  assert.equal(storage.getItem('brisko.workflow.drafts'), legacyRaw);
  storage.setItem(STUDIO_STORAGE_KEY, '{broken json');
  assert.throws(() => loadStudio(storage), code('STORAGE_INVALID'));
  assert.throws(() => saveStudio(storage, first, null), code('STORAGE_INVALID'));
  assert.equal(storage.getItem(STUDIO_STORAGE_KEY), '{broken json');
});

test('storage quota/read failures are surfaced without replacing the accepted saved draft', () => {
  const storage = new MemoryStorage();
  const saved = saveStudio(storage, complete(), null);
  const raw = storage.getItem(STUDIO_STORAGE_KEY);
  storage.rejectWrites = true;
  assert.throws(() => saveStudio(storage, saved, saved.storageRevision), code('STORAGE_UNAVAILABLE'));
  assert.equal(storage.getItem(STUDIO_STORAGE_KEY), raw);
  assert.throws(() => loadStudio({ getItem() { throw new Error('Denied'); }, setItem() {} }), code('STORAGE_UNAVAILABLE'));
});

test('legacy import is explicit and only empty drafts convert; canonical imports are validated', () => {
  const document = complete();
  const choices = inspectLegacyDrafts(JSON.stringify({ blank: { name: 'Empty original', steps: [] }, filled: { name: 'Storefront original', steps: [{ app: 'Storefront' }] } }));
  assert.equal(choices[0]!.compatible, true);
  assert.equal(choices[1]!.compatible, false);
  assert.throws(() => importWorkflow(document, choices[1]!.draft, document.snapshot.revision), code('UNSUPPORTED_LEGACY'));
  const blank = importWorkflow(document, choices[0]!.draft, document.snapshot.revision);
  assert.equal(blank.snapshot.workflow.name, 'Empty original');
  assert.equal(blank.snapshot.workflow.nodes.length, 0);
  assert.equal(blank.snapshot.status, 'idle');
  const canonical = importWorkflow(blank, copy(invoiceWorkflow), blank.snapshot.revision);
  assert.equal(canonical.snapshot.status, 'ready');
  assert.throws(() => importWorkflow(canonical, { ...invoiceWorkflow, workspaceId: 'other' }, canonical.snapshot.revision), code('WORKSPACE_MISMATCH'));
});
