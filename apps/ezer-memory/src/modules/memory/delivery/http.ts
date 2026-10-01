import type { ConnectMemory } from "../ports/inbound/index.ts";
import type { MemoryHttpSettings } from "./memory-http-settings.ts";

export function createMemoryHttpHandler(
  connection: ConnectMemory,
  mcp: (individualId: string) => {
    fetch(request: Request): Promise<Response>;
  },
  settings: MemoryHttpSettings | undefined,
) {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      if (request.method !== "GET") {
        return new Response("Method not allowed", {
          status: 405,
          headers: { Allow: "GET" },
        });
      }
      return Response.json({ status: "ok" });
    }
    const metadataPath = "/.well-known/oauth-protected-resource/mcp";
    if (!["/mcp", metadataPath].includes(url.pathname)) {
      return new Response("Not found", { status: 404 });
    }

    // Native clients omit Origin. Browser calls must come from this origin.
    const origin = request.headers.get("Origin");
    if (origin !== null && origin !== url.origin) {
      return new Response("Forbidden origin", { status: 403 });
    }
    if (!settings) {
      return Response.json(
        { error: "temporarily_unavailable" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    const resource = new URL(settings.resource);
    if (url.origin !== resource.origin)
      return new Response("Not found", { status: 404 });
    if (url.search)
      return Response.json({ error: "invalid_request" }, { status: 400 });
    if (url.pathname === metadataPath) {
      if (request.method !== "GET")
        return new Response("Method not allowed", {
          status: 405,
          headers: { Allow: "GET" },
        });
      return Response.json(
        {
          resource: settings.resource,
          authorization_servers: [settings.authorizationServer],
          scopes_supported: [settings.connectionScope],
          bearer_methods_supported: ["header"],
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const header = request.headers.get("Authorization");
    const token = header?.match(/^Bearer +([A-Za-z0-9._~-]+=*)$/i)?.[1] ?? null;
    const result = await connection.execute(token);
    const challenge = `Bearer resource_metadata="${resource.origin}${metadataPath}", scope="${settings.connectionScope}"`;
    if (!result.ok) {
      const status =
        result.code === "UNAVAILABLE"
          ? 503
          : result.code === "IDENTITY_REQUIRED"
            ? 401
            : 403;
      const error =
        result.code === "UNAVAILABLE"
          ? "temporarily_unavailable"
          : result.code === "IDENTITY_REQUIRED"
            ? "invalid_token"
            : result.code === "CONNECTION_NOT_GRANTED"
              ? "insufficient_scope"
              : "access_denied";
      return Response.json(
        { error },
        {
          status,
          headers: {
            "Cache-Control": "no-store",
            ...(status === 401 || result.code === "CONNECTION_NOT_GRANTED"
              ? {
                  "WWW-Authenticate": header
                    ? `${challenge}, error="${error}"`
                    : challenge,
                }
              : {}),
          },
        },
      );
    }
    const upstream = await mcp(result.individualId).fetch(request);
    const response = new Response(upstream.body, upstream);
    response.headers.set("Cache-Control", "no-store");
    return response;
  };
}
