import { createDraftSnapshot, DraftEventSchema, replayDraftEvents, WorkflowSchema, type CompilePolicy, type DraftEvent } from '../../shared/index.js';

export const invoiceWorkflow = WorkflowSchema.parse({
  schemaVersion: 1, id: 'invoice_example', workspaceId: 'fixture_workspace', name: 'Collect one invoice (mock fixture)',
  triggers: [{ id: 'manual_start', type: 'manual' }],
  budget: { maxSteps: 10, maxDurationSeconds: 300, maxCostUsd: 1 },
  nodes: [
    { id: 'open_portal', label: 'Open invoice portal', actionType: 'browser.navigate', actionVersion: 1, config: { url: 'https://portal.example/invoice/known' }, inputs: {} },
    { id: 'read_invoice', label: 'Read invoice fields', actionType: 'browser.read_invoice', actionVersion: 1, config: { invoiceIdSelector: '[data-invoice-id]', amountSelector: '[data-invoice-amount]' }, inputs: {} },
    { id: 'check_amount', label: 'Amount exceeds 50,000?', actionType: 'condition.compare', actionVersion: 1, config: { operator: 'gt', threshold: 50000 }, inputs: { value: { kind: 'output', nodeId: 'read_invoice', field: 'amount' } } },
    { id: 'approve_invoice', label: 'Request approval', actionType: 'human.approval', actionVersion: 1, config: { expiresInSeconds: 3600 }, inputs: { invoiceId: { kind: 'output', nodeId: 'read_invoice', field: 'invoiceId' }, amount: { kind: 'output', nodeId: 'read_invoice', field: 'amount' } } },
    { id: 'download_invoice', label: 'Download invoice', actionType: 'browser.download', actionVersion: 1, config: { selector: '[data-download-invoice]' }, inputs: {} },
    { id: 'notify_team', label: 'Deliver invoice result', actionType: 'api.request', actionVersion: 1, config: { url: 'https://notify.example/invoices', method: 'POST' }, inputs: { invoiceId: { kind: 'output', nodeId: 'read_invoice', field: 'invoiceId' }, artifactId: { kind: 'output', nodeId: 'download_invoice', field: 'artifactId' } } },
  ],
  edges: [
    { id: 'open_read', source: 'open_portal', target: 'read_invoice' },
    { id: 'read_check', source: 'read_invoice', target: 'check_amount' },
    { id: 'check_approve', source: 'check_amount', target: 'approve_invoice', branch: 'true' },
    { id: 'check_download', source: 'check_amount', target: 'download_invoice', branch: 'false' },
    { id: 'approve_download', source: 'approve_invoice', target: 'download_invoice' },
    { id: 'download_notify', source: 'download_invoice', target: 'notify_team' },
  ],
});

export const invoicePolicy: CompilePolicy = { workspaceId: 'fixture_workspace', allowedOrigins: ['https://portal.example', 'https://notify.example'], connections: [] };
export const invoiceInitialSnapshot = createDraftSnapshot('01f00000-0000-4000-8000-000000000001', { ...invoiceWorkflow, nodes: [], edges: [] });
export const invoiceEvents: DraftEvent[] = [];
let revision = 0;
function append(type: DraftEvent['type'], payload: unknown) {
  if (['draft.node_added', 'draft.edge_added', 'draft.node_configured'].includes(type)) revision++;
  const sequence = invoiceEvents.length + 1;
  invoiceEvents.push(DraftEventSchema.parse({ generationId: invoiceInitialSnapshot.generationId, eventId: `${invoiceInitialSnapshot.generationId}:${sequence}`, sequence, draftRevision: revision, type, payload }));
}
append('plan.started', {});
for (const node of invoiceWorkflow.nodes) append('draft.node_added', { node });
for (const edge of invoiceWorkflow.edges) append('draft.edge_added', { edge });
for (const node of invoiceWorkflow.nodes.filter((node) => node.actionType.startsWith('browser.') || node.actionType.startsWith('api.'))) append('draft.connection_required', { nodeId: node.id, kind: node.actionType.startsWith('browser.') ? 'browser' : 'api' });
append('plan.ready', {});
export const invoiceFinalSnapshot = replayDraftEvents(invoiceInitialSnapshot, invoiceEvents, invoicePolicy);

export const invoiceMockEvidence = {
  mode: 'mock', outcome: 'simulated', invoiceId: 'MOCK-INV-001', amount: 64000,
  note: 'Fixture data only. No model, portal, API, browser session, approval or artifact was actually executed.',
} as const;
