CREATE TABLE memory.state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  individual_id TEXT NOT NULL,
  change_sequence BIGINT NOT NULL CHECK (change_sequence >= 0 AND change_sequence <= 9007199254740991)
);
CREATE TABLE memory.revisions (
  memory_id TEXT NOT NULL,
  revision BIGINT NOT NULL CHECK (revision > 0 AND revision <= 9007199254740991),
  body TEXT NOT NULL,
  source_reference TEXT NOT NULL,
  source_excerpt TEXT NOT NULL,
  reason TEXT,
  recorded_at TIMESTAMPTZ NOT NULL,
  change_sequence BIGINT NOT NULL UNIQUE CHECK (change_sequence > 0 AND change_sequence <= 9007199254740991),
  PRIMARY KEY (memory_id, revision),
  CHECK ((revision = 1 AND reason IS NULL) OR (revision > 1 AND reason IS NOT NULL))
);
CREATE TABLE memory.operations (
  operation_id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  memory_id TEXT NOT NULL,
  revision BIGINT NOT NULL,
  FOREIGN KEY (memory_id, revision) REFERENCES memory.revisions(memory_id, revision)
);
