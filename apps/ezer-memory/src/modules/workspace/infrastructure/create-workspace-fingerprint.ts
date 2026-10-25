import { createHash } from "node:crypto";
import type { WorkspaceFingerprint } from "../ports/outbound/index.ts";

export function createWorkspaceFingerprint(): WorkspaceFingerprint {
  return {
    async digest(metadata, content) {
      return createHash("sha256")
        .update(metadata)
        .update("\0")
        .update(content ?? new Uint8Array())
        .digest("hex");
    },
  };
}
