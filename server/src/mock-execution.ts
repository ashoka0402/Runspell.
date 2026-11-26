import { actionRegistry, compileWorkflow, WorkflowSchema, type ActionType } from '../../shared/index.js';

type MockStep = {
  nodeId: string;
  actionType: string;
  outcome: 'simulated' | 'skipped';
  output?: Record<string, unknown>;
};

const simulatedOutputs = {
  'browser.navigate': { url: 'https://mock.example/invoice' },
  'browser.read_invoice': { invoiceId: 'MOCK-INV-001', amount: 64_000 },
  'human.approval': { approved: true },
  'browser.download': { artifactId: 'mock-artifact' },
  'api.request': { status: 200, externalId: 'mock-notification' },
} satisfies Record<Exclude<ActionType, 'condition.compare'>, Record<string, unknown>>;

export function executeMockWorkflow(input: unknown): { evidence: 'simulated'; steps: MockStep[] } {
  const snapshot = WorkflowSchema.parse(input);
  // Revalidate the activated graph for simulation. No destination is contacted.
  const allowedOrigins = new Set<string>();
  for (const { config } of snapshot.nodes) {
    if (typeof config.url === 'string') allowedOrigins.add(new URL(config.url).origin);
  }
  const { workflow, order } = compileWorkflow(snapshot, {
    workspaceId: snapshot.workspaceId, allowedOrigins: [...allowedOrigins], connections: [],
  });
  const nodes = new Map(workflow.nodes.map((node) => [node.id, node]));
  const reachable = new Set([order[0]]);
  const outputs = new Map<string, Record<string, unknown>>();
  const steps: MockStep[] = [];

  for (const nodeId of order) {
    const node = nodes.get(nodeId)!;
    const actionType = node.actionType as ActionType;
    if (!reachable.has(nodeId)) {
      steps.push({ nodeId, actionType, outcome: 'skipped' });
      continue;
    }

    const inputs = Object.fromEntries(Object.entries(node.inputs).map(([field, binding]) => [
      field, binding.kind === 'literal' ? binding.value : outputs.get(binding.nodeId)?.[binding.field],
    ]));
    let output: Record<string, unknown>;
    if (actionType === 'condition.compare') {
      const action = actionRegistry[actionType];
      const { value } = action.input.parse(inputs);
      const { threshold } = action.config.parse(node.config);
      output = action.output.parse({ result: value > threshold });
    } else {
      const action = actionRegistry[actionType];
      action.input.parse(inputs);
      output = action.output.parse(simulatedOutputs[actionType]);
    }
    outputs.set(nodeId, output);
    steps.push({ nodeId, actionType, outcome: 'simulated', output });

    for (const edge of workflow.edges) {
      if (edge.source === nodeId && (edge.branch === undefined || edge.branch === String(output.result))) {
        reachable.add(edge.target);
      }
    }
  }

  return { evidence: 'simulated', steps };
}
