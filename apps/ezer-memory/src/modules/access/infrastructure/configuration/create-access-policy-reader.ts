import type { AccessPolicyReader } from "../../ports/outbound/index.ts";

interface SubjectBinding {
  readonly subject: string;
  readonly individualId: string;
}

export function createAccessPolicyReader(
  bindings: readonly SubjectBinding[] | undefined,
): AccessPolicyReader {
  const assignments = bindings?.map((binding) => ({
    callerId: binding.subject,
    individualId: binding.individualId,
  }));
  return {
    read: () =>
      assignments && {
        assignments: assignments.map((assignment) => ({ ...assignment })),
      },
  };
}
