CREATE TABLE IF NOT EXISTS delivery_receipts (
  delivery_id TEXT PRIMARY KEY,
  change_request_id TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS verification_attempts (
  id TEXT PRIMARY KEY,
  change_request_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'passed', 'incomplete', 'failed', 'cancelled')),
  generation INTEGER NOT NULL DEFAULT 1 CHECK (generation > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_verification_attempts_one_active_per_cr
  ON verification_attempts (change_request_id)
  WHERE status IN ('pending', 'running');

CREATE TABLE IF NOT EXISTS acceptance_decisions (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES verification_attempts (id) ON DELETE CASCADE,
  proposal_version INTEGER NOT NULL CHECK (proposal_version > 0),
  kind TEXT NOT NULL CHECK (kind IN ('approve', 'reject', 'waive')),
  actor_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_acceptance_decisions_attempt_proposal UNIQUE (attempt_id, proposal_version)
);

CREATE TABLE IF NOT EXISTS inbox_items (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES verification_attempts (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
