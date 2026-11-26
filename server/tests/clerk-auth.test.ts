import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FastifyRequest } from 'fastify';
import { generateKeyPair, SignJWT, type JWTPayload, type JWTHeaderParameters } from 'jose';
import { buildClerkAuthenticator } from '../src/clerk-auth.js';

const issuer = 'https://runspell-test.clerk.accounts.dev';
const origin = 'http://127.0.0.1:8000';
const actor = '9a643470-7f12-40b2-b7c7-e3d68357c10c';
const { privateKey, publicKey } = await generateKeyPair('RS256');
const options = { issuer, authorizedParties: [origin], verificationKey: async () => publicKey };

function request(authorization?: string, cookie?: string) {
  return { headers: { authorization, cookie } } as FastifyRequest;
}

function mint(claims: JWTPayload = {}, header: Partial<JWTHeaderParameters> = {}, signer = privateKey) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    iss: issuer, sub: 'user_123', sid: 'sess_123', azp: origin, v: 2,
    iat: now, nbf: now - 10, exp: now + 60, ...claims,
  }).setProtectedHeader({ alg: 'RS256', typ: 'JWT', cat: 'cl_B7d4PD111AAA', ...header }).sign(signer);
}

test('a valid Clerk v2 session resolves a provisioned actor using its issuer and subject', async () => {
  const resolved: Array<[string, string]> = [];
  const authenticate = buildClerkAuthenticator({
    ...options, resolveActor: async (iss, sub) => {
      resolved.push([iss, sub]);
      return sub === 'user_123' ? actor : null;
    },
  });
  assert.equal(await authenticate(request(`Bearer ${await mint()}`)), actor);
  assert.equal(await authenticate(request(`bearer ${await mint({ sub: 'user_456', sts: 'active' })}`)), null);
  assert.deepEqual(resolved, [[issuer, 'user_123'], [issuer, 'user_456']]);
});

test('invalid, non-session, pending and impersonated tokens never reach actor lookup', async () => {
  const authenticate = buildClerkAuthenticator({
    ...options, resolveActor: async () => assert.fail('An invalid Clerk token reached actor lookup'),
  });
  const now = Math.floor(Date.now() / 1000);
  const otherKey = await generateKeyPair('RS256');
  const machineJwt = mint({ sub: 'mch_123', sid: undefined }, { cat: 'cl_B7d4PD333AAA' });
  const symmetricJwt = new SignJWT({
    iss: issuer, sub: 'user_123', sid: 'sess_123', azp: origin, v: 2,
    iat: now, nbf: now, exp: now + 60,
  }).setProtectedHeader({ alg: 'HS256', typ: 'JWT', cat: 'cl_B7d4PD111AAA' }).sign(new Uint8Array(32));
  const invalid = await Promise.all([
    mint({ azp: 'http://127.0.0.1:8001' }),
    mint({ azp: undefined }),
    mint({ iss: 'https://different.clerk.accounts.dev' }),
    mint({ sub: undefined }),
    mint({ sub: 'invalid' }),
    mint({ sid: undefined }),
    mint({ sid: 'invalid' }),
    mint({ v: 1 }),
    mint({ v: '2' }),
    mint({ sts: 'pending' }),
    mint({ act: { sub: 'user_456', sid: 'sess_456' } }),
    mint({ nbf: now + 60 }),
    mint({ nbf: undefined }),
    mint({ exp: now - 1 }),
    mint({ exp: now + 301 }),
    mint({ iat: now + 60 }),
    mint({ iat: undefined }),
    mint({}, { typ: 'at+jwt' }),
    mint({}, { cat: undefined }),
    mint({}, { cat: 'cl_B7d4PD222AAA' }),
    mint({}, {}, otherKey.privateKey),
    machineJwt,
    symmetricJwt,
  ]);
  for (const token of invalid) assert.equal(await authenticate(request(`Bearer ${token}`)), null);
  assert.equal(await authenticate(request(undefined, `__session=${await mint()}`)), null);
  assert.equal(await authenticate(request(`Bearer ${'a'.repeat(8200)}`)), null);
});

test('Clerk configuration requires trusted origins and preserves lookup failures', async () => {
  const config = { ...options, resolveActor: async () => { throw new Error('lookup unavailable'); } };
  assert.throws(() => buildClerkAuthenticator({ ...config, issuer: 'http://insecure.example.test' }), /Invalid Clerk issuer/);
  assert.throws(() => buildClerkAuthenticator({ ...config, issuer: issuer + '/path' }), /Invalid Clerk issuer/);
  assert.throws(() => buildClerkAuthenticator({ ...config, authorizedParties: [] }), /Missing Clerk authorized parties/);
  assert.throws(() => buildClerkAuthenticator({ ...config, authorizedParties: ['http://insecure.example.test'] }), /Invalid Clerk authorized party/);
  assert.throws(() => buildClerkAuthenticator({ ...config, authorizedParties: [origin + '/app'] }), /Invalid Clerk authorized party/);
  const authenticate = buildClerkAuthenticator(config);
  await assert.rejects(authenticate(request(`Bearer ${await mint()}`)), /lookup unavailable/);
});
