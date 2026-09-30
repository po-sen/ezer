export class MemoryFault extends Error {
  constructor(
    readonly code:
      | "INVALID_INPUT"
      | "ALREADY_EXISTS"
      | "NOT_FOUND"
      | "REVISION_CONFLICT"
      | "CAPACITY_EXCEEDED",
  ) {
    super(code);
    this.name = "MemoryFault";
  }
}
