import type { MemoryLookup } from "./memory";

export function parseMemoryLookup(value: unknown): MemoryLookup | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["memoryId", "revision"].includes(key)))
    return;
  if (
    typeof input.memoryId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.memoryId)
  )
    return;
  if (Object.hasOwn(input, "revision")) {
    if (
      typeof input.revision !== "number" ||
      !Number.isSafeInteger(input.revision) ||
      input.revision < 1
    )
      return;
    return { memoryId: input.memoryId, revision: input.revision };
  }
  return { memoryId: input.memoryId };
}
