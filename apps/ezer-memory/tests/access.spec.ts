import { env, exports } from "cloudflare:workers";
import { evictDurableObject } from "cloudflare:test";
import { exportJWK, generateKeyPair } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAccessControl } from "../src/modules/access/application/index.ts";
import { createAccessPolicyReader } from "../src/modules/access/infrastructure/configuration/index.ts";
import { createTestAuthority } from "./authorization/index.ts";

afterEach(() => vi.restoreAllMocks());

function request(
  token?: string,
  args: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  return new Request("https://ezer.test/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-11-25",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "ezer_identity", arguments: args },
    }),
  });
}

async function rpc(response: Response) {
  expect(response.status).toBe(200);
  const text = await response.text();
  const data = response.headers
    .get("Content-Type")
    ?.includes("text/event-stream")
    ? text
        .split("\n")
        .find((line) => line.startsWith("data: "))
        ?.slice(6)
    : text;
  return JSON.parse(data!);
}

describe("authenticated Ezer identity", () => {
  it("fails closed when deployed without an authorization policy", async () => {
    const response = await exports.default.fetch(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "temporarily_unavailable" });
    expect(
      (await exports.default.fetch("https://ezer.test/health")).status,
    ).toBe(200);
  });

  it("publishes protected-resource metadata and a discoverable authentication challenge", async () => {
    const authority = await createTestAuthority();
    const metadataUrl =
      "https://ezer.test/.well-known/oauth-protected-resource/mcp";
    const metadata = await authority.request(new Request(metadataUrl));
    expect(metadata.status).toBe(200);
    expect(await metadata.json()).toEqual({
      resource: authority.policy.resource,
      authorization_servers: [authority.policy.issuer],
      scopes_supported: [
        "ezer:connect",
        "ezer:memory:read",
        "ezer:memory:write",
      ],
      bearer_methods_supported: ["header"],
    });
    const denied = await authority.request(request());
    expect(denied.status).toBe(401);
    expect(denied.headers.get("WWW-Authenticate")).toBe(
      `Bearer resource_metadata="${metadataUrl}", scope="ezer:connect"`,
    );
    expect(denied.headers.get("Cache-Control")).toBe("no-store");
    expect(authority.fetchKeys).not.toHaveBeenCalled();
    expect(
      (await authority.request(new Request(metadataUrl, { method: "POST" })))
        .status,
    ).toBe(405);
  });

  it("keeps identity across new tokens, clients, and MCP sessions while isolating individuals", async () => {
    const authority = await createTestAuthority();
    for (const [subject, expected] of [
      ["alice", "ezer-alice"],
      ["bob", "ezer-bob"],
      ["alice-second-device", "ezer-alice"],
      ["alice", "ezer-alice"],
    ] as const) {
      const token = await authority.sign({
        sub: subject,
        client_id: crypto.randomUUID(),
        individual_id: "ezer-bob",
        owner: "bob",
      });
      const response = await authority.request(
        request(
          token,
          {},
          {
            "Mcp-Session-Id": crypto.randomUUID(),
            "X-Ezer-Id": "ezer-bob",
            "X-User-Id": "bob",
          },
        ),
      );
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect((await rpc(response)).result.structuredContent).toEqual({
        individualId: expected,
        changeSequence: 0,
      });
    }
    // JWTs and request credentials are never forwarded to the key server.
    expect(authority.fetchKeys).toHaveBeenCalledTimes(1);
    const [, init] = authority.fetchKeys.mock.calls[0]!;
    expect(new Headers(init?.headers).has("Authorization")).toBe(false);
  });

  it("rejects identity selectors, query credentials, and foreign origins", async () => {
    const authority = await createTestAuthority();
    const token = await authority.sign();
    expect(
      (
        await rpc(
          await authority.request(request(token, { individualId: "ezer-bob" })),
        )
      ).result.isError,
    ).toBe(true);
    for (const query of [
      "individualId=ezer-bob",
      "access_token=synthetic",
      "owner=bob",
    ]) {
      const incoming = request(token);
      const response = await authority.request(
        new Request(`https://ezer.test/mcp?${query}`, incoming),
      );
      expect(response.status).toBe(400);
    }
    expect(
      (
        await authority.request(
          request(token, {}, { Origin: "https://foreign.test" }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await authority.request(
          new Request("https://foreign.test/mcp", request(token)),
        )
      ).status,
    ).toBe(404);
  });

  it("binds each verifier to its configured authority even when public keys are cached", async () => {
    const authority = await createTestAuthority();
    const token = await authority.sign();
    expect((await authority.request(request(token))).status).toBe(200);
    const changedIssuer = {
      ...authority.policy,
      issuer: "https://second-issuer.test/",
    };
    expect(
      (await authority.request(request(token), changedIssuer)).status,
    ).toBe(401);
    expect(
      (
        await authority.request(
          request(await authority.sign({ iss: changedIssuer.issuer })),
          changedIssuer,
        )
      ).status,
    ).toBe(200);
    const changedAudience = {
      ...authority.policy,
      resource: "https://second-resource.test/mcp",
    };
    expect(
      (
        await authority.request(
          new Request(changedAudience.resource, request(token)),
          changedAudience,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await authority.request(
          new Request(
            changedAudience.resource,
            request(await authority.sign({ aud: changedAudience.resource })),
          ),
          changedAudience,
        )
      ).status,
    ).toBe(200);
    expect(authority.fetchKeys).toHaveBeenCalledTimes(1);
  });

  it("routes authorized identities to persistent, separate memory objects after eviction", async () => {
    const authority = await createTestAuthority();
    const aliceId = `alice-${crypto.randomUUID()}`;
    const bobId = `bob-${crypto.randomUUID()}`;
    const policy = {
      ...authority.policy,
      bindings: [
        { subject: "alice", individualId: aliceId },
        { subject: "alice-second-device", individualId: aliceId },
        { subject: "bob", individualId: bobId },
      ],
    };
    const aliceMemory = env.EZER_MEMORY.getByName(`ezer:v1:${aliceId}`);
    const bobMemory = env.EZER_MEMORY.getByName(`ezer:v1:${bobId}`);
    const written = await aliceMemory.commit({
      kind: "remember",
      operationId: "synthetic-write",
      memoryId: "synthetic-memory",
      body: "Synthetic private memory",
      source: { reference: "test:binding", excerpt: "Synthetic source" },
    });
    expect(written.ok).toBe(true);
    expect(await bobMemory.inspect({ memoryId: "synthetic-memory" })).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    for (const [subject, individualId, changeSequence] of [
      ["alice", aliceId, 1],
      ["bob", bobId, 0],
      ["alice-second-device", aliceId, 1],
    ] as const) {
      const response = await authority.request(
        request(await authority.sign({ sub: subject, individual_id: bobId })),
        policy,
      );
      expect((await rpc(response)).result.structuredContent).toEqual({
        individualId,
        changeSequence,
      });
    }
    await evictDurableObject(aliceMemory);
    const recovered = await authority.request(
      request(await authority.sign()),
      policy,
    );
    expect((await rpc(recovered)).result.structuredContent).toEqual({
      individualId: aliceId,
      changeSequence: 1,
    });
    // The public identity operation cannot read or modify memory contents.
    const forbidden = request(await authority.sign());
    const payload = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "ezer_remember", arguments: { individualId: bobId } },
    };
    const denied = await authority.request(
      new Request(forbidden, { body: JSON.stringify(payload) }),
      policy,
    );
    const result = await rpc(denied);
    expect(Boolean(result.error || result.result?.isError)).toBe(true);
    expect(await aliceMemory.inspectState()).toEqual({
      ok: true,
      value: { changeSequence: 1 },
    });
    expect(await bobMemory.inspectState()).toEqual({
      ok: true,
      value: { changeSequence: 0 },
    });
  });

  it("denies unknown principals and requires the connection scope", async () => {
    const authority = await createTestAuthority();
    const unknown = await authority.request(
      request(await authority.sign({ sub: "unregistered" })),
    );
    expect(unknown.status).toBe(403);
    expect(await unknown.json()).toEqual({ error: "access_denied" });
    for (const scope of [undefined, "", "ezer:connect-other", "memory:read"]) {
      const denied = await authority.request(
        request(await authority.sign({ scope })),
      );
      expect(denied.status).toBe(403);
      expect(denied.headers.get("WWW-Authenticate")).toContain(
        'error="insufficient_scope"',
      );
    }
  });

  it.each([
    ["wrong issuer", { iss: "https://foreign.test/" }],
    ["wrong audience", { aud: "https://other-ezer.test/mcp" }],
    ["expired", { exp: 1 }],
    ["not active", { nbf: 9999999999 }],
    ["future issuance", { iat: 9999999999, exp: 99999999999 }],
    ["missing expiry", { exp: undefined }],
    ["missing issuance", { iat: undefined }],
    ["missing subject", { sub: undefined }],
    ["missing client", { client_id: undefined }],
    ["missing token ID", { jti: undefined }],
    ["empty subject", { sub: "" }],
    ["invalid scope", { scope: ["ezer:connect"] }],
  ] satisfies [string, Record<string, unknown>][])(
    "rejects %s access tokens",
    async (_name, claims) => {
      const authority = await createTestAuthority();
      const response = await authority.request(
        request(await authority.sign(claims)),
      );
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "invalid_token" });
      expect(response.headers.get("WWW-Authenticate")).toContain(
        'error="invalid_token"',
      );
    },
  );

  it("rejects ID tokens, unknown keys, wrong signatures, symmetric tokens, and malformed credentials", async () => {
    const authority = await createTestAuthority();
    const other = await generateKeyPair("ES256");
    const invalid = [
      await authority.sign({}, { typ: "JWT" }),
      await authority.sign({}, { kid: "unknown-key" }),
      await authority.sign({}, {}, other.privateKey),
      await authority.sign({}, { alg: "HS256" }, new Uint8Array(32).fill(7)),
      "not-a-jwt",
    ];
    for (const token of invalid)
      expect((await authority.request(request(token))).status).toBe(401);
    for (const authorization of [
      "Basic synthetic",
      "Bearer",
      "Bearer a,b",
      "Bearer " + "x".repeat(8193),
    ]) {
      expect(
        (
          await authority.request(
            request(undefined, {}, { Authorization: authorization }),
          )
        ).status,
      ).toBe(401);
    }
  });

  it("supports RSA access tokens and the full access-token media type", async () => {
    const authority = await createTestAuthority();
    const pair = await generateKeyPair("RS256");
    authority.jwks.keys.push({
      ...(await exportJWK(pair.publicKey)),
      kid: "rsa-key",
      alg: "RS256",
      use: "sig",
    });
    const token = await authority.sign(
      {},
      { alg: "RS256", kid: "rsa-key", typ: "application/at+jwt" },
      pair.privateKey,
    );
    expect(
      (
        await rpc(
          await authority.request(
            request(token, {}, { Authorization: `bEaReR   ${token}` }),
          ),
        )
      ).result.structuredContent,
    ).toEqual({ individualId: "ezer-alice", changeSequence: 0 });
  });

  it("masks provider failures without falling back to an unauthenticated connection", async () => {
    const authority = await createTestAuthority();
    authority.fetchKeys.mockRejectedValue(
      new Error("synthetic provider failure"),
    );
    const response = await authority.request(request(await authority.sign()));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "temporarily_unavailable" });
  });

  it("checks current grants on every request even when the token and signing keys are cached", async () => {
    const authority = await createTestAuthority();
    const token = await authority.sign();
    expect(
      (await rpc(await authority.request(request(token)))).result.isError,
    ).not.toBe(true);
    const removed = {
      ...authority.policy,
      bindings: authority.policy.bindings.filter(
        (binding) => binding.subject !== "alice",
      ),
    };
    expect((await authority.request(request(token), removed)).status).toBe(403);
    expect(authority.fetchKeys).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed or ambiguous operator policies before token verification", async () => {
    const authority = await createTestAuthority();
    const invalid = [
      {},
      { ...authority.policy, issuer: "http://authority.test/" },
      { ...authority.policy, resource: "https://ezer.test/other" },
      {
        ...authority.policy,
        jwksUri: "https://user:placeholder@authority.test/jwks",
      },
      { ...authority.policy, bindings: [] },
      {
        ...authority.policy,
        bindings: [{ subject: "alice", individualId: "../bob" }],
      },
      {
        ...authority.policy,
        bindings: [
          ...authority.policy.bindings,
          { subject: "alice", individualId: "ezer-bob" },
        ],
      },
    ];
    for (const configuration of invalid)
      expect((await authority.request(request(), configuration)).status).toBe(
        503,
      );
    expect(authority.fetchKeys).not.toHaveBeenCalled();
  });

  it("keeps transport and provider details outside the authorization application", async () => {
    const authority = await createTestAuthority();
    const access = createAccessControl(
      createAccessPolicyReader(authority.policy.bindings),
      {
        verify: async (credential) =>
          credential
            ? { status: "verified", callerId: "bob", permissions: ["connect"] }
            : { status: "unrecognized" },
      },
    );
    expect(await access.authorize("synthetic")).toEqual({
      ok: true,
      individual: {
        individualId: "ezer-bob",
        capabilities: { readMemory: false, writeMemory: false },
      },
    });
    expect(await access.authorize(null)).toEqual({
      ok: false,
      code: "UNRECOGNIZED_CREDENTIAL",
    });
  });
});
