export interface WorkspaceFile {
  readonly fileId: string;
  readonly version: number;
  readonly path: string;
  readonly size: number;
  readonly mediaType: string;
  readonly deleted: boolean;
  readonly changedAt: string;
  readonly changeSequence: number;
}
