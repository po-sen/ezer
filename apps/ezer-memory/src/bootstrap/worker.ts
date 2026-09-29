import metadata from "../../package.json" with { type: "json" };
import { createDescribeMemoryService } from "../memory/application/describe-service";
import { createMemoryHttpHandler } from "../memory/delivery/http";
import { createMemoryMcpHandler } from "../memory/delivery/mcp";

const describeService = createDescribeMemoryService(metadata.version);
const mcp = createMemoryMcpHandler(describeService);

export const worker = {
  fetch: createMemoryHttpHandler(mcp),
} satisfies ExportedHandler;
