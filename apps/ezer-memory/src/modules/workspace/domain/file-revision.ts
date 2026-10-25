export interface FileRevision {
  readonly fileId: string;
  readonly version: number;
  readonly path: string;
  readonly content: Uint8Array;
  readonly mediaType: string;
  readonly deleted: boolean;
  readonly changedAt: string;
  readonly changeSequence: number;
}
