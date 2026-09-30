import type { DescribeMemoryService } from "../ports/inbound/describe-service.ts";

export function createDescribeMemoryService(
  version: string,
): DescribeMemoryService {
  return {
    execute: () => ({
      name: "ezer-memory",
      version,
      stage: "foundation",
      capabilities: { memoryRead: false, memoryWrite: false },
    }),
  };
}
