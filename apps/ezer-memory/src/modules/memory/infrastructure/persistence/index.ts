// This grouping API exposes types only. Runtime composition selects an adapter index.
export type * as DurableObjectPersistence from "./durable-object/index.ts";
export type * as SqlitePersistence from "./sqlite/index.ts";
export type * as PostgresqlPersistence from "./postgresql/index.ts";
