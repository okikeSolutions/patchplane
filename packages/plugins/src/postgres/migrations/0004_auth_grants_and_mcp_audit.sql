CREATE TABLE IF NOT EXISTS mcp_sessions (
  session_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL CHECK (length(organization_id) > 0),
  principal_id TEXT NOT NULL CHECK (length(principal_id) > 0),
  agent_actor_id TEXT NOT NULL CHECK (length(agent_actor_id) > 0),
  status TEXT NOT NULL CHECK (status IN ('active', 'terminated')),
  created_at_ms BIGINT NOT NULL CHECK (created_at_ms > 0),
  terminated_at_ms BIGINT CHECK (terminated_at_ms IS NULL OR terminated_at_ms >= created_at_ms),
  CHECK (status = 'active' OR terminated_at_ms IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS delegated_mcp_grants (
  grant_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL CHECK (length(organization_id) > 0),
  repository_id TEXT NOT NULL CHECK (length(repository_id) > 0),
  human_delegator_id TEXT NOT NULL CHECK (length(human_delegator_id) > 0),
  agent_actor_id TEXT NOT NULL CHECK (length(agent_actor_id) > 0),
  session_id TEXT NOT NULL REFERENCES mcp_sessions (session_id) ON DELETE CASCADE,
  allowed_fields JSONB NOT NULL CHECK (
    jsonb_typeof(allowed_fields) = 'array'
    AND jsonb_array_length(allowed_fields) > 0
  ),
  scope TEXT NOT NULL CHECK (scope = 'session'),
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked', 'expired')),
  created_at_ms BIGINT NOT NULL CHECK (created_at_ms > 0),
  expires_at_ms BIGINT NOT NULL CHECK (expires_at_ms > created_at_ms),
  revoked_at_ms BIGINT CHECK (revoked_at_ms IS NULL OR revoked_at_ms >= created_at_ms),
  revoked_by TEXT,
  CHECK (status <> 'revoked' OR (revoked_at_ms IS NOT NULL AND revoked_by IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_delegated_mcp_grants_session_status
  ON delegated_mcp_grants (session_id, status);

CREATE TABLE IF NOT EXISTS attempt_proposal_versions (
  attempt_id TEXT PRIMARY KEY REFERENCES verification_attempts (id) ON DELETE CASCADE,
  repository_id TEXT NOT NULL CHECK (length(repository_id) > 0),
  current_version INTEGER NOT NULL CHECK (current_version > 0),
  updated_at_ms BIGINT NOT NULL CHECK (updated_at_ms > 0)
);

CREATE TABLE IF NOT EXISTS repository_configs (
  repository_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL CHECK (version > 0),
  config_values JSONB NOT NULL CHECK (jsonb_typeof(config_values) = 'object'),
  updated_by_attribution JSONB NOT NULL CHECK (jsonb_typeof(updated_by_attribution) = 'object'),
  updated_at_ms BIGINT NOT NULL CHECK (updated_at_ms > 0)
);

CREATE TABLE IF NOT EXISTS authority_audit_events (
  event_id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL CHECK (length(repository_id) > 0),
  action TEXT NOT NULL CHECK (length(action) > 0),
  attempt_id TEXT,
  proposal_version INTEGER CHECK (proposal_version IS NULL OR proposal_version > 0),
  attribution JSONB NOT NULL CHECK (jsonb_typeof(attribution) = 'object'),
  grant_id TEXT,
  before_config_version INTEGER CHECK (before_config_version IS NULL OR before_config_version > 0),
  after_config_version INTEGER CHECK (after_config_version IS NULL OR after_config_version > 0),
  created_at_ms BIGINT NOT NULL CHECK (created_at_ms > 0)
);

CREATE INDEX IF NOT EXISTS idx_authority_audit_events_repo_created
  ON authority_audit_events (repository_id, created_at_ms DESC);
