export type SqlValue = ArrayBuffer | string | number | null;

export interface SqlSession {
  query<T extends Record<string, SqlValue>>(
    sql: string,
    ...bindings: SqlValue[]
  ): T[];
}
