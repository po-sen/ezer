import type {
  MemoryReceipt,
  MemoryResult,
  MemoryWrite,
} from "../domain/memory";
import { parseMemoryWrite } from "../domain/parse-memory-write";
import { planMemoryRevision } from "../domain/plan-memory-revision";
import type { CommitMemory } from "../inboundport/commit-memory";
import type { MemoryStore } from "../outboundport/memory-store";
import type { RequestFingerprint } from "../outboundport/request-fingerprint";

function canonicalRequest(command: MemoryWrite): string {
  return JSON.stringify([
    1,
    command.kind,
    command.operationId,
    command.memoryId,
    command.body,
    command.source.reference,
    command.source.excerpt,
    command.kind === "revise" ? command.expectedRevision : null,
    command.kind === "revise" ? command.reason : null,
  ]);
}

export function createCommitMemory(
  store: MemoryStore,
  fingerprints: RequestFingerprint,
  now: () => string,
): CommitMemory {
  return {
    async execute(input): Promise<MemoryResult<MemoryReceipt>> {
      const command = parseMemoryWrite(input);
      if (!command) return { ok: false, code: "INVALID_INPUT" };
      const fingerprint = await fingerprints.digest(canonicalRequest(command));
      return store.transaction((transaction) => {
        // Retry resolution precedes version checks: even an old successful write
        // returns its original receipt after later revisions have committed.
        const previous = transaction.findOperation(command.operationId);
        if (previous) {
          return previous.fingerprint === fingerprint
            ? { ok: true, value: previous.receipt }
            : { ok: false, code: "OPERATION_CONFLICT" };
        }
        const planned = planMemoryRevision(
          command,
          transaction.findRevision(command.memoryId),
          transaction.state(),
          now(),
        );
        if (!planned.ok) return planned;
        const { individualId, memoryId, revision, changeSequence, recordedAt } =
          planned.value;
        const receipt = {
          individualId,
          memoryId,
          revision,
          changeSequence,
          recordedAt,
        };
        transaction.appendRevision(planned.value);
        transaction.recordOperation(command.operationId, {
          fingerprint,
          receipt,
        });
        return { ok: true, value: receipt };
      });
    },
  };
}
