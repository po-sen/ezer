// Infrastructure discards provider diagnostics at the adapter boundary.
export class PersistenceFault extends Error {
  constructor() {
    super("Memory persistence unavailable");
    this.name = "PersistenceFault";
  }
}
