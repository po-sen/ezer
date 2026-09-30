import { describe, expect, it } from "vitest";
import { MemoryFault } from "../src/modules/memory/domain/memory-fault.ts";
import { transitionMemory } from "../src/modules/memory/domain/transition-memory.ts";
import { type RevisionIntent } from "../src/modules/memory/domain/revision-intent.ts";

const content = {
  memoryId: "m1",
  body: "Original statement",
  source: { reference: "conversation:1", excerpt: "Original" },
};
const now = "2026-09-30T00:00:00.000Z";
const remember: RevisionIntent = { kind: "remember", content };
const correction: RevisionIntent = {
  kind: "revise",
  content: { ...content, body: "Corrected" },
  expectedRevision: 1,
  reason: "A later statement",
};

describe("memory transitions without infrastructure", () => {
  it("creates immutable snapshots and retains the earlier source after correction", () => {
    const source = { ...content.source };
    const first = transitionMemory(
      { kind: "remember", content: { ...content, source } },
      null,
      0,
      now,
    );
    source.excerpt = "mutated caller value";
    const second = transitionMemory(correction, first, 1, now);
    expect(first).toMatchObject({
      revision: 1,
      reason: null,
      source: content.source,
    });
    expect(second).toMatchObject({
      revision: 2,
      changeSequence: 2,
      body: "Corrected",
      reason: "A later statement",
    });
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.source)).toBe(true);
  });

  it("owns create, missing, stale-version, identity, and sequence invariants", () => {
    const first = transitionMemory(remember, null, 0, now);
    for (const [intent, current, sequence, code] of [
      [remember, first, 1, "ALREADY_EXISTS"],
      [correction, null, 0, "NOT_FOUND"],
      [{ ...correction, expectedRevision: 2 }, first, 1, "REVISION_CONFLICT"],
      [
        { ...correction, content: { ...content, memoryId: "different" } },
        first,
        1,
        "INVALID_INPUT",
      ],
      [correction, first, 0, "INVALID_INPUT"],
      [remember, null, Number.MAX_SAFE_INTEGER, "CAPACITY_EXCEEDED"],
    ] as const) {
      expect(() => transitionMemory(intent, current, sequence, now)).toThrow(
        new MemoryFault(code),
      );
    }
  });

  it("rejects invalid domain values even when there is no transport adapter", () => {
    for (const invalid of [
      { ...content, memoryId: "../x" },
      { ...content, body: " " },
      { ...content, body: "x".repeat(16_385) },
      { ...content, source: { ...content.source, reference: "" } },
      { ...content, source: { ...content.source, excerpt: "x".repeat(4_097) } },
    ])
      expect(() =>
        transitionMemory({ kind: "remember", content: invalid }, null, 0, now),
      ).toThrow(new MemoryFault("INVALID_INPUT"));
    const first = transitionMemory(remember, null, 0, now);
    expect(() =>
      transitionMemory({ ...correction, reason: "" }, first, 1, now),
    ).toThrow(new MemoryFault("INVALID_INPUT"));
  });
});
