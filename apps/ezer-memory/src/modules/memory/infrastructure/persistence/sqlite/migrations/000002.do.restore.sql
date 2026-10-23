CREATE TABLE restore (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  restore_id TEXT NOT NULL,
  snapshot_sequence INTEGER NOT NULL CHECK (snapshot_sequence >= 0 AND snapshot_sequence <= 9007199254740991),
  complete INTEGER NOT NULL CHECK (complete IN (0, 1))
);
