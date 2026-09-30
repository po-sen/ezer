import { PersistenceFault } from "../../../outboundport/persistence-fault";
export interface SqlSession {
  query<T extends Record<string, SqlStorageValue>>(
    sql: string,
    ...bindings: SqlStorageValue[]
  ): T[];
}
export function createSqlSession(
  sql: SqlStorage,
  isActive: () => boolean,
): SqlSession {
  return {
    query<T extends Record<string, SqlStorageValue>>(
      statement: string,
      ...bindings: SqlStorageValue[]
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
