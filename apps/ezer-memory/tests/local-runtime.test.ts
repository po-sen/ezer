import assert from "node:assert/strict";
import { test } from "node:test";
import { createLocalRuntime } from "../src/runtime/index.ts";

test("failed local startup closes every acquired resource even if one cleanup fails", async () => {
  const closed: string[] = [];
  const runtime = createLocalRuntime(async (own) => {
    own({
      close() {
        closed.push("memory");
      },
    });
    own({
      close() {
        closed.push("workspace");
        throw new Error("Synthetic cleanup failure");
      },
    });
    throw new Error("Synthetic startup failure");
  });
  await assert.rejects(runtime.start(), /Local Ezer cleanup failed/);
  assert.deepEqual(closed, ["workspace", "memory"]);
  await assert.rejects(runtime.close());
  assert.deepEqual(closed, ["workspace", "memory"]);
});
