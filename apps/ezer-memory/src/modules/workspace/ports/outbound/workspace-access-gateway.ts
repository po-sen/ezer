export interface WorkspaceAccessGateway {
  authorize(): Promise<{
    readonly individualId: string;
    readonly readFiles: boolean;
    readonly writeFiles: boolean;
  } | null>;
}
