CREATE TABLE state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  individual_id TEXT NOT NULL,
  change_sequence INTEGER NOT NULL CHECK (change_sequence >= 0 AND change_sequence <= 9007199254740991)
);
CREATE TABLE revisions (
  memory_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0 AND revision <= 9007199254740991),
  body TEXT NOT NULL,
  source_reference TEXT NOT NULL,
  source_excerpt TEXT NOT NULL,
  reason TEXT,
  recorded_at TEXT NOT NULL,
  change_sequence INTEGER NOT NULL UNIQUE CHECK (change_sequence > 0 AND change_sequence <= 9007199254740991),
  PRIMARY KEY (memory_id, revision),
  CHECK ((revision = 1 AND reason IS NULL) OR (revision > 1 AND reason IS NOT NULL))
);
CREATE TABLE operations (
  operation_id TEXT PRIMARY KEY NOT NULL,
  fingerprint TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  FOREIGN KEY (memory_id, revision) REFERENCES revisions(memory_id, revision)
);
