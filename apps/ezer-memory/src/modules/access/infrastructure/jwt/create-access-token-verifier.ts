import { createRemoteJWKSet, jwtVerify, errors } from "jose";
import type { AccessTokenVerifier } from "../../ports/outbound/index.ts";

export function createAccessTokenVerifier(): AccessTokenVerifier {
  const authorities = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
  return {
    async verify(token, authority) {
      let keys = authorities.get(authority.jwksUri);
      if (!keys) {
        if (authorities.size >= 16)
          authorities.delete(authorities.keys().next().value!);
        keys = createRemoteJWKSet(new URL(authority.jwksUri), {
          timeoutDuration: 3000,
          cooldownDuration: 30000,
          cacheMaxAge: 300000,
        });
        authorities.set(authority.jwksUri, keys);
      }
      try {
        const { payload } = await jwtVerify(token, keys, {
          issuer: authority.issuer,
          audience: authority.resource,
          algorithms: ["RS256", "ES256"],
          typ: "at+jwt",
          requiredClaims: [
            "iss",
            "aud",
            "sub",
            "exp",
            "iat",
            "jti",
            "client_id",
          ],
        });
        if (
          typeof payload.sub !== "string" ||
          !payload.sub ||
          payload.sub.length > 512 ||
          typeof payload.client_id !== "string" ||
          !payload.client_id ||
          typeof payload.jti !== "string" ||
          !payload.jti ||
          typeof payload.iat !== "number" ||
          !Number.isFinite(payload.iat) ||
          payload.iat > Math.floor(Date.now() / 1000) ||
          typeof payload.exp !== "number" ||
          payload.iat > payload.exp ||
          (payload.scope !== undefined && typeof payload.scope !== "string")
        )
          return;
        return {
          subject: payload.sub,
          scopes:
            typeof payload.scope === "string" ? payload.scope.split(" ") : [],
        };
      } catch (error) {
        if (
          error instanceof errors.JWTClaimValidationFailed ||
          error instanceof errors.JWTExpired ||
          error instanceof errors.JWTInvalid ||
          error instanceof errors.JWSInvalid ||
          error instanceof errors.JWSSignatureVerificationFailed ||
          error instanceof errors.JOSEAlgNotAllowed ||
          error instanceof errors.JOSENotSupported ||
          error instanceof errors.JWKSNoMatchingKey
        )
          return;
        // Provider/network failures are masked by the application as UNAVAILABLE.
        throw new Error("Access token verification unavailable");
      }
    },
  };
}
