import type { MemoryWrite } from "./memory";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, limit: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= limit
  );
}

function identifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)
  );
}

export function parseMemoryWrite(value: unknown): MemoryWrite | undefined {
  if (!record(value) || (value.kind !== "remember" && value.kind !== "revise"))
    return;
  const fields = ["kind", "operationId", "memoryId", "body", "source"];
  if (value.kind === "revise") fields.push("expectedRevision", "reason");
  if (Object.keys(value).some((key) => !fields.includes(key))) return;
  if (!identifier(value.operationId) || !identifier(value.memoryId)) return;
  if (!text(value.body, 16_384) || !record(value.source)) return;
  if (
    Object.keys(value.source).some(
      (key) => !["reference", "excerpt"].includes(key),
    )
  )
    return;
  if (
    !text(value.source.reference, 1_024) ||
    !text(value.source.excerpt, 4_096)
  )
    return;

  // Snapshot accepted fields before any asynchronous fingerprinting or storage work.
  const content = {
    operationId: value.operationId,
    memoryId: value.memoryId,
    body: value.body,
    source: {
      reference: value.source.reference,
      excerpt: value.source.excerpt,
    },
  };
  if (value.kind === "remember") return { kind: "remember", ...content };
  if (
    typeof value.expectedRevision !== "number" ||
    !Number.isSafeInteger(value.expectedRevision) ||
    value.expectedRevision < 1 ||
    value.expectedRevision >= Number.MAX_SAFE_INTEGER ||
    !text(value.reason, 1_024)
  )
    return;
  return {
    kind: "revise",
    ...content,
    expectedRevision: value.expectedRevision,
    reason: value.reason,
  };
}
