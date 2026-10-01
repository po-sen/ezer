import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { expect, it } from "vitest";
import {
  assertSupportedSchema,
  initializeIndividual,
  createIndividualStateStore,
  createOperationStore,
  createRevisionStore,
} from "../src/modules/memory/infrastructure/persistence/sqlite/index.ts";

import {
  migrations,
  reversals,
} from "../src/modules/memory/infrastructure/persistence/sqlite/migrations/index.ts";

import type {
  SqlSession,
  SqlValue,
} from "../src/modules/memory/infrastructure/persistence/sqlite/index.ts";

it("exercises SQLite-owned migrations and Stores without the Durable Object adapter", async () => {
  await runInDurableObject(
    env.EZER_MEMORY.get(env.EZER_MEMORY.newUniqueId()),
    async (_instance, { storage }) => {
      // Use the test runtime only as a SQLite engine for this disposable database.
      // Remove bootstrap state, then load only the SQLite adapter's own artifacts.
      await storage.deleteAll();
      for (const migration of migrations) storage.sql.exec(migration.sql);
      const session: SqlSession = {
        query<T extends Record<string, SqlValue>>(
          statement: string,
          ...bindings: SqlValue[]
        ): T[] {
          return storage.sql.exec<T>(statement, ...bindings).toArray();
        },
      };
      assertSupportedSchema(session);
      initializeIndividual(session, "sqlite-individual");
      initializeIndividual(session, "sqlite-individual");
      expect(() => initializeIndividual(session, "other")).toThrow(
        "identity mismatch",
      );

      const state = createIndividualStateStore(session);
      const revisions = createRevisionStore(session);
      const operations = createOperationStore(session);
      const revision = {
        memoryId: "sqlite-memory",
        revision: 1,
        body: "Synthetic memory",
        source: { reference: "test:sqlite", excerpt: "Synthetic source" },
        reason: null,
        recordedAt: "2026-09-30T00:00:00.000Z",
        changeSequence: 1,
      };
      const receipt = {
        fingerprint: "synthetic-fingerprint",
        memoryId: revision.memoryId,
        revision: revision.revision,
        recordedAt: revision.recordedAt,
        changeSequence: revision.changeSequence,
      };
      storage.transactionSync(() => {
        revisions.append(revision);
        state.advance(0, 1);
        operations.record("sqlite-operation", receipt);
      });
      expect(state.read()).toEqual({
        individualId: "sqlite-individual",
        changeSequence: 1,
      });
      expect(revisions.find(revision.memoryId)).toEqual(revision);
      expect(operations.find("sqlite-operation")).toEqual(receipt);
      const correction = {
        ...revision,
        revision: 2,
        changeSequence: 2,
        body: "Corrected",
        reason: "New evidence",
      };
      const other = { ...revision, memoryId: "second", changeSequence: 3 };
      storage.transactionSync(() => {
        revisions.append(correction);
        state.advance(1, 2);
        revisions.append(other);
        state.advance(2, 3);
      });
      expect(revisions.list(0, 0, 10)).toEqual([]);
      expect(revisions.list(1, 0, 10)).toEqual([revision]);
      expect(revisions.list(3, 0, 1)).toEqual([correction]);
      expect(revisions.list(3, 2, 10)).toEqual([other]);
      expect(revisions.list(3, 0, 10)).toEqual([correction, other]);
      expect(storage.kv.get("memory:schema-version")).toBeUndefined();

      for (const reversal of [...reversals].reverse())
        storage.sql.exec(reversal.sql);
      for (const migration of migrations) storage.sql.exec(migration.sql);
      expect(revisions.find(revision.memoryId)).toBeNull();
      expect(operations.find("sqlite-operation")).toBeNull();
    },
  );
});
