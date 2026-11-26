import { z } from 'zod';
import { manifestSchemas, WorkflowSchema, type Workflow } from '../../shared/index.js';
import type { PlannerInput } from './gemini.js';

export const definitionSchema = WorkflowSchema.omit({ id: true, workspaceId: true }).extend({
  name: z.string().trim().min(1).max(100),
});
export const revisionSchema = z.int().min(0).max(2147483647);
export const promptSchema = z.string().trim().min(1).max(4_000);
const assumptions = z.array(z.string().trim().min(1).max(350)).max(8);
const explanation = z.string().trim().min(1).max(750);
export const plannerOutput = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('candidate'), definition: definitionSchema, assumptions }),
  z.strictObject({ status: z.literal('clarification'), message: explanation }),
  z.strictObject({ status: z.literal('unsupported'), message: explanation }),
]);

const catalog = manifestSchemas.map(({ actionType, version, connection, scopes, configSchema, inputSchema, outputSchema, budget }) => ({
  actionType, version, connection, scopes, configSchema, inputSchema, outputSchema, budget,
}));

export function plannerInput(prompt: string, origins: string[], current?: Workflow): PlannerInput {
  return {
    prompt, allowedOrigins: origins, catalog,
    current: current && {
      name: current.name, triggers: current.triggers, edges: current.edges, budget: current.budget,
      nodes: current.nodes.map(({ id, label, actionType, actionVersion, config, inputs }) => ({
        id, label, actionType, actionVersion,
        configKeys: Object.keys(config),
        inputBindings: Object.fromEntries(Object.entries(inputs).map(([field, binding]) => [
          field, binding.kind === 'output' ? binding : { kind: 'literal' },
        ])),
      })),
    },
  };
}

export function restoreUnchangedValues(definition: z.infer<typeof definitionSchema>, current: Workflow) {
  return {
    ...definition,
    nodes: definition.nodes.map((node) => {
      const prior = current.nodes.find(({ id, actionType }) => id === node.id && actionType === node.actionType);
      if (!prior) return node;
      return { ...node, config: { ...prior.config, ...node.config }, inputs: { ...prior.inputs, ...node.inputs } };
    }),
  };
}
