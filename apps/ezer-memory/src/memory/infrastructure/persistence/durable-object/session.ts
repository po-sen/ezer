import { PersistenceFault } from "../../../outboundport/persistence-fault";
import type { SqlSession, SqlValue } from "../sqlite/session";

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
