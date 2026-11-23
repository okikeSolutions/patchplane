CREATE TABLE IF NOT EXISTS verification_sandboxes (
  sandbox_id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL,
  change_request_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'deleted', 'quarantined')),
  labels JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_verification_sandboxes_status
  ON verification_sandboxes (status);

CREATE INDEX IF NOT EXISTS idx_verification_sandboxes_attempt
  ON verification_sandboxes (attempt_id);

CREATE TABLE IF NOT EXISTS verification_artifacts (
  artifact_key TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL,
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
  content_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_verification_artifacts_attempt
  ON verification_artifacts (attempt_id);

CREATE TABLE IF NOT EXISTS environment_quarantines (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL,
  sandbox_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('quarantined', 'released')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS decision_inbox_items (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('cleanup_quarantine')),
  status TEXT NOT NULL CHECK (status IN ('open', 'resolved')),
  summary TEXT NOT NULL,
  sandbox_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_decision_inbox_items_open
  ON decision_inbox_items (status)
  WHERE status = 'open';
