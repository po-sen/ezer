import { PersistenceFault } from "../../../ports/outbound/persistence-fault.ts";

export type SqlValue = SqlStorageValue;

export interface SqlSession {
  query<T extends Record<string, SqlValue>>(
    sql: string,
    ...bindings: SqlValue[]
  ): T[];
}

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
