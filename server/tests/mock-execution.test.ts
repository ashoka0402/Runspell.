import assert from 'node:assert/strict';
import { test } from 'node:test';
import { invoiceWorkflow } from '../../fixtures/m0/invoice.js';
import { actionRegistry, type ActionType } from '../../shared/index.js';
import { executeMockWorkflow } from '../src/mock-execution.js';

test('the invoice simulation follows the approval branch and emits typed synthetic outputs', () => {
  const result = executeMockWorkflow(invoiceWorkflow);
  assert.equal(result.evidence, 'simulated');
  assert.deepEqual(result.steps.map(({ nodeId }) => nodeId), [
    'open_portal', 'read_invoice', 'check_amount', 'approve_invoice', 'download_invoice', 'notify_team',
  ]);
  for (const { actionType, output, outcome } of result.steps) {
    assert.equal(outcome, 'simulated');
    assert.deepEqual(actionRegistry[actionType as ActionType].output.parse(output), output);
  }
  assert.deepEqual(result.steps[2].output, { result: true });
  assert.deepEqual(result.steps[3].output, { approved: true });
  assert.notEqual(result.steps[0].output?.url, invoiceWorkflow.nodes[0].config.url);
});

test('the false branch skips approval and executes the joined download once', () => {
  const workflow = structuredClone(invoiceWorkflow);
  const condition = workflow.nodes.find((node) => node.id === 'check_amount')!;
  condition.inputs.value = { kind: 'literal', value: 50_000 };
  const { steps } = executeMockWorkflow(workflow);

  assert.deepEqual(steps.find(({ nodeId }) => nodeId === 'check_amount')?.output, { result: false });
  assert.deepEqual(steps.find(({ nodeId }) => nodeId === 'approve_invoice'), {
    nodeId: 'approve_invoice', actionType: 'human.approval', outcome: 'skipped',
  });
  assert.deepEqual(steps.filter(({ nodeId }) => nodeId === 'download_invoice').map(({ outcome }) => outcome), ['simulated']);
  assert.equal(steps.find(({ nodeId }) => nodeId === 'notify_team')?.outcome, 'simulated');
});

test('invalid graphs and unknown actions fail before a simulated result is returned', () => {
  const invalidEdge = structuredClone(invoiceWorkflow);
  invalidEdge.edges[0].target = 'missing_node';
  assert.throws(() => executeMockWorkflow(invalidEdge), { code: 'INVALID_EDGE' });

  const invalidAction = structuredClone(invoiceWorkflow);
  invalidAction.nodes[0].actionType = 'unknown.action';
  assert.throws(() => executeMockWorkflow(invalidAction), { code: 'UNSUPPORTED_ACTION' });
});
