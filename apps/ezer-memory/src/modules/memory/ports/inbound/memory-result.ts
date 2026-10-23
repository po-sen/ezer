type MemoryFailureCode =
  | "RESTORE_NOT_GRANTED"
  | "RESTORE_IN_PROGRESS"
  | "RESTORE_CONFLICT"
  | "TARGET_NOT_EMPTY"
  | "IDENTITY_MISMATCH"
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
export type MemoryResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: MemoryFailureCode };
