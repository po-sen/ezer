import {
  MemoryFault,
  transitionMemory,
  validateMemoryId,
} from "../domain/index.ts";
import type { RestoreMemoryHistory } from "../ports/inbound/index.ts";
import { PersistenceFault, type UnitOfWork } from "../ports/outbound/index.ts";

class RestoreConflict extends Error {}

export function createRestoreMemoryHistory(
  unitOfWork: UnitOfWork,
): RestoreMemoryHistory {
  return {
    execute(command) {
      try {
        validateMemoryId(command.restoreId);
        const { snapshotSequence, revisions, complete } = command;
        if (
          !Number.isSafeInteger(snapshotSequence) ||
          snapshotSequence < 0 ||
          typeof complete !== "boolean" ||
          revisions.length > 10 ||
          (revisions.length === 0 && (snapshotSequence !== 0 || !complete))
        )
          return { ok: false, code: "INVALID_INPUT" };
        const first = revisions[0]?.changeSequence ?? 1;
        const last = revisions.at(-1)?.changeSequence ?? 0;
        if (
          !Number.isSafeInteger(first) ||
          first < 1 ||
          last > snapshotSequence ||
          complete !== (last === snapshotSequence) ||
          revisions.some((r, i) => r.changeSequence !== first + i)
        )
          return { ok: false, code: "INVALID_INPUT" };
        return unitOfWork.within((stores) => {
          const state = stores.state.read();
          const restore = stores.restore.read();
          if (
            restore &&
            (restore.restoreId !== command.restoreId ||
              restore.snapshotSequence !== snapshotSequence)
          )
            return { ok: false, code: "RESTORE_CONFLICT" } as const;
          if (
            !restore &&
            (state.changeSequence !== 0 ||
              stores.revisions.history(Number.MAX_SAFE_INTEGER, 0, 1).length >
                0)
          )
            return { ok: false, code: "TARGET_NOT_EMPTY" } as const;
          if (first > state.changeSequence + 1 || (!restore && first !== 1))
            return { ok: false, code: "RESTORE_CONFLICT" } as const;
          if (!restore)
            stores.restore.start(command.restoreId, snapshotSequence);
          for (const input of revisions) {
            const timestamp = Date.parse(input.recordedAt);
            if (
              !Number.isFinite(timestamp) ||
              new Date(timestamp).toISOString() !== input.recordedAt
            )
              throw new MemoryFault("INVALID_INPUT");
            const current =
              input.revision > 1
                ? stores.revisions.find(input.memoryId, input.revision - 1)
                : null;
            const revision = transitionMemory(
              input.revision === 1
                ? { kind: "remember", content: input }
                : {
                    kind: "revise",
                    content: input,
                    expectedRevision: input.revision - 1,
                    reason: input.reason!,
                  },
              current,
              input.changeSequence - 1,
              input.recordedAt,
            );
            if (
              revision.revision !== input.revision ||
              revision.reason !== input.reason
            )
              throw new MemoryFault("INVALID_INPUT");
            const existing = stores.revisions.find(
              input.memoryId,
              input.revision,
            );
            if (input.changeSequence <= state.changeSequence) {
              if (
                !existing ||
                existing.memoryId !== revision.memoryId ||
                existing.revision !== revision.revision ||
                existing.body !== revision.body ||
                existing.source.reference !== revision.source.reference ||
                existing.source.excerpt !== revision.source.excerpt ||
                existing.reason !== revision.reason ||
                existing.recordedAt !== revision.recordedAt ||
                existing.changeSequence !== revision.changeSequence
              )
                throw new RestoreConflict();
            } else {
              if (existing) throw new RestoreConflict();
              stores.revisions.append(revision);
              stores.state.advance(
                input.changeSequence - 1,
                input.changeSequence,
              );
            }
          }
          if (complete && !restore?.complete) stores.restore.complete();
          return {
            ok: true,
            value: {
              restoreId: command.restoreId,
              snapshotSequence,
              restoredSequence: Math.min(
                snapshotSequence,
                Math.max(state.changeSequence, last),
              ),
              complete: restore?.complete === true || complete,
            },
          } as const;
        });
      } catch (error) {
        if (error instanceof RestoreConflict)
          return { ok: false, code: "RESTORE_CONFLICT" };
        if (error instanceof MemoryFault)
          return { ok: false, code: error.code };
        if (error instanceof PersistenceFault)
          return { ok: false, code: "UNAVAILABLE" };
        throw error;
      }
    },
  };
}
