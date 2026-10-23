import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { generateKeyPair } from "jose";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { createOAuthFixture } from "./oauth/index.ts";

afterEach(() => vi.restoreAllMocks());

async function connect(
  h: Awaited<ReturnType<typeof createOAuthFixture>>,
  token: string,
) {
  const client = new Client({
    name: "Synthetic OAuth client",
    version: "1.0.0",
  });
  onTestFinished(() => client.close());
  await client.connect(
    new StreamableHTTPClientTransport(new URL(h.policy.resource), {
      fetch: (input, init) => {
        const request = new Request(input, init);
        request.headers.set("Authorization", `Bearer ${token}`);
        request.headers.set("X-Ezer-Id", h.policy.bindings[1]!.individualId);
        return h.request(request.url, request);
      },
    }),
  );
  return client;
}

describe("Cloudflare Access and OAuth authorization", () => {
  it("requires explicit restore consent and keeps ordinary read/write grants insufficient", async () => {
    const h = await createOAuthFixture();
    const login = await h.begin({
      scope: ["ezer:connect", "ezer:memory:restore"],
    });
    expect(login.html).toContain('value="ezer:memory:restore">');
    expect(login.html).not.toContain('value="ezer:memory:restore" checked');
    const command = {
      name: "ezer_restore",
      arguments: {
        restoreId: "empty",
        page: {
          format: "ezer-memory",
          formatVersion: 1,
          individualId: h.policy.bindings[0]!.individualId,
          snapshotSequence: 0,
          revisions: [],
          nextCursor: null,
        },
      },
    };
    const ordinary = await h.grant();
    const writer = await connect(h, ordinary.tokens.access_token);
    expect((await writer.callTool(command)).content).toEqual([
      { type: "text", text: "RESTORE_NOT_GRANTED" },
    ]);
    const allowed = await h.grant({
      scope: ["ezer:connect", "ezer:memory:restore"],
    });
    const restorer = await connect(h, allowed.tokens.access_token);
    expect((await restorer.callTool(command)).structuredContent).toMatchObject({
      complete: true,
    });
    expect(
      (await restorer.callTool({ name: "ezer_export", arguments: {} })).content,
    ).toEqual([{ type: "text", text: "READ_NOT_GRANTED" }]);
  });
  it("advertises a complete login flow without requiring an Access browser session for protocol endpoints", async () => {
    const h = await createOAuthFixture();
    const denied = await h.request("/mcp");
    expect(denied.status).toBe(401);
    expect(denied.headers.get("WWW-Authenticate")).toContain(
      h.scopes.join(" "),
    );
    expect(
      await (
        await h.request("/.well-known/oauth-protected-resource/mcp")
      ).json(),
    ).toMatchObject({
      resource: h.policy.resource,
      authorization_servers: [h.origin],
      scopes_supported: h.scopes,
    });
    const metadata = await (
      await h.request("/.well-known/oauth-authorization-server")
    ).json();
    expect(metadata).toMatchObject({
      issuer: h.origin,
      authorization_endpoint: `${h.origin}/authorize`,
      token_endpoint: `${h.origin}/oauth/token`,
      registration_endpoint: `${h.origin}/oauth/register`,
      revocation_endpoint: `${h.origin}/oauth/token`,
      code_challenge_methods_supported: ["S256"],
    });
    expect(
      (
        await h.request(
          "https://foreign.test/.well-known/oauth-authorization-server",
        )
      ).status,
    ).toBe(404);
    expect((await h.request("/authorize")).status).toBe(403);
  });

  it("authorizes independent clients to the same Ezer and enforces approved memory permissions and isolation", async () => {
    const h = await createOAuthFixture();
    const writerGrant = await h.grant();
    const writer = await connect(h, writerGrant.tokens.access_token);
    expect(
      (await writer.callTool({ name: "ezer_identity", arguments: {} }))
        .structuredContent,
    ).toMatchObject({ individualId: h.policy.bindings[0]!.individualId });
    const args = {
      operationId: "save-synthetic",
      memoryId: "plan",
      body: "Synthetic continuity memory",
      source: { reference: "test:oauth", excerpt: "Synthetic evidence" },
    };
    expect(
      (await writer.callTool({ name: "ezer_remember", arguments: args }))
        .isError,
    ).not.toBe(true);
    const readerGrant = await h.grant({
      scope: ["ezer:connect", "ezer:memory:read"],
    });
    expect(readerGrant.tokens.refresh_token).toBeUndefined();
    const reader = await connect(h, readerGrant.tokens.access_token);
    expect(
      (
        await reader.callTool({
          name: "ezer_read",
          arguments: { memoryId: "plan" },
        })
      ).structuredContent,
    ).toMatchObject({ memory: { body: args.body } });
    expect(
      (
        await reader.callTool({
          name: "ezer_remember",
          arguments: { ...args, operationId: "forbidden" },
        })
      ).isError,
    ).toBe(true);
    const other = await connect(
      h,
      (await h.grant({ subject: "bob" })).tokens.access_token,
    );
    expect(
      (
        await other.callTool({
          name: "ezer_read",
          arguments: { memoryId: "plan" },
        })
      ).isError,
    ).toBe(true);
    const connectOnly = await connect(
      h,
      (await h.grant({ scope: ["ezer:connect"] })).tokens.access_token,
    );
    expect(
      (await connectOnly.callTool({ name: "ezer_list", arguments: {} }))
        .isError,
    ).toBe(true);
    const rebound = {
      ...h.policy,
      bindings: [{ subject: "alice", individualId: "different-ezer" }],
    };
    expect(
      (
        await h.request(
          "/mcp",
          {
            headers: {
              Authorization: `Bearer ${writerGrant.tokens.access_token}`,
            },
          },
          rebound,
        )
      ).status,
    ).toBe(403);
    const removed = { ...h.policy, bindings: [h.policy.bindings[1]!] };
    expect(
      (
        await h.request(
          "/mcp",
          {
            headers: {
              Authorization: `Bearer ${writerGrant.tokens.access_token}`,
            },
          },
          removed,
        )
      ).status,
    ).toBe(403);
  });

  it("refreshes and revokes grants through the library's protocol, rejecting stale codes and foreign resources", async () => {
    const h = await createOAuthFixture();
    const grant = await h.grant();
    expect(grant.tokens.expires_in).toBe(900);
    expect(grant.tokens.refresh_token).toBeTypeOf("string");
    const refreshed = await h.exchange({
      grant_type: "refresh_token",
      client_id: grant.client.client_id,
      refresh_token: grant.tokens.refresh_token!,
      resource: h.policy.resource,
    });
    expect(refreshed.status).toBe(200);
    const tokens = (await refreshed.json()) as {
      access_token: string;
      refresh_token: string;
    };
    const client = await connect(h, tokens.access_token);
    expect(
      (await client.callTool({ name: "ezer_identity", arguments: {} })).isError,
    ).not.toBe(true);
    expect(
      (
        await h.exchange({
          grant_type: "refresh_token",
          client_id: grant.client.client_id,
          refresh_token: tokens.refresh_token,
          resource: "https://other.test/mcp",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await h.exchange({
          token: tokens.refresh_token,
          token_type_hint: "refresh_token",
          client_id: grant.client.client_id,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await h.request("/mcp", {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await h.exchange({
          grant_type: "refresh_token",
          client_id: grant.client.client_id,
          refresh_token: tokens.refresh_token,
          resource: h.policy.resource,
        })
      ).status,
    ).toBe(400);
  });

  it("rejects a reused authorization code and revokes the affected grant", async () => {
    const h = await createOAuthFixture();
    const grant = await h.grant();
    expect((await h.exchange(grant.values)).status).toBe(400);
    expect(
      (
        await h.request("/mcp", {
          headers: { Authorization: `Bearer ${grant.tokens.access_token}` },
        })
      ).status,
    ).toBe(401);
  });

  it("supports a metadata-document client without dynamic registration", async () => {
    const h = await createOAuthFixture();
    const grant = await h.grant({
      client: {
        client_id: "https://client.test/metadata.json",
        redirect_uris: ["http://127.0.0.1:54321/callback"],
      },
    });
    expect(grant.html).toContain("client.test");
    const client = await connect(h, grant.tokens.access_token);
    expect(
      (await client.callTool({ name: "ezer_identity", arguments: {} })).isError,
    ).not.toBe(true);
  });

  it("does not turn a caller's reduced consent back into the originally requested permissions", async () => {
    const h = await createOAuthFixture();
    const login = await h.begin();
    login.form.delete("scope");
    login.form.append("scope", "ezer:connect");
    const approved = await h.request("/authorize", {
      method: "POST",
      headers: login.headers,
      body: login.form,
    });
    const code = new URL(approved.headers.get("Location")!).searchParams.get(
      "code",
    )!;
    const response = await h.exchange({
      grant_type: "authorization_code",
      client_id: login.client.client_id,
      code,
      code_verifier: login.verifier,
      resource: h.policy.resource,
    });
    expect(response.status).toBe(200);
    const tokens = (await response.json()) as {
      access_token: string;
      scope: string;
      refresh_token?: string;
    };
    expect(tokens.scope).toBe("ezer:connect");
    expect(tokens.refresh_token).toBeUndefined();
    const client = await connect(h, tokens.access_token);
    expect(
      (await client.callTool({ name: "ezer_list", arguments: {} })).isError,
    ).toBe(true);
  });

  it("rejects forged signatures, oversized consent submissions and unknown scopes", async () => {
    const h = await createOAuthFixture();
    const foreign = await generateKeyPair("RS256");
    expect(
      (await h.begin({ assertion: await h.sign({}, foreign.privateKey) }))
        .response.status,
    ).toBe(403);
    const login = await h.begin();
    expect(
      (
        await h.request("/authorize", {
          method: "POST",
          headers: login.headers,
          body: "x=" + "a".repeat(16384),
        })
      ).status,
    ).toBe(400);
    login.form.append("scope", "admin:all");
    expect(
      (
        await h.request("/authorize", {
          method: "POST",
          headers: login.headers,
          body: login.form,
        })
      ).status,
    ).toBe(400);
  });

  it("requires PKCE proof and rejects unregistered redirects and foreign authorization resources", async () => {
    const h = await createOAuthFixture();
    const login = await h.begin();
    const response = await h.request("/authorize", {
      method: "POST",
      headers: login.headers,
      body: login.form,
    });
    const code = new URL(response.headers.get("Location")!).searchParams.get(
      "code",
    )!;
    expect(
      (
        await h.exchange({
          grant_type: "authorization_code",
          client_id: login.client.client_id,
          code,
          code_verifier: "x".repeat(64),
          redirect_uri: login.client.redirect_uris[0]!,
          resource: h.policy.resource,
        })
      ).status,
    ).toBe(400);
    const redirect = await h.begin({
      query: { redirect_uri: "https://attacker.test/callback" },
    });
    expect(redirect.response.status).toBe(400);
    expect(redirect.response.headers.has("Location")).toBe(false);
    const target = await h.begin({
      query: { resource: "https://other.test/mcp" },
    });
    expect(target.response.status).not.toBe(200);
    expect(target.html).not.toContain('name="handle"');
  });

  it("requires browser-bound consent, the same caller and assignment, and same-origin submission", async () => {
    const h = await createOAuthFixture();
    const login = await h.begin();
    expect(login.response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(login.response.headers.get("Cache-Control")).toBe("no-store");
    for (const headers of [
      { ...login.headers, Cookie: "" },
      { ...login.headers, Origin: "https://attacker.test" },
      {
        ...login.headers,
        "Cf-Access-Jwt-Assertion": await h.sign({ sub: "bob" }),
      },
    ])
      expect(
        (
          await h.request("/authorize", {
            method: "POST",
            headers,
            body: login.form,
          })
        ).status,
      ).toBeGreaterThanOrEqual(400);
    const changed = {
      ...h.policy,
      bindings: [{ subject: "alice", individualId: "changed-ezer" }],
    };
    expect(
      (
        await h.request(
          "/authorize",
          { method: "POST", headers: login.headers, body: login.form },
          changed,
        )
      ).status,
    ).toBe(400);
    const approved = await h.request("/authorize", {
      method: "POST",
      headers: login.headers,
      body: login.form,
    });
    expect(approved.status).toBe(302);
    expect(
      (
        await h.request("/authorize", {
          method: "POST",
          headers: login.headers,
          body: login.form,
        })
      ).status,
    ).toBe(400);
  });

  it("escapes client metadata and supports denying a request without issuing a code", async () => {
    const h = await createOAuthFixture();
    const client = await h.register({
      client_name: '<script>alert("test")</script>',
    });
    const login = await h.begin({ client });
    expect(login.html).not.toContain("<script>");
    expect(login.html).toContain("&#60;script&#62;");
    expect(login.html).toContain("127.0.0.1");
    login.form.set("decision", "deny");
    const response = await h.request("/authorize", {
      method: "POST",
      headers: login.headers,
      body: login.form,
    });
    const redirect = new URL(response.headers.get("Location")!);
    expect(redirect.searchParams.get("error")).toBe("access_denied");
    expect(redirect.searchParams.has("code")).toBe(false);
    expect(redirect.searchParams.get("state")).toBe(login.query.get("state"));
  });

  it.each([
    { iss: "https://wrong.cloudflareaccess.com" },
    { aud: "b".repeat(64) },
    { sub: "unassigned" },
    { type: "service" },
    { sub: "" },
    { exp: 1 },
    { iat: 9999999999 },
  ])("rejects untrusted Access sessions: %j", async (claims) => {
    const h = await createOAuthFixture();
    const login = await h.begin({ assertion: await h.sign(claims) });
    expect(login.response.status).toBe(403);
    expect(login.response.headers.has("Set-Cookie")).toBe(false);
  });

  it("keeps Access assertions out of the MCP credential channel and fails closed on unavailable keys", async () => {
    const h = await createOAuthFixture();
    const assertion = await h.sign();
    expect(
      (
        await h.request("/mcp", {
          headers: { Authorization: `Bearer ${assertion}` },
        })
      ).status,
    ).toBe(401);
    h.fetchKeys.mockRejectedValue(
      new Error("Synthetic private upstream diagnostic"),
    );
    const response = await h.request("/authorize", {
      headers: { "Cf-Access-Jwt-Assertion": assertion },
    });
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("diagnostic");
    expect(
      (
        await h.request("/mcp", undefined, {
          ...h.policy,
          access: { ...h.policy.access, teamDomain: "https://attacker.test" },
        })
      ).status,
    ).toBe(503);
  });
});
