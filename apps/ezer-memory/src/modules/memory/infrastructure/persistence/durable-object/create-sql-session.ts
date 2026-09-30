import { PersistenceFault } from "../../../ports/outbound/index.ts";
import type { SqlSession } from "./session.ts";
import type { SqlValue } from "./sql-value.ts";

export function createSqlSession(
  sql: SqlStorage,
  isActive: () => boolean,
): SqlSession {
  return {
    query<T extends Record<string, SqlValue>>(
      statement: string,
      ...bindings: SqlValue[]
    ): T[] {
      if (!isActive())
        throw new Error("Memory store used outside its Unit of Work");
      try {
        return sql.exec<T>(statement, ...bindings).toArray();
      } catch {
        throw new PersistenceFault();
      }
    },
  };
}
