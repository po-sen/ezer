import type { RequestFingerprint } from "../ports/outbound/request-fingerprint.ts";

export function createRequestFingerprint(): RequestFingerprint {
  return {
    async digest(request) {
      const bytes = new TextEncoder().encode(request);
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
    },
  };
}
