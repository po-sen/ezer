type Handler = (
  request: Request,
  context: ExecutionContext,
) => Promise<Response | undefined>;

export function createHttpRouter(handlers: readonly (Handler | undefined)[]) {
  return async (
    request: Request,
    context: ExecutionContext,
  ): Promise<Response> => {
    for (const handler of handlers) {
      const response = await handler?.(request, context);
      if (response) return response;
    }
    return new Response("Not found", { status: 404 });
  };
}
