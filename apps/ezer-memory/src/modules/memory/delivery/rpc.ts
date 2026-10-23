import { z } from "zod";
import type {
  CommitMemory,
  InspectMemory,
  InspectMemoryState,
  ListMemories,
  SearchMemories,
  ExportMemoryHistory,
} from "../ports/inbound/index.ts";

const content = {
  operationId: z.string(),
  memoryId: z.string(),
  body: z.string(),
  source: z.strictObject({ reference: z.string(), excerpt: z.string() }),
};
const write = z.discriminatedUnion("kind", [
  z.strictObject({ ...content, kind: z.literal("remember") }),
  z.strictObject({
    ...content,
    kind: z.literal("revise"),
    expectedRevision: z.number(),
    reason: z.string(),
  }),
]);
const read = z.strictObject({
  memoryId: z.string(),
  revision: z.number().optional(),
});
const page = z.strictObject({
  order: z.enum(["oldest", "newest"]).optional(),
  limit: z.number().optional(),
  cursor: z
    .strictObject({
      order: z.literal("newest").optional(),
      snapshotSequence: z.number(),
      afterSequence: z.number(),
    })
    .optional(),
});
const searchQuery = z.strictObject({
  query: z.string(),
  limit: z.number().optional(),
  cursor: z
    .strictObject({
      query: z.string(),
      snapshotSequence: z.number(),
      afterSequence: z.number(),
    })
    .optional(),
});
const exportQuery = z.strictObject({
  limit: z.number().optional(),
  cursor: z
    .strictObject({ snapshotSequence: z.number(), afterSequence: z.number() })
    .optional(),
});
export function createMemoryRpcHandler(
  commit: CommitMemory,
  inspect: InspectMemory,
  state: InspectMemoryState,
  list: ListMemories,
  search: SearchMemories,
  exportHistory: ExportMemoryHistory,
) {
  return {
    exportHistory(input: unknown) {
      const parsed = exportQuery.safeParse(input);
      if (!parsed.success) return { ok: false, code: "INVALID_INPUT" } as const;
      try {
        return exportHistory.execute({
          ...(parsed.data.limit === undefined
            ? {}
            : { limit: parsed.data.limit }),
          ...(parsed.data.cursor === undefined
            ? {}
            : { cursor: parsed.data.cursor }),
        });
      } catch {
        return { ok: false, code: "INTERNAL_ERROR" } as const;
      }
    },
    search(input: unknown) {
      const parsed = searchQuery.safeParse(input);
      if (!parsed.success) return { ok: false, code: "INVALID_INPUT" } as const;
      try {
        return search.execute({
          query: parsed.data.query,
          ...(parsed.data.limit === undefined
            ? {}
            : { limit: parsed.data.limit }),
          ...(parsed.data.cursor === undefined
            ? {}
            : { cursor: parsed.data.cursor }),
        });
      } catch {
        return { ok: false, code: "INTERNAL_ERROR" } as const;
      }
    },
    list(input: unknown) {
      const parsed = page.safeParse(input);
      if (!parsed.success) return { ok: false, code: "INVALID_INPUT" } as const;
      try {
        return list.execute({
          ...(parsed.data.order === undefined
            ? {}
            : { order: parsed.data.order }),
          ...(parsed.data.limit === undefined
            ? {}
            : { limit: parsed.data.limit }),
          ...(parsed.data.cursor === undefined
            ? {}
            : {
                cursor: {
                  ...(parsed.data.cursor.order === undefined
                    ? {}
                    : { order: parsed.data.cursor.order }),
                  snapshotSequence: parsed.data.cursor.snapshotSequence,
                  afterSequence: parsed.data.cursor.afterSequence,
                },
              }),
        });
      } catch {
        return { ok: false, code: "INTERNAL_ERROR" } as const;
      }
    },
    inspectState() {
      try {
        return state.execute();
      } catch {
        return { ok: false, code: "INTERNAL_ERROR" } as const;
      }
    },
    async commit(input: unknown) {
      const parsed = write.safeParse(input);
      if (!parsed.success) return { ok: false, code: "INVALID_INPUT" } as const;
      try {
        return await commit.execute(parsed.data);
      } catch {
        return { ok: false, code: "INTERNAL_ERROR" } as const;
      }
    },
    inspect(input: unknown) {
      const parsed = read.safeParse(input);
      if (!parsed.success) return { ok: false, code: "INVALID_INPUT" } as const;
      try {
        return inspect.execute(
          parsed.data.revision === undefined
            ? { memoryId: parsed.data.memoryId }
            : {
                memoryId: parsed.data.memoryId,
                revision: parsed.data.revision,
              },
        );
      } catch {
        return { ok: false, code: "INTERNAL_ERROR" } as const;
      }
    },
  };
}
