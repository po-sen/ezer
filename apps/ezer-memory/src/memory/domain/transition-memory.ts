import { MemoryFault } from "./memory-fault";
import type { MemoryRevision } from "./memory-revision";
import type { MemorySource } from "./memory-source";
import { validateMemoryId } from "./validate-memory-id";

export interface RevisionContent {
  readonly memoryId: string;
  readonly body: string;
  readonly source: MemorySource;
}
export type RevisionIntent =
  | { readonly kind: "remember"; readonly content: RevisionContent }
  | {
      readonly kind: "revise";
      readonly content: RevisionContent;
      readonly expectedRevision: number;
      readonly reason: string;
    };

function text(value: string, limit: number): boolean {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= limit
  );
}

// All creation/correction invariants live here; no operation IDs or wire DTOs enter.
export function transitionMemory(
  intent: RevisionIntent,
  current: MemoryRevision | null,
  changeSequence: number,
  recordedAt: string,
): MemoryRevision {
  const content = intent.content;
  validateMemoryId(content.memoryId);
  if (
    !text(content.body, 16_384) ||
    !content.source ||
    !text(content.source.reference, 1_024) ||
    !text(content.source.excerpt, 4_096)
  )
    throw new MemoryFault("INVALID_INPUT");
  if (
    intent.kind === "revise" &&
    (!Number.isSafeInteger(intent.expectedRevision) ||
      intent.expectedRevision < 1 ||
      intent.expectedRevision >= Number.MAX_SAFE_INTEGER ||
      !text(intent.reason, 1_024))
  )
    throw new MemoryFault("INVALID_INPUT");
  if (
    !Number.isSafeInteger(changeSequence) ||
    changeSequence < 0 ||
    !Number.isSafeInteger(changeSequence + 1)
  )
    throw new MemoryFault("CAPACITY_EXCEEDED");
  if (!Number.isFinite(Date.parse(recordedAt)))
    throw new MemoryFault("INVALID_INPUT");
  if (
    current &&
    (current.memoryId !== content.memoryId ||
      current.changeSequence > changeSequence)
  )
    throw new MemoryFault("INVALID_INPUT");
  if (intent.kind === "remember" && current)
    throw new MemoryFault("ALREADY_EXISTS");
  if (intent.kind === "revise") {
    if (!current) throw new MemoryFault("NOT_FOUND");
    if (current.revision !== intent.expectedRevision)
      throw new MemoryFault("REVISION_CONFLICT");
  }
  const revision = (current?.revision ?? 0) + 1;
  if (!Number.isSafeInteger(revision))
    throw new MemoryFault("CAPACITY_EXCEEDED");
  return Object.freeze({
    memoryId: content.memoryId,
    revision,
    body: content.body,
    source: Object.freeze({
      reference: content.source.reference,
      excerpt: content.source.excerpt,
    }),
    reason: intent.kind === "revise" ? intent.reason : null,
    recordedAt,
    changeSequence: changeSequence + 1,
  });
}
