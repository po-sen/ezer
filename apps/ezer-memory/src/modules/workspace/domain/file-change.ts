export type FileChange = {
  readonly fileId: string;
  readonly expectedVersion: number;
} & (
  | {
      readonly kind: "write";
      readonly path: string;
      readonly content: Uint8Array;
      readonly mediaType: string;
    }
  | { readonly kind: "move"; readonly path: string }
  | { readonly kind: "trash" }
  | {
      readonly kind: "restore";
      readonly version: number;
      readonly path?: string;
    }
);
