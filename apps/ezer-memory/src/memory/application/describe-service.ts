import type { DescribeMemoryService } from "../inboundport/describe-service";

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
