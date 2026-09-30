import metadata from "../../package.json" with { type: "json" };
import { createDescribeMemoryService } from "../modules/memory/application/describe-service.ts";
import { createMemoryHttpHandler } from "../modules/memory/delivery/http.ts";
import { createMemoryMcpHandler } from "../modules/memory/delivery/mcp.ts";

export function createWorker(): ExportedHandler {
  const describeService = createDescribeMemoryService(metadata.version);
  return {
    fetch: createMemoryHttpHandler(createMemoryMcpHandler(describeService)),
  };
}
