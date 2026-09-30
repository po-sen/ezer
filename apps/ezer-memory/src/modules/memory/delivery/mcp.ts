import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type {
  DescribeMemoryService,
  DescribeMemoryBinding,
} from "../ports/inbound/index.ts";
import type { AuthorizedIndividual } from "../../access/index.ts";

export function createMemoryMcpHandler(
  describeService: DescribeMemoryService,
  individual: AuthorizedIndividual,
  binding: DescribeMemoryBinding,
) {
  return createMcpHandler(
    () => {
      const description = describeService.execute();
      const server = new McpServer({
        name: description.name,
        version: description.version,
      });

      server.registerTool(
        "ezer_identity",
        {
          description:
            "Identify the Ezer bound to this authenticated connection. This is a stable identity, not a session or a personality summary.",
          inputSchema: z.strictObject({}),
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
        },
        async () => {
          try {
            const result = await binding.execute(individual.individualId);
            if (!result.ok)
              return {
                isError: true,
                content: [{ type: "text", text: result.code }],
              };
            return {
              content: [{ type: "text", text: JSON.stringify(result.value) }],
              structuredContent: { ...result.value },
            };
          } catch {
            return {
              isError: true,
              content: [{ type: "text", text: "INTERNAL_ERROR" }],
            };
          }
        },
      );

      server.registerTool(
        "ezer_service_info",
        {
          description:
            "Describe the Ezer memory service and its available capabilities.",
          inputSchema: z.strictObject({}),
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
        },
        () => {
          const result = describeService.execute();
          return {
            content: [{ type: "text", text: JSON.stringify(result) }],
            structuredContent: { ...result },
          };
        },
      );

      return server;
    },
    { legacy: "stateless", maxRequestBodySize: 64 * 1024 },
  );
}
