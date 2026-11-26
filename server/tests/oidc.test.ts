import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FastifyRequest } from 'fastify';
import { generateKeyPair, SignJWT, type JWTPayload } from 'jose';
import { buildOidcAuthenticator } from '../src/oidc.js';

const issuer = 'https://identity.example.test/tenant';
const audience = 'https://api.example.test';
const jwksUrl = 'https://keys.example.test/jwks.json';
const actorId = '9a643470-7f12-40b2-b7c7-e3d68357c10c';
const { privateKey, publicKey } = await generateKeyPair('RS256');
const verificationKey = async () => publicKey;

function request(authorization?: string) {
  return { headers: { authorization } } as FastifyRequest;
}

function mint(claims: JWTPayload = {}, typ = 'at+jwt', signer = privateKey) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ iss: issuer, aud: audience, sub: 'provisioned', iat: now, exp: now + 300, ...claims })
    .setProtectedHeader({ alg: 'RS256', typ })
    .sign(signer);
}

test('verified access tokens resolve only a provisioned issuer and subject', async () => {
  const resolved: Array<[string, string]> = [];
  const authenticate = buildOidcAuthenticator({
    issuer, audience, jwksUrl, verificationKey,
    resolveActor: async (iss, sub) => {
      resolved.push([iss, sub]);
      return sub === 'provisioned' ? actorId : null;
    },
  });

  assert.equal(await authenticate(request(`bearer ${await mint()}`)), actorId);
  assert.equal(await authenticate(request(`Bearer ${await mint({ sub: 'unknown' })}`)), null);
  assert.deepEqual(resolved, [[issuer, 'provisioned'], [issuer, 'unknown']]);
});

test('rejected tokens do not reach the actor lookup', async () => {
  const authenticate = buildOidcAuthenticator({
    issuer, audience, jwksUrl, verificationKey,
    resolveActor: async () => assert.fail('An invalid token reached the actor lookup'),
  });
  const now = Math.floor(Date.now() / 1000);
  const otherKey = await generateKeyPair('RS256');
  const otherAlgorithm = await new SignJWT({ iss: issuer, aud: audience, sub: 'provisioned', iat: now, exp: now + 300 })
    .setProtectedHeader({ alg: 'HS256', typ: 'at+jwt' })
    .sign(new Uint8Array(32));

  for (const token of await Promise.all([
    mint({ iss: issuer + '/different' }),
    mint({ aud: 'another-api' }),
    mint({ exp: now - 1 }),
    mint({ iat: now - 901, exp: now - 1 }),
    mint({ iat: now + 60, exp: now + 300 }),
    mint({ nbf: now + 60 }),
    mint({ iat: now, exp: now + 901 }),
    mint({ iat: now, exp: now }),
    mint({ iat: undefined }),
    mint({ exp: undefined }),
    mint({ sub: undefined }),
    mint({ sub: 'x'.repeat(256) }),
    mint({ sub: 'subject with spaces' }),
    mint({}, 'JWT'),
    mint({}, 'at+jwt', otherKey.privateKey),
    otherAlgorithm,
  ])) {
    assert.equal(await authenticate(request(`Bearer ${token}`)), null);
  }
  for (const malformed of [undefined, 'Basic abc', 'Bearer a.b.c,d.e.f', `Bearer ${'a'.repeat(8200)}`]) {
    assert.equal(await authenticate(request(malformed)), null);
  }
});

test('OIDC configuration fails closed and actor lookup failures propagate', async () => {
  const options = {
    issuer, audience, jwksUrl, verificationKey,
    resolveActor: async () => { throw new Error('lookup unavailable'); },
  };
  assert.throws(() => buildOidcAuthenticator({ ...options, issuer: 'http://identity.example.test' }), /Invalid OIDC issuer/);
  assert.throws(() => buildOidcAuthenticator({ ...options, jwksUrl: 'https://user@keys.example.test' }), /Invalid OIDC JWKS URL/);
  assert.throws(() => buildOidcAuthenticator({ ...options, audience: '' }), /Invalid OIDC audience/);
  const authenticate = buildOidcAuthenticator(options);
  await assert.rejects(authenticate(request(`Bearer ${await mint()}`)), /lookup unavailable/);
});
