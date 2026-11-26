import type { FastifyRequest } from 'fastify';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

type Options = {
  issuer: string;
  authorizedParties: readonly string[];
  resolveActor: (issuer: string, subject: string) => Promise<string | null>;
  verificationKey?: JWTVerifyGetKey;
};

const sessionCategory = 'cl_B7d4PD111AAA';
const maxSessionAge = 300;

function configuredOrigin(value: string, label: string, allowLoopbackHttp = false): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid Clerk ${label}`);
  }
  const isLocalHttp = allowLoopbackHttp && url.protocol === 'http:' &&
    ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (value !== url.origin || (url.protocol !== 'https:' && !isLocalHttp)) {
    throw new Error(`Invalid Clerk ${label}`);
  }
  return url;
}

export function buildClerkAuthenticator({ issuer, authorizedParties, resolveActor, verificationKey }: Options) {
  const instance = configuredOrigin(issuer, 'issuer');
  if (!authorizedParties.length) throw new Error('Missing Clerk authorized parties');
  const origins = new Set(authorizedParties.map((origin) => configuredOrigin(origin, 'authorized party', true).origin));
  const jwksUrl = new URL('/.well-known/jwks.json', instance);
  const keys = verificationKey ?? createRemoteJWKSet(jwksUrl, { timeoutDuration: 3_000 });

  return async (request: FastifyRequest): Promise<string | null> => {
    const header = request.headers.authorization;
    if (typeof header !== 'string' || header.length > 8192) return null;
    const bearer = /^Bearer +([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(header);
    if (!bearer || bearer[0] !== header) return null;

    let subject: string;
    try {
      const { payload, protectedHeader } = await jwtVerify(bearer[1], keys, {
        algorithms: ['RS256'],
        issuer,
        typ: 'JWT',
        requiredClaims: ['exp', 'iat', 'nbf', 'sub', 'sid', 'azp', 'v'],
        maxTokenAge: maxSessionAge,
      });
      // Clerk signs different token categories with the same instance key.
      if (protectedHeader.cat !== sessionCategory || protectedHeader.typ !== 'JWT') return null;

      const { iat, exp, nbf, azp, sid, sub } = payload;
      if (typeof iat !== 'number' || typeof exp !== 'number' || !Number.isFinite(iat) || !Number.isFinite(exp) ||
          !Number.isFinite(nbf) || exp <= iat || exp - iat > maxSessionAge) return null;
      if (payload.v !== 2 || payload.act !== undefined ||
          (payload.sts !== undefined && payload.sts !== 'active')) return null;
      if (typeof azp !== 'string' || !origins.has(azp) ||
          typeof sid !== 'string' || !/^sess_[A-Za-z0-9]{1,250}$/.test(sid) ||
          typeof sub !== 'string' || !/^user_[A-Za-z0-9]{1,250}$/.test(sub)) return null;
      subject = sub;
    } catch {
      return null;
    }
    return resolveActor(issuer, subject);
  };
}
