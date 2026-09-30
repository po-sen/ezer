import pg from "pg";

export function openDatabase(options: pg.ClientConfig): pg.Client {
  return new pg.Client({ connectionTimeoutMillis: 5000, ...options });
}
