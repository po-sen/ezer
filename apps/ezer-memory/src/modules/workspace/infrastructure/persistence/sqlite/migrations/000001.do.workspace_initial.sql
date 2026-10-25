CREATE TABLE workspace_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  individual_id TEXT NOT NULL,
  change_sequence INTEGER NOT NULL CHECK (change_sequence >= 0)
) STRICT;

CREATE TABLE file_revisions (
  file_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  path TEXT NOT NULL,
  content BLOB NOT NULL CHECK (length(content) <= 1048576),
  media_type TEXT NOT NULL,
  deleted INTEGER NOT NULL CHECK (deleted IN (0, 1)),
  changed_at TEXT NOT NULL,
  change_sequence INTEGER NOT NULL UNIQUE CHECK (change_sequence > 0),
  PRIMARY KEY (file_id, version)
) STRICT;

CREATE TABLE file_heads (
  file_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  path TEXT NOT NULL,
  deleted INTEGER NOT NULL CHECK (deleted IN (0, 1)),
  FOREIGN KEY (file_id, version) REFERENCES file_revisions(file_id, version)
) STRICT;
CREATE UNIQUE INDEX active_file_paths ON file_heads(path) WHERE deleted = 0;

CREATE TABLE workspace_operations (
  operation_id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  file_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  FOREIGN KEY (file_id, version) REFERENCES file_revisions(file_id, version)
) STRICT;
