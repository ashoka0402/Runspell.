import { z } from 'zod';
import { actionRegistry, FieldNameSchema, IdentifierSchema, type ActionType } from './registry.js';

export const BindingSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('literal'), value: z.json() }),
  z.strictObject({ kind: z.literal('output'), nodeId: IdentifierSchema, field: FieldNameSchema }),
]);
export const NodeSchema = z.strictObject({
  id: IdentifierSchema, label: z.string().min(1).max(100), actionType: z.string().min(1), actionVersion: z.literal(1),
  connectionId: IdentifierSchema.optional(), config: z.record(FieldNameSchema, z.json()), inputs: z.record(FieldNameSchema, BindingSchema),
});
export const EdgeSchema = z.strictObject({ id: IdentifierSchema, source: IdentifierSchema, target: IdentifierSchema, branch: z.enum(['true', 'false']).optional() });
export const WorkflowSchema = z.strictObject({
  schemaVersion: z.literal(1), id: IdentifierSchema, workspaceId: IdentifierSchema, name: z.string().min(1).max(100),
  triggers: z.array(z.strictObject({ id: IdentifierSchema, type: z.enum(['manual', 'schedule', 'webhook']) })).min(1).max(10),
  nodes: z.array(NodeSchema).max(50), edges: z.array(EdgeSchema).max(100),
  budget: z.strictObject({ maxSteps: z.number().int().positive().max(50), maxDurationSeconds: z.number().int().positive().max(3600), maxCostUsd: z.number().positive().max(10) }),
});
export type Workflow = z.infer<typeof WorkflowSchema>;
export type WorkflowNode = z.infer<typeof NodeSchema>;
export type WorkflowEdge = z.infer<typeof EdgeSchema>;
export const CompilePolicySchema = z.strictObject({
  workspaceId: IdentifierSchema,
  allowedOrigins: z.array(z.url()).max(20),
  connections: z.array(z.strictObject({ id: IdentifierSchema, workspaceId: IdentifierSchema, kind: z.enum(['browser', 'api']), scopes: z.array(z.string()).max(10) })).max(20),
});
export type CompilePolicy = z.infer<typeof CompilePolicySchema>;
export class ContractError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'ContractError'; }
}
const reject = (code: string, message: string): never => { throw new ContractError(code, message); };
const unique = (values: string[], what: string) => {
  if (new Set(values).size !== values.length) reject('DUPLICATE_ID', `Duplicate ${what}`);
};

export function compileWorkflow(input: unknown, inputPolicy: unknown) {
  const workflow = WorkflowSchema.parse(input), policy = CompilePolicySchema.parse(inputPolicy);
  if (workflow.workspaceId !== policy.workspaceId) reject('WORKSPACE_MISMATCH', 'Workflow is outside the current workspace');
  if (!workflow.nodes.length) reject('EMPTY_WORKFLOW', 'A complete candidate requires an action');
  unique(workflow.nodes.map((node) => node.id), 'node ID');
  unique(workflow.edges.map((edge) => edge.id), 'edge ID');
  unique(workflow.triggers.map((trigger) => trigger.id), 'trigger ID');
  unique(policy.connections.map((connection) => connection.id), 'connection ID');
  const nodes = new Map(workflow.nodes.map((node) => [node.id, node]));
  const incoming = new Map(workflow.nodes.map((node) => [node.id, [] as string[]]));
  const outgoing = new Map(workflow.nodes.map((node) => [node.id, [] as WorkflowEdge[]]));
  for (const edge of workflow.edges) {
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) reject('INVALID_EDGE', 'An edge references a missing node');
    incoming.get(edge.target)!.push(edge.source); outgoing.get(edge.source)!.push(edge);
  }
  const entries = workflow.nodes.filter((node) => !incoming.get(node.id)!.length);
  if (entries.length !== 1) reject('INVALID_ENTRY', 'Exactly one entry action is required');
  const remaining = new Map([...incoming].map(([id, parents]) => [id, parents.length]));
  const order: string[] = [], queue = [entries[0]!.id];
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index]!; order.push(id);
    for (const edge of outgoing.get(id)!) {
      remaining.set(edge.target, remaining.get(edge.target)! - 1);
      if (!remaining.get(edge.target)) queue.push(edge.target);
    }
  }
  if (order.length !== workflow.nodes.length) reject('CYCLIC_GRAPH', 'Cycles and unreachable nodes are unsupported');
  // A source must dominate its consumer, so conditional-only values cannot leak across a join.
  const dominators = new Map<string, Set<string>>();
  for (const id of order) {
    const parents = incoming.get(id)!;
    const common = parents.length ? [...dominators.get(parents[0]!)!].filter((ancestor) => parents.every((parent) => dominators.get(parent)!.has(ancestor))) : [];
    dominators.set(id, new Set([...common, id]));
  }
  const connectionRequirements: Array<{ nodeId: string; kind: 'browser' | 'api'; scopes: string[] }> = [];
  let totalDuration = 0, totalCost = 0;
  for (const id of order) {
    const node = nodes.get(id)!;
    if (!Object.hasOwn(actionRegistry, node.actionType)) reject('UNSUPPORTED_ACTION', `Unsupported action: ${node.actionType}`);
    const action = actionRegistry[node.actionType as ActionType];
    action.config.parse(node.config);
    totalDuration += action.manifest.budget.maxDurationSeconds; totalCost += action.manifest.budget.maxCostUsd;
    if ('url' in node.config) {
      const origin = new URL(node.config.url as string).origin;
      if (!policy.allowedOrigins.includes(origin)) reject('DESTINATION_NOT_ALLOWED', `Destination is not approved: ${origin}`);
    }
    const branches = outgoing.get(id)!;
    if (node.actionType === 'condition.compare') {
      if (branches.length !== 2 || new Set(branches.map((edge) => edge.branch)).size !== 2 || branches.some((edge) => !edge.branch)) reject('INVALID_BRANCH', 'A condition requires true and false branches');
    } else if (branches.length > 1 || branches.some((edge) => edge.branch)) reject('INVALID_BRANCH', 'Only conditions can branch');
    if (action.manifest.connection) {
      if (!node.connectionId) connectionRequirements.push({ nodeId: id, kind: action.manifest.connection, scopes: [...action.manifest.scopes] });
      else {
        const connection = policy.connections.find((item) => item.id === node.connectionId);
        if (!connection || connection.workspaceId !== policy.workspaceId || connection.kind !== action.manifest.connection || action.manifest.scopes.some((scope) => !connection.scopes.includes(scope))) reject('CONNECTION_NOT_ALLOWED', `Connection is missing, cross-workspace, wrong-kind, or missing scopes: ${id}`);
      }
    } else if (node.connectionId) reject('UNEXPECTED_CONNECTION', `${id} does not accept a connection`);
    const shape = action.input.shape as Record<string, z.ZodType>;
    if (Object.keys(node.inputs).some((field) => !Object.hasOwn(shape, field)) || Object.keys(shape).some((field) => !Object.hasOwn(node.inputs, field))) reject('INVALID_INPUT', `Input fields do not match ${id}`);
    for (const [field, binding] of Object.entries(node.inputs)) {
      const expected = shape[field]!;
      if (binding.kind === 'literal') expected.parse(binding.value);
      else {
        const source = nodes.get(binding.nodeId);
        if (!source || binding.nodeId === id || !dominators.get(id)!.has(binding.nodeId)) throw new ContractError('INVALID_REFERENCE', `${id} requires an earlier guaranteed output`);
        if (!Object.hasOwn(actionRegistry, source.actionType)) reject('UNSUPPORTED_ACTION', source.actionType);
        const sourceOutput = actionRegistry[source.actionType as ActionType].output.shape as Record<string, z.ZodType>;
        if (!Object.hasOwn(sourceOutput, binding.field)) reject('INVALID_REFERENCE', `Unknown output: ${binding.nodeId}.${binding.field}`);
        const sourceType = z.toJSONSchema(sourceOutput[binding.field]!).type;
        if (sourceType !== z.toJSONSchema(expected).type) reject('INCOMPATIBLE_REFERENCE', `Incompatible field: ${id}.${field}`);
      }
    }
  }
  if (workflow.nodes.length > workflow.budget.maxSteps || totalDuration > workflow.budget.maxDurationSeconds || totalCost > workflow.budget.maxCostUsd + Number.EPSILON) reject('BUDGET_EXCEEDED', 'Declared action budgets exceed the workflow limit');
  return { workflow, order, connectionRequirements };
}

export const workflowJsonSchema = z.toJSONSchema(WorkflowSchema);
