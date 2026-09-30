import type { SqlSession } from "./session";

export function initializeIndividual(
  session: SqlSession,
  individualId: string,
): void {
  session.query(
    "INSERT INTO state (singleton, individual_id, change_sequence) VALUES (1, ?, 0) ON CONFLICT(singleton) DO NOTHING",
    individualId,
  );
  const state = session.query<{ individual_id: string }>(
    "SELECT individual_id FROM state WHERE singleton = 1",
  )[0];
  if (!state || state.individual_id !== individualId)
    throw new Error("Memory store identity mismatch");
}
