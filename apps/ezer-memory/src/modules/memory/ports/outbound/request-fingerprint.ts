export interface RequestFingerprint {
  digest(request: string): Promise<string>;
}
