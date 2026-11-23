CREATE TABLE IF NOT EXISTS android_apk_builds (
  attempt_id TEXT PRIMARY KEY,
  change_request_id TEXT NOT NULL,
  source_sha TEXT NOT NULL CHECK (source_sha ~ '^[0-9a-f]{40}$'),
  apk_artifact_key TEXT NOT NULL UNIQUE,
  apk_sha256 TEXT NOT NULL CHECK (apk_sha256 ~ '^[0-9a-f]{64}$'),
  apk_byte_length BIGINT NOT NULL CHECK (apk_byte_length > 0),
  build_sandbox_id TEXT NOT NULL,
  package_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_android_apk_builds_cr
  ON android_apk_builds (change_request_id, created_at DESC);

CREATE TABLE IF NOT EXISTS cloud_device_runs (
  run_id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL,
  change_request_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  source_sha TEXT NOT NULL CHECK (source_sha ~ '^[0-9a-f]{40}$'),
  apk_artifact_key TEXT NOT NULL,
  apk_sha256 TEXT NOT NULL CHECK (apk_sha256 ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL CHECK (status IN ('dispatched', 'passed', 'failed')),
  observation JSONB,
  artifact_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cloud_device_runs_attempt
  ON cloud_device_runs (attempt_id, created_at DESC);
