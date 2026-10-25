export interface WorkspaceConnection {
  readonly individualId: string;
  readonly capabilities: { readonly read: boolean; readonly write: boolean };
}
