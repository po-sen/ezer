export function initializeIndividual(
  storage: DurableObjectStorage,
  individualId: string,
): void {
  storage.transactionSync(() => {
    storage.sql.exec(
      "INSERT INTO state (singleton, individual_id, change_sequence) VALUES (1, ?, 0) ON CONFLICT(singleton) DO NOTHING",
      individualId,
    );
    const state = storage.sql
      .exec<{ individual_id: string }>(
        "SELECT individual_id FROM state WHERE singleton = 1",
      )
      .one();
    if (state.individual_id !== individualId)
      throw new Error("Memory store identity mismatch");
  });
}
