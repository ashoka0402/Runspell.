import type { FastifyInstance } from 'fastify';

export const localClerkParties = ['http://127.0.0.1:8000', 'http://localhost:8000'];

export function localClerkConfig(publishableKey: string) {
  const encoded = /^pk_test_([A-Za-z0-9+/_-]+={0,2})$/.exec(publishableKey)?.[1];
  const decoded = encoded ? Buffer.from(encoded, 'base64').toString('utf8') : '';
  const hostname = /^([a-z0-9-]+\.clerk\.accounts\.dev)\$$/.exec(decoded)?.[1];
  if (!hostname) throw new Error('Set CLERK_PUBLISHABLE_KEY to a Clerk development publishable key.');
  return { provider: 'clerk' as const, publishableKey, frontendApi: `https://${hostname}` };
}

export function exposeLocalClerk(app: FastifyInstance, config: ReturnType<typeof localClerkConfig>) {
  app.addHook('onRequest', async (request, reply) => {
    if (request.method !== 'GET' && request.method !== 'OPTIONS') return;
    const path = request.url.split('?')[0];
    const allowedPath = path === '/api/v1/auth/config' || path === '/api/v1/me'
      || /^\/api\/v1\/workspaces\/[0-9a-f-]+\/runs(?:\/[0-9a-f-]+\/(?:evidence|receipt))?$/i.test(path);
    if (!allowedPath) return;

    const { origin } = request.headers;
    reply.header('Vary', 'Origin');
    if (!origin || !localClerkParties.includes(origin)) return;
    reply.header('Access-Control-Allow-Origin', origin);
    if (request.method === 'OPTIONS' && request.headers['access-control-request-method'] === 'GET') {
      return reply.header('Access-Control-Allow-Methods', 'GET')
        .header('Access-Control-Allow-Headers', 'Authorization')
        .code(204).send();
    }
  });
  app.options('/api/v1/*', (_request, reply) => reply.code(404).send());
  app.get('/api/v1/auth/config', (_request, reply) => {
    return reply.header('Cache-Control', 'no-store').send(config);
  });
}
