import type {
  MemoryResult,
  MemoryRevision,
  MemoryState,
  MemoryWrite,
} from "./memory";

export function planMemoryRevision(
  command: MemoryWrite,
  current: MemoryRevision | null,
  state: MemoryState,
  recordedAt: string,
): MemoryResult<MemoryRevision> {
  if (command.kind === "remember" && current !== null)
    return { ok: false, code: "ALREADY_EXISTS" };
  if (command.kind === "revise") {
    if (current === null) return { ok: false, code: "NOT_FOUND" };
    if (command.expectedRevision !== current.revision)
      return { ok: false, code: "REVISION_CONFLICT" };
  }
  const changeSequence = state.changeSequence + 1;
  if (!Number.isSafeInteger(changeSequence))
    throw new Error("Memory sequence exhausted");
  return {
    ok: true,
    value: {
      individualId: state.individualId,
      memoryId: command.memoryId,
      revision: (current?.revision ?? 0) + 1,
      changeSequence,
      recordedAt,
      body: command.body,
      source: command.source,
      reason: command.kind === "revise" ? command.reason : null,
    },
  };
}
