import { env } from "cloudflare:workers";
import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { expect, vi } from "vitest";
import { createWorker } from "../../src/bootstrap/create-worker.ts";

export async function createOAuthFixture() {
  const pair = await generateKeyPair("RS256");
  const origin = "https://ezer.test";
  const policy = {
    provider: "cloudflare-access",
    resource: `${origin}/mcp`,
    access: {
      teamDomain: "https://synthetic-team.cloudflareaccess.com",
      audience: "a".repeat(64),
    },
    bindings: [
      { subject: "alice", individualId: `alice-${crypto.randomUUID()}` },
      { subject: "bob", individualId: `bob-${crypto.randomUUID()}` },
    ],
  };
  const scopes = [
    "ezer:connect",
    "ezer:memory:read",
    "ezer:memory:write",
    "ezer:memory:restore",
    "offline_access",
  ];
  const keys = {
    keys: [
      {
        ...(await exportJWK(pair.publicKey)),
        kid: "synthetic-access",
        alg: "RS256",
        use: "sig",
      },
    ],
  };
  const fetchKeys = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input, init) => {
      if (String(input) === "https://client.test/metadata.json")
        return Response.json({
          client_id: "https://client.test/metadata.json",
          client_name: "Synthetic CIMD client",
          redirect_uris: ["http://127.0.0.1:54321/callback"],
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
        });
      if (
        String(input) !== `${policy.access.teamDomain}/cdn-cgi/access/certs` ||
        init?.redirect !== "manual"
      )
        throw new Error("Unexpected network request in test");
      return Response.json(keys);
    });
  const worker = createWorker();
  async function request(
    path: string,
    init?: RequestInit,
    configuration: unknown = policy,
  ) {
    const context = createExecutionContext();
    const response = await worker.fetch(
      new Request(new URL(path, origin), init),
      {
        ...env,
        EZER_AUTHORIZATION: configuration as Env["EZER_AUTHORIZATION"],
      },
      context,
    );
    await waitOnExecutionContext(context);
    return response;
  }
  async function sign(
    claims: Record<string, unknown> = {},
    key = pair.privateKey,
  ) {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({
      iss: policy.access.teamDomain,
      aud: policy.access.audience,
      sub: "alice",
      type: "app",
      iat: now,
      exp: now + 300,
      ...claims,
    })
      .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: "synthetic-access" })
      .sign(key);
  }
  async function register(override: Record<string, unknown> = {}) {
    const response = await request("/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Synthetic native client",
        redirect_uris: ["http://127.0.0.1:54321/callback"],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        ...override,
      }),
    });
    expect(response.status).toBe(201);
    return (await response.json()) as {
      client_id: string;
      redirect_uris: string[];
    };
  }
  async function begin(
    options: {
      subject?: string;
      scope?: string[];
      client?: Awaited<ReturnType<typeof register>>;
      query?: Record<string, string>;
      assertion?: string;
    } = {},
  ) {
    const client = options.client ?? (await register());
    const verifier = crypto.randomUUID() + crypto.randomUUID();
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    );
    const challenge = btoa(String.fromCharCode(...digest))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
    const query = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: client.redirect_uris[0]!,
      response_type: "code",
      resource: policy.resource,
      scope: (
        options.scope ?? scopes.filter((s) => s !== "ezer:memory:restore")
      ).join(" "),
      state: crypto.randomUUID(),
      code_challenge: challenge,
      code_challenge_method: "S256",
      ...options.query,
    });
    const assertion =
      options.assertion ?? (await sign({ sub: options.subject ?? "alice" }));
    const response = await request(`/authorize?${query}`, {
      headers: { "Cf-Access-Jwt-Assertion": assertion },
    });
    const html = await response.text();
    const field = (name: string) =>
      html.match(new RegExp(`name="${name}" value="([^"]+)"`))?.[1] ?? "";
    const form = new URLSearchParams({
      handle: field("handle"),
      caller: field("caller"),
      individual: field("individual"),
      decision: "approve",
    });
    for (const scope of options.scope ??
      scopes.filter((s) => s !== "ezer:memory:restore"))
      form.append("scope", scope);
    const headers = {
      "Cf-Access-Jwt-Assertion": assertion,
      Cookie: response.headers.get("Set-Cookie")?.split(";")[0] ?? "",
      Origin: origin,
      "Content-Type": "application/x-www-form-urlencoded",
    };
    return { response, html, form, headers, client, verifier, query };
  }
  async function exchange(values: Record<string, string>) {
    return request("/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(values),
    });
  }
  async function grant(options: Parameters<typeof begin>[0] = {}) {
    const login = await begin(options);
    expect(login.response.status).toBe(200);
    const approval = await request("/authorize", {
      method: "POST",
      headers: login.headers,
      body: login.form,
    });
    expect(approval.status).toBe(302);
    const redirect = new URL(approval.headers.get("Location")!);
    expect(redirect.searchParams.get("state")).toBe(login.query.get("state"));
    expect(redirect.searchParams.get("iss")).toBe(origin);
    const code = redirect.searchParams.get("code")!;
    const values = {
      grant_type: "authorization_code",
      client_id: login.client.client_id,
      redirect_uri: login.client.redirect_uris[0]!,
      code,
      code_verifier: login.verifier,
      resource: policy.resource,
    };
    const response = await exchange(values);
    expect(response.status).toBe(200);
    const tokens = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      scope: string;
      expires_in: number;
    };
    return { ...login, tokens, values };
  }
  return {
    origin,
    policy,
    scopes,
    request,
    sign,
    register,
    begin,
    grant,
    exchange,
    fetchKeys,
  };
}
