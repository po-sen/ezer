interface Content {
  readonly operationId: string;
  readonly memoryId: string;
  readonly body: string;
  readonly source: { readonly reference: string; readonly excerpt: string };
}
type Write =
  | (Content & { readonly kind: "remember" })
  | (Content & {
      readonly kind: "revise";
      readonly expectedRevision: number;
      readonly reason: string;
    });
interface Receipt {
  readonly memoryId: string;
  readonly revision: number;
  readonly recordedAt: string;
  readonly changeSequence: number;
}
type Result<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly code:
        | "READ_NOT_GRANTED"
        | "WRITE_NOT_GRANTED"
        | "INVALID_INPUT"
        | "ALREADY_EXISTS"
        | "NOT_FOUND"
        | "REVISION_CONFLICT"
        | "OPERATION_CONFLICT"
        | "CAPACITY_EXCEEDED"
        | "UNAVAILABLE"
        | "INTERNAL_ERROR";
    };
interface Cursor {
  readonly snapshotSequence: number;
  readonly afterSequence: number;
}
// Logical individual routing and detached content, never a storage handle or native owner ID.
export interface MemoryPersistence {
  commit(individualId: string, command: Write): Promise<Result<Receipt>>;
  inspect(
    individualId: string,
    query: { readonly memoryId: string; readonly revision?: number },
  ): Promise<
    Result<{
      readonly changeSequence: number;
      readonly memory: Receipt & {
        readonly body: string;
        readonly source: {
          readonly reference: string;
          readonly excerpt: string;
        };
        readonly reason: string | null;
      };
    }>
  >;
  list(
    individualId: string,
    query: { readonly limit?: number; readonly cursor?: Cursor },
  ): Promise<
    Result<{
      readonly changeSequence: number;
      readonly memories: readonly (Receipt & { readonly preview: string })[];
      readonly nextCursor: Cursor | null;
    }>
  >;
}
