import type { SqlValue } from "./sql-value.ts";

export interface SqlSession {
  query<T extends Record<string, SqlValue>>(
    sql: string,
    ...bindings: SqlValue[]
  ): T[];
}
