export class WorkspaceFault extends Error {
  readonly code:
    | "INVALID_INPUT"
    | "NOT_FOUND"
    | "VERSION_CONFLICT"
    | "PATH_OCCUPIED"
    | "OPERATION_CONFLICT";
  constructor(code: WorkspaceFault["code"]) {
    super(code);
    this.code = code;
  }
}
