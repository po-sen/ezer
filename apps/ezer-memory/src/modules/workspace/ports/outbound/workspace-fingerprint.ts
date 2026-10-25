export interface WorkspaceFingerprint {
  digest(metadata: string, content?: Uint8Array): Promise<string>;
}
