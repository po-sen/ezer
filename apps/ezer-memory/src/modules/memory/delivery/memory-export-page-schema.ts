import { z } from "zod";
const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/);
const sequence = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const memoryExportPageSchema = z.strictObject({
  format: z.literal("ezer-memory"),
  formatVersion: z.literal(1),
  individualId: id,
  snapshotSequence: sequence,
  revisions: z
    .array(
      z.strictObject({
        individualId: id,
        memoryId: id,
        revision: sequence.min(1),
        body: z.string().min(1).max(16_384),
        source: z.strictObject({
          reference: z.string().min(1).max(1_024),
          excerpt: z.string().min(1).max(4_096),
        }),
        reason: z.string().min(1).max(1_024).nullable(),
        recordedAt: z.string().max(64),
        changeSequence: sequence.min(1),
      }),
    )
    .max(10),
  nextCursor: z
    .strictObject({ snapshotSequence: sequence, afterSequence: sequence })
    .nullable(),
});
