import { openWorkspace } from "../modules/workspace/infrastructure/persistence/sqlite/index.ts";

export function createWorkspaceMigrator(
  path: string,
  directory: string,
  readOnly: boolean,
) {
  return openWorkspace(path, directory, readOnly);
}
