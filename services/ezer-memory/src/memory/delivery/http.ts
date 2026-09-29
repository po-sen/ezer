export function createMemoryHttpHandler(mcp: {
  fetch(request: Request): Promise<Response>;
}) {
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
    if (url.pathname !== "/mcp") {
      return new Response("Not found", { status: 404 });
    }

    // Native clients omit Origin. Browser calls must come from this origin.
    const origin = request.headers.get("Origin");
    if (origin !== null && origin !== url.origin) {
      return new Response("Forbidden origin", { status: 403 });
    }
    return mcp.fetch(request);
  };
}
