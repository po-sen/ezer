export function requireLocalConnection<T extends { readonly ok: boolean }>(
  result: T,
): Extract<T, { readonly ok: true }> {
  if (!result.ok) throw new Error("Local connection denied");
  return result as Extract<T, { readonly ok: true }>;
}
