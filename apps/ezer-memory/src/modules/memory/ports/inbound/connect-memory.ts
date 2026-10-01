import type { MemoryConnection } from "./memory-connection.ts";

export interface ConnectMemory {
  execute(credential: string | null): Promise<
    | ({ readonly ok: true } & MemoryConnection)
    | {
        readonly ok: false;
        readonly code:
          | "IDENTITY_REQUIRED"
          | "INDIVIDUAL_NOT_GRANTED"
          | "CONNECTION_NOT_GRANTED"
          | "UNAVAILABLE";
      }
  >;
}
