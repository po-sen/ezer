export class WorkspacePersistenceFault extends Error {
  constructor() {
    super("Workspace persistence unavailable");
  }
}
