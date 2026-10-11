import { createRemoteJWKSet, jwtVerify, errors } from "jose";
import type { CredentialVerifier } from "../../ports/outbound/index.ts";

interface Settings {
  readonly teamDomain: string;
  readonly audience: string;
}

export function createAccessSessionVerifierFactory() {
  const authorities = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
  return (settings: Settings): CredentialVerifier => ({
    async verify(credential) {
      if (!credential || credential.length > 8192)
        return { status: "unrecognized" };
      let keys = authorities.get(settings.teamDomain);
      if (!keys) {
        if (authorities.size >= 16)
          authorities.delete(authorities.keys().next().value!);
        keys = createRemoteJWKSet(
          new URL("/cdn-cgi/access/certs", settings.teamDomain),
          {
            timeoutDuration: 3000,
            cooldownDuration: 30000,
            cacheMaxAge: 300000,
          },
        );
        authorities.set(settings.teamDomain, keys);
      }
      try {
        const { payload } = await jwtVerify(credential, keys, {
          issuer: settings.teamDomain,
          audience: settings.audience,
          algorithms: ["RS256"],
          requiredClaims: ["iss", "aud", "sub", "exp", "iat"],
        });
        if (
          !payload.sub ||
          payload.sub.length > 512 ||
          !/^[A-Za-z0-9._~-]+$/.test(payload.sub) ||
          payload.type !== "app" ||
          typeof payload.iat !== "number" ||
          payload.iat > Date.now() / 1000 ||
          typeof payload.exp !== "number" ||
          payload.iat >= payload.exp
        )
          return { status: "unrecognized" };
        // Access admits the human; consent narrows the client's permissions later.
        return {
          status: "verified",
          callerId: payload.sub,
          permissions: ["connect", "read-memory", "write-memory"],
        };
      } catch (error) {
        if (
          error instanceof errors.JOSEError &&
          !(error instanceof errors.JWKSTimeout) &&
          !(error instanceof errors.JWKSInvalid)
        )
          return { status: "unrecognized" };
        return { status: "unavailable" };
      }
    },
  });
}
