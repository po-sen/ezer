import { MemoryFault } from "../domain/memory-fault.ts";
import { transitionMemory } from "../domain/transition-memory.ts";
import { validateMemoryId } from "../domain/validate-memory-id.ts";
import type { CommitMemory } from "../ports/inbound/commit-memory.ts";
import type { MemoryWrite } from "../ports/inbound/memory-write.ts";
import { PersistenceFault } from "../ports/outbound/persistence-fault.ts";
import type { RequestFingerprint } from "../ports/outbound/request-fingerprint.ts";
import type { UnitOfWork } from "../ports/outbound/unit-of-work.ts";

function snapshot(command: MemoryWrite): MemoryWrite {
  const content = {
    operationId: command.operationId,
    memoryId: command.memoryId,
    body: command.body,
    source: {
      reference: command.source.reference,
      excerpt: command.source.excerpt,
    },
  };
  return command.kind === "remember"
    ? { ...content, kind: "remember" }
    : {
        ...content,
        kind: "revise",
        expectedRevision: command.expectedRevision,
        reason: command.reason,
      };
}

export function createCommitMemory(
  unitOfWork: UnitOfWork,
  fingerprints: RequestFingerprint,
  now: () => string,
): CommitMemory {
  return {
    async execute(input) {
      const command = snapshot(input);
      try {
        validateMemoryId(command.operationId);
        const fingerprint = await fingerprints.digest(
          JSON.stringify([
            1,
            command.kind,
            command.operationId,
            command.memoryId,
            command.body,
            command.source.reference,
            command.source.excerpt,
            command.kind === "revise" ? command.expectedRevision : null,
            command.kind === "revise" ? command.reason : null,
          ]),
        );
        return unitOfWork.within((stores) => {
          const state = stores.state.read();
          const previous = stores.operations.find(command.operationId);
          if (previous) {
            if (previous.fingerprint !== fingerprint)
              return { ok: false, code: "OPERATION_CONFLICT" } as const;
            return {
              ok: true,
              value: {
                individualId: state.individualId,
                memoryId: previous.memoryId,
                revision: previous.revision,
                recordedAt: previous.recordedAt,
                changeSequence: previous.changeSequence,
              },
            } as const;
          }
          const content = {
            memoryId: command.memoryId,
            body: command.body,
            source: command.source,
          };
          const intent =
            command.kind === "remember"
              ? { kind: "remember" as const, content }
              : {
                  kind: "revise" as const,
                  content,
                  expectedRevision: command.expectedRevision,
                  reason: command.reason,
                };
          const revision = transitionMemory(
            intent,
            stores.revisions.find(command.memoryId),
            state.changeSequence,
            now(),
          );
          stores.revisions.append(revision);
          stores.state.advance(state.changeSequence, revision.changeSequence);
          stores.operations.record(command.operationId, {
            fingerprint,
            memoryId: revision.memoryId,
            revision: revision.revision,
            recordedAt: revision.recordedAt,
            changeSequence: revision.changeSequence,
          });
          return {
            ok: true,
            value: {
              individualId: state.individualId,
              memoryId: revision.memoryId,
              revision: revision.revision,
              recordedAt: revision.recordedAt,
              changeSequence: revision.changeSequence,
            },
          } as const;
        });
      } catch (error) {
        if (error instanceof MemoryFault)
          return { ok: false, code: error.code };
        if (error instanceof PersistenceFault)
          return { ok: false, code: "UNAVAILABLE" };
        throw error;
      }
    },
  };
}
