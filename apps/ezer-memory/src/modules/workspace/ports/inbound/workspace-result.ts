export type WorkspaceResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly code:
        | "INVALID_INPUT"
        | "NOT_FOUND"
        | "VERSION_CONFLICT"
        | "PATH_OCCUPIED"
        | "OPERATION_CONFLICT"
        | "READ_NOT_GRANTED"
        | "WRITE_NOT_GRANTED"
        | "UNAVAILABLE";
    };
