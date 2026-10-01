import type { DescribeMemoryService } from "../ports/inbound/index.ts";

export function createDescribeMemoryService(
  version: string,
): DescribeMemoryService {
  return {
    execute: () => ({
      name: "ezer-memory",
      version,
      stage: "foundation",
      capabilities: { memoryRead: true, memoryWrite: true },
    }),
  };
}
