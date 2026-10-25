import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import type {
  DescribeMemoryService,
  DescribeMemoryBinding,
  MemoryOperations,
} from "../ports/inbound/index.ts";
import { registerMemoryService } from "./register-memory-service.ts";

export function createMemoryMcpHandler(
  describeService: DescribeMemoryService,
  individualId: string,
  binding: DescribeMemoryBinding,
  memory: MemoryOperations,
) {
  return createMcpHandler(
    () => {
      const description = describeService.execute();
      const server = new McpServer({
        name: description.name,
        version: description.version,
      });
      registerMemoryService(
        server,
        describeService,
        individualId,
        binding,
        memory,
      );
      return server;
    },
    { legacy: "stateless", maxRequestBodySize: 2 * 1024 * 1024 },
  );
}
