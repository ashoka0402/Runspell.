import type { FastifyRequest } from 'fastify';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

type Options = {
  issuer: string;
  audience: string;
  jwksUrl: string;
  resolveActor: (issuer: string, subject: string) => Promise<string | null>;
  verificationKey?: JWTVerifyGetKey;
};

function configuredUrl(value: string, label: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid OIDC ${label}`);
  }
  if (!value.startsWith('https://') || url.protocol !== 'https:' || url.username || url.password ||
      /[?#\\\x00-\x20\x7f]/.test(value)) {
    throw new Error(`Invalid OIDC ${label}`);
  }
  return url;
}

export function buildOidcAuthenticator({ issuer, audience, jwksUrl, resolveActor, verificationKey }: Options) {
  configuredUrl(issuer, 'issuer');
  const keysUrl = configuredUrl(jwksUrl, 'JWKS URL');
  if (!audience || /[^\x21-\x7e]/.test(audience)) throw new Error('Invalid OIDC audience');
  const keys = verificationKey ?? createRemoteJWKSet(keysUrl, { timeoutDuration: 3_000 });

  return async (request: FastifyRequest): Promise<string | null> => {
    const header = request.headers.authorization;
    if (typeof header !== 'string' || header.length > 8192) return null;
    const bearer = /^Bearer +([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(header);
    if (!bearer || bearer[0] !== header) return null;

    let subject: string | undefined;
    try {
      const { payload, protectedHeader } = await jwtVerify(bearer[1], keys, {
        algorithms: ['RS256'],
        issuer,
        audience,
        typ: 'at+jwt',
        requiredClaims: ['exp', 'iat', 'sub'],
        maxTokenAge: '15m',
      });
      if (protectedHeader.typ !== 'at+jwt') return null;
      const { iat, exp } = payload;
      if (typeof iat !== 'number' || typeof exp !== 'number' || !Number.isFinite(iat) || !Number.isFinite(exp) ||
          exp <= iat || exp - iat > 900) return null;
      subject = payload.sub;
    } catch {
      return null;
    }

    if (!subject || subject.length > 255 || /[^\x21-\x7e]/.test(subject)) return null;
    return resolveActor(issuer, subject);
  };
}
