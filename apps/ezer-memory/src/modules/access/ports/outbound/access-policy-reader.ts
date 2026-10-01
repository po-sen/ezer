import type { AccessPolicy } from "./access-policy.ts";

export interface AccessPolicyReader {
  read(): AccessPolicy | undefined;
}
