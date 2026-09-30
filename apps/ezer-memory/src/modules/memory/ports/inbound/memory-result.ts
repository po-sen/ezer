export type MemoryFailureCode =
  | "INVALID_INPUT"
  | "ALREADY_EXISTS"
  | "NOT_FOUND"
  | "REVISION_CONFLICT"
  | "OPERATION_CONFLICT"
  | "CAPACITY_EXCEEDED"
  | "UNAVAILABLE"
  | "INTERNAL_ERROR";
export type MemoryResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: MemoryFailureCode };
