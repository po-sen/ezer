import { DatabaseSync } from "node:sqlite";

export function openDatabase(path: string, readOnly: boolean): DatabaseSync {
  const database = new DatabaseSync(path, { readOnly });
  database.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
  return database;
}
