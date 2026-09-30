import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createSqliteUnitOfWork } from "../src/memory/infrastructure/persistence/sqlite/unit-of-work";
import { PersistenceFault } from "../src/memory/outboundport/persistence-fault";
import type { MemoryStores } from "../src/memory/outboundport/unit-of-work";

describe("SQLite Unit of Work boundaries", () => {
  it("revokes store capabilities after success or rollback, including a later transaction", async () => {
    await runInDurableObject(
      env.EZER_MEMORY.get(env.EZER_MEMORY.newUniqueId()),
      (_instance, { storage }) => {
        const uow = createSqliteUnitOfWork(storage);
        let leaked: MemoryStores | undefined;
        uow.within((stores) => {
          leaked = stores;
        });
        expect(() => leaked!.state.read()).toThrow("outside its Unit of Work");
        uow.within(() => {
          expect(() => leaked!.state.read()).toThrow(
            "outside its Unit of Work",
          );
        });
        const sentinel = new Error("application failure");
        expect(() =>
          uow.within((stores) => {
            leaked = stores;
            stores.state.advance(0, 1);
            throw sentinel;
          }),
        ).toThrow(sentinel);
        expect(() => leaked!.state.read()).toThrow("outside its Unit of Work");
        expect(uow.within((stores) => stores.state.read().changeSequence)).toBe(
          0,
        );
      },
    );
  });

  it("rejects nested and asynchronous work and rolls back partial writes", async () => {
    await runInDurableObject(
      env.EZER_MEMORY.get(env.EZER_MEMORY.newUniqueId()),
      (_instance, { storage }) => {
        const uow = createSqliteUnitOfWork(storage);
        expect(() => uow.within(() => uow.within(() => 1))).toThrow("Nested");
        // This compile-time rejection accompanies the runtime guard for JS callers.
        expect(() =>
          uow.within(
            // @ts-expect-error async callbacks are not part of the Unit of Work contract
            (stores) => {
              stores.state.advance(0, 1);
              return Promise.resolve();
            },
          ),
        ).toThrow("synchronous");
        expect(uow.within((stores) => stores.state.read().changeSequence)).toBe(
          0,
        );
      },
    );
  });

  it("enforces revision, source-history, sequence, and receipt referential constraints", async () => {
    await runInDurableObject(
      env.EZER_MEMORY.get(env.EZER_MEMORY.newUniqueId()),
      (_instance, { storage }) => {
        const sql = storage.sql;
        expect(() =>
          sql.exec(
            "INSERT INTO operations VALUES ('op', 'digest', 'missing', 1)",
          ),
        ).toThrow();
        for (const [revision, reason, sequence] of [
          [0, null, 1],
          [1, "unexpected", 1],
          [2, null, 1],
          [1, null, 0],
        ] as const) {
          expect(() =>
            sql.exec(
              "INSERT INTO revisions VALUES ('m', ?, 'body', 'source', 'excerpt', ?, '2026-09-30T00:00:00Z', ?)",
              revision,
              reason,
              sequence,
            ),
          ).toThrow();
        }
        sql.exec(
          "INSERT INTO revisions VALUES ('m', 1, 'body', 'source', 'excerpt', NULL, '2026-09-30T00:00:00Z', 1)",
        );
        expect(() =>
          sql.exec(
            "INSERT INTO revisions VALUES ('other', 1, 'body', 'source', 'excerpt', NULL, '2026-09-30T00:00:00Z', 1)",
          ),
        ).toThrow();
        expect(sql.exec("SELECT * FROM operations").toArray()).toEqual([]);
        expect(sql.exec("SELECT memory_id FROM revisions").toArray()).toEqual([
          { memory_id: "m" },
        ]);
      },
    );
  });

  it("normalizes SQL failures in infrastructure without retaining native diagnostics", async () => {
    await runInDurableObject(
      env.EZER_MEMORY.get(env.EZER_MEMORY.newUniqueId()),
      (_instance, { storage }) => {
        const uow = createSqliteUnitOfWork(storage);
        storage.sql.exec("DROP TABLE operations");
        try {
          uow.within((stores) => stores.operations.find("x"));
          throw new Error("Expected failure");
        } catch (error) {
          expect(error).toBeInstanceOf(PersistenceFault);
          expect((error as Error).message).toBe(
            "Memory persistence unavailable",
          );
          expect((error as Error).cause).toBeUndefined();
        }
      },
    );
  });
});
