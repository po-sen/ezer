export interface MemorySource {
  readonly reference: string;
  readonly excerpt: string;
}

interface MemoryContent {
  readonly operationId: string;
  readonly memoryId: string;
  readonly body: string;
  readonly source: MemorySource;
}

export type MemoryWrite =
  | (MemoryContent & { readonly kind: "remember" })
  | (MemoryContent & {
      readonly kind: "revise";
      readonly expectedRevision: number;
      readonly reason: string;
    });

export interface MemoryState {
  readonly individualId: string;
  readonly changeSequence: number;
}

export interface MemoryReceipt extends MemoryState {
  readonly memoryId: string;
  readonly revision: number;
  readonly recordedAt: string;
}

export interface MemoryRevision extends MemoryReceipt {
  readonly body: string;
  readonly source: MemorySource;
  readonly reason: string | null;
}

export interface MemoryLookup {
  readonly memoryId: string;
  readonly revision?: number;
}

export interface MemoryFailure {
  readonly ok: false;
  readonly code:
    | "INVALID_INPUT"
    | "ALREADY_EXISTS"
    | "NOT_FOUND"
    | "REVISION_CONFLICT"
    | "OPERATION_CONFLICT";
}

export type MemoryResult<T> =
  { readonly ok: true; readonly value: T } | MemoryFailure;
