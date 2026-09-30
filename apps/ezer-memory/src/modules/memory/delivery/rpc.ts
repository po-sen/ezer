import { z } from "zod";
import type { CommitMemory, InspectMemory } from "../ports/inbound/index.ts";

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
export function createMemoryRpcHandler(
  commit: CommitMemory,
  inspect: InspectMemory,
) {
  return {
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
