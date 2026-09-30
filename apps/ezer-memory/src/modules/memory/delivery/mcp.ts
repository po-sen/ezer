import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { DescribeMemoryService } from "../ports/inbound/index.ts";

export function createMemoryMcpHandler(describeService: DescribeMemoryService) {
  return createMcpHandler(
    () => {
      const description = describeService.execute();
      const server = new McpServer({
        name: description.name,
        version: description.version,
      });

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
