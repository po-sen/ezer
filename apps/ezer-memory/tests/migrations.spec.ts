import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { migrateMemory } from "../src/memory/infrastructure/persistence/sqlite/migrate-memory";
import { initializeIndividual } from "../src/memory/infrastructure/persistence/sqlite/initialize-individual";
import {
  migrations,
  reversals,
} from "../src/memory/infrastructure/persistence/sqlite/migrations/generated";

function individual() {
  return env.EZER_MEMORY.get(env.EZER_MEMORY.newUniqueId());
}

describe("versioned SQL migrations in SQLite Durable Objects", () => {
  it("rolls back a failed first installation without leaving SQL or a version ledger", async () => {
    await runInDurableObject(individual(), async (_instance, { storage }) => {
      // This unique test database contains synthetic fixtures only.
      await storage.deleteAll();
      const broken = [
        {
          ...migrations[0]!,
          sql: migrations[0]!.sql + " INSERT INTO absent VALUES (1);",
        },
      ];
      expect(() => migrateMemory(storage, broken)).toThrow();
      expect(storage.kv.get("memory:schema-version")).toBeUndefined();
      expect(
        storage.sql
          .exec(
            "SELECT name FROM sqlite_master WHERE name IN ('state', 'revisions', 'operations')",
          )
          .toArray(),
      ).toEqual([]);
      migrateMemory(storage);
      expect(storage.kv.get("memory:schema-version")).toBe(1);
    });
  });

  it("applies a fresh baseline, repeats without losing data, and applies a later version once", async () => {
    await runInDurableObject(individual(), (_instance, { storage, id }) => {
      storage.sql.exec(
        "INSERT INTO revisions VALUES ('preserved', 1, 'Original body', 'conversation:1', 'Source excerpt', NULL, '2026-09-30T00:00:00.000Z', 1)",
      );
      storage.sql.exec(
        "INSERT INTO operations VALUES ('preserved-op', 'digest', 'preserved', 1)",
      );
      storage.sql.exec(
        "UPDATE state SET change_sequence = 1 WHERE singleton = 1",
      );
      const original = storage.sql.exec("SELECT * FROM revisions").toArray();
      expect(storage.kv.get("memory:schema-version")).toBe(1);
      initializeIndividual(storage, id.toString());
      migrateMemory(storage);
      const next = [
        ...migrations,
        {
          idMonotonicInc: 2,
          description: "synthetic upgrade",
          sql: "ALTER TABLE state ADD COLUMN upgrade_marker TEXT NOT NULL DEFAULT 'preserved';",
        },
      ];
      migrateMemory(storage, next);
      migrateMemory(storage, next);
      expect(storage.kv.get("memory:schema-version")).toBe(2);
      expect(
        storage.sql
          .exec("SELECT individual_id, upgrade_marker FROM state")
          .one(),
      ).toEqual({ individual_id: id.toString(), upgrade_marker: "preserved" });
      expect(storage.sql.exec("SELECT * FROM revisions").toArray()).toEqual(
        original,
      );
      expect(
        storage.sql.exec("SELECT operation_id FROM operations").one(),
      ).toEqual({ operation_id: "preserved-op" });
      expect(
        storage.sql.exec("SELECT change_sequence FROM state").one(),
      ).toEqual({ change_sequence: 1 });
      expect(() => migrateMemory(storage)).toThrow("Unsupported memory schema");
    });
  });

  it("reverses and recreates the SQL baseline through explicit forward compensation", async () => {
    await runInDurableObject(individual(), (_instance, { storage }) => {
      const down = {
        idMonotonicInc: 2,
        description: "synthetic baseline reversal",
        sql: reversals[0]!.sql,
      };
      migrateMemory(storage, [...migrations, down]);
      const tables = storage.sql
        .exec<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'table'",
        )
        .toArray()
        .map((row) => row.name);
      expect(tables).not.toContain("state");
      expect(tables).not.toContain("revisions");
      expect(tables).not.toContain("operations");
      expect(storage.kv.get("memory:schema-version")).toBe(2);
      const up = {
        idMonotonicInc: 3,
        description: "synthetic baseline recreation",
        sql: migrations[0]!.sql,
      };
      migrateMemory(storage, [...migrations, down, up]);
      expect(storage.kv.get("memory:schema-version")).toBe(3);
      expect(storage.sql.exec("SELECT * FROM revisions").toArray()).toEqual([]);
    });
  });

  it("rolls back DDL, data, and native migration progress on failure; a fresh runner can retry", async () => {
    await runInDurableObject(individual(), (_instance, { storage, id }) => {
      const broken = {
        idMonotonicInc: 2,
        description: "synthetic failure",
        sql: "CREATE TABLE upgrade_probe (value TEXT); UPDATE state SET individual_id = 'wrong'; INSERT INTO missing_table VALUES (1);",
      };
      expect(() => migrateMemory(storage, [...migrations, broken])).toThrow();
      expect(storage.kv.get("memory:schema-version")).toBe(1);
      expect(
        storage.sql
          .exec("SELECT name FROM sqlite_master WHERE name = 'upgrade_probe'")
          .toArray(),
      ).toEqual([]);
      expect(storage.sql.exec("SELECT individual_id FROM state").one()).toEqual(
        { individual_id: id.toString() },
      );
      const fixed = {
        ...broken,
        sql: "CREATE TABLE upgrade_probe (value TEXT);",
      };
      migrateMemory(storage, [...migrations, fixed]);
      expect(storage.kv.get("memory:schema-version")).toBe(2);
    });
  });

  it("rejects unsupported or unreleased state without overwriting records", async () => {
    await runInDurableObject(individual(), (_instance, { storage }) => {
      for (const version of [-1, 0, 1.5, 99]) {
        storage.kv.put("memory:schema-version", version);
        expect(() => migrateMemory(storage)).toThrow(
          "Unsupported memory schema",
        );
        expect(storage.kv.get("memory:schema-version")).toBe(version);
      }
      storage.kv.put("memory:schema-version", 1);
      storage.sql.exec("CREATE TABLE memory_schema (version INTEGER)");
      expect(() => migrateMemory(storage)).toThrow("Unreleased memory schema");
      expect(storage.sql.exec("SELECT * FROM state").toArray()).toHaveLength(1);
    });
  });
});
