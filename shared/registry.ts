import { z } from 'zod';

export const IdentifierSchema = z.string().regex(/^(?!(?:constructor|prototype)$)[a-z][a-z0-9_]{0,63}$/);
export const FieldNameSchema = z.string().regex(/^(?!(?:constructor|prototype)$)[A-Za-z][A-Za-z0-9_]{0,63}$/);
export const HttpsUrlSchema = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password && !url.hash;
}, 'An HTTPS URL without credentials or fragment is required');

export const ManifestSchema = z.strictObject({
  actionType: z.string().regex(/^[a-z]+\.[a-z_]+$/),
  version: z.literal(1),
  runtime: z.enum(['browser', 'api', 'engine', 'human']),
  sideEffect: z.enum(['read_only', 'idempotent_write', 'unsafe_write']),
  connection: z.enum(['browser', 'api']).nullable(),
  scopes: z.array(z.string().min(1)).max(10),
  budget: z.strictObject({ maxDurationSeconds: z.number().int().positive().max(3600), maxCostUsd: z.number().nonnegative().max(10) }),
  retry: z.enum(['safe', 'verify_before_retry', 'never']),
  evidence: z.array(z.enum(['structured_output', 'masked_screenshot', 'artifact', 'external_reference', 'decision'])).min(1),
  configSchema: z.record(z.string(), z.json()),
  inputSchema: z.record(z.string(), z.json()),
  outputSchema: z.record(z.string(), z.json()),
}).superRefine((manifest, context) => {
  if (manifest.sideEffect === 'unsafe_write' && manifest.retry === 'safe') {
    context.addIssue({ code: 'custom', message: 'Unsafe writes cannot declare automatic safe retries' });
  }
  if (manifest.connection && manifest.runtime !== manifest.connection) {
    context.addIssue({ code: 'custom', message: 'Connection kind must match runtime' });
  }
});

const actionDefinitions = {
  'browser.navigate': {
    config: z.strictObject({ url: HttpsUrlSchema }),
    input: z.strictObject({}), output: z.strictObject({ url: z.string() }),
    runtime: 'browser', connection: 'browser', scopes: ['browser:read'], sideEffect: 'read_only', retry: 'safe', evidence: ['masked_screenshot'],
  },
  'browser.read_invoice': {
    config: z.strictObject({ invoiceIdSelector: z.string().min(1).max(256), amountSelector: z.string().min(1).max(256) }),
    input: z.strictObject({}), output: z.strictObject({ invoiceId: z.string(), amount: z.number() }),
    runtime: 'browser', connection: 'browser', scopes: ['browser:read'], sideEffect: 'read_only', retry: 'safe', evidence: ['structured_output'],
  },
  'condition.compare': {
    config: z.strictObject({ operator: z.literal('gt'), threshold: z.number() }),
    input: z.strictObject({ value: z.number() }), output: z.strictObject({ result: z.boolean() }),
    runtime: 'engine', connection: null, scopes: [], sideEffect: 'read_only', retry: 'safe', evidence: ['structured_output'],
  },
  'human.approval': {
    config: z.strictObject({ expiresInSeconds: z.number().int().positive().max(86400) }),
    input: z.strictObject({ invoiceId: z.string(), amount: z.number() }), output: z.strictObject({ approved: z.boolean() }),
    runtime: 'human', connection: null, scopes: [], sideEffect: 'read_only', retry: 'never', evidence: ['decision'],
  },
  'browser.download': {
    config: z.strictObject({ selector: z.string().min(1).max(256) }),
    input: z.strictObject({}), output: z.strictObject({ artifactId: z.string() }),
    runtime: 'browser', connection: 'browser', scopes: ['browser:read'], sideEffect: 'unsafe_write', retry: 'verify_before_retry', evidence: ['artifact'],
  },
  'api.request': {
    config: z.strictObject({ url: HttpsUrlSchema, method: z.enum(['GET', 'POST']) }),
    input: z.strictObject({ invoiceId: z.string(), artifactId: z.string() }), output: z.strictObject({ status: z.number(), externalId: z.string() }),
    runtime: 'api', connection: 'api', scopes: ['api:request'], sideEffect: 'unsafe_write', retry: 'verify_before_retry', evidence: ['external_reference'],
  },
} as const;

export type ActionType = keyof typeof actionDefinitions;
export const actionRegistry = Object.fromEntries(Object.entries(actionDefinitions).map(([actionType, definition]) => {
  const manifest = ManifestSchema.parse({
    actionType, version: 1, runtime: definition.runtime, connection: definition.connection,
    scopes: definition.scopes, sideEffect: definition.sideEffect, retry: definition.retry, evidence: definition.evidence,
    // Fixture admission budgets are declarations, not measured provider prices or approval wait time.
    budget: { maxDurationSeconds: definition.runtime === 'human' ? 10 : 30, maxCostUsd: .05 },
    configSchema: z.toJSONSchema(definition.config), inputSchema: z.toJSONSchema(definition.input), outputSchema: z.toJSONSchema(definition.output),
  });
  return [actionType, { manifest, config: definition.config, input: definition.input, output: definition.output }];
})) as { [K in ActionType]: { manifest: z.infer<typeof ManifestSchema> } & typeof actionDefinitions[K] };

export const manifestSchemas = Object.values(actionRegistry).map((entry) => entry.manifest);
