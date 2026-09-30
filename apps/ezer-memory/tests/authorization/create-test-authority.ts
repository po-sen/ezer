import { env } from "cloudflare:workers";
import {
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWTHeaderParameters,
} from "jose";
import { vi } from "vitest";
import { createWorker } from "../../src/bootstrap/create-worker.ts";

export async function createTestAuthority() {
  const pair = await generateKeyPair("ES256");
  const policy = {
    issuer: "https://authority.test/",
    resource: "https://ezer.test/mcp",
    jwksUri: "https://authority.test/jwks",
    bindings: [
      { subject: "alice", individualId: "ezer-alice" },
      { subject: "alice-second-device", individualId: "ezer-alice" },
      { subject: "bob", individualId: "ezer-bob" },
    ],
  };
  const jwks = {
    keys: [
      {
        ...(await exportJWK(pair.publicKey)),
        kid: "synthetic-key",
        alg: "ES256",
        use: "sig",
      },
    ],
  };
  const fetchKeys = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input, init) => {
      if (String(input) !== policy.jwksUri || init?.redirect !== "manual")
        throw new Error("Unexpected network request in test");
      return Response.json(jwks);
    });
  const worker = createWorker();
  return {
    policy,
    jwks,
    fetchKeys,
    async sign(
      claims: Record<string, unknown> = {},
      header: Partial<JWTHeaderParameters> = {},
      key: CryptoKey | Uint8Array = pair.privateKey,
    ) {
      const now = Math.floor(Date.now() / 1000);
      return new SignJWT({
        iss: policy.issuer,
        aud: policy.resource,
        sub: "alice",
        iat: now,
        exp: now + 300,
        jti: crypto.randomUUID(),
        client_id: "synthetic-client",
        scope: "ezer:connect",
        ...claims,
      })
        .setProtectedHeader({
          alg: "ES256",
          typ: "at+jwt",
          kid: "synthetic-key",
          ...header,
        })
        .sign(key);
    },
    request(
      request: Request,
      configuration: Env["EZER_AUTHORIZATION"] = policy,
    ) {
      return worker.fetch!(request, {
        EZER_MEMORY: env.EZER_MEMORY,
        EZER_AUTHORIZATION: configuration,
      });
    },
  };
}
