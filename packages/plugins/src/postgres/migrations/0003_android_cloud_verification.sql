CREATE TABLE IF NOT EXISTS android_apk_builds (
  attempt_id TEXT PRIMARY KEY,
  change_request_id TEXT NOT NULL CHECK (length(trim(change_request_id)) > 0),
  source_sha TEXT NOT NULL CHECK (source_sha ~ '^[0-9a-f]{40}$'),
  apk_artifact_key TEXT NOT NULL UNIQUE,
  apk_sha256 TEXT NOT NULL CHECK (apk_sha256 ~ '^[0-9a-f]{64}$'),
  apk_byte_length BIGINT NOT NULL CHECK (apk_byte_length > 0 AND apk_byte_length <= 67108864),
  build_sandbox_id TEXT NOT NULL CHECK (length(trim(build_sandbox_id)) > 0),
  package_name TEXT NOT NULL CHECK (length(trim(package_name)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (attempt_id, apk_sha256)
);

CREATE INDEX IF NOT EXISTS idx_android_apk_builds_cr
  ON android_apk_builds (change_request_id, created_at DESC);

CREATE TABLE IF NOT EXISTS cloud_device_runs (
  run_id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL,
  change_request_id TEXT NOT NULL CHECK (length(trim(change_request_id)) > 0),
  provider_id TEXT NOT NULL CHECK (length(trim(provider_id)) > 0),
  source_sha TEXT NOT NULL CHECK (source_sha ~ '^[0-9a-f]{40}$'),
  apk_artifact_key TEXT NOT NULL CHECK (length(trim(apk_artifact_key)) > 0),
  apk_sha256 TEXT NOT NULL CHECK (apk_sha256 ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL CHECK (status IN ('dispatched', 'passed', 'failed')),
  observation JSONB CHECK (observation IS NULL OR jsonb_typeof(observation) = 'object'),
  artifact_keys JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(artifact_keys) = 'array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT fk_cloud_device_runs_apk_build
    FOREIGN KEY (attempt_id, apk_sha256)
    REFERENCES android_apk_builds (attempt_id, apk_sha256)
    ON DELETE RESTRICT,
  CONSTRAINT chk_cloud_device_runs_passed_requires_observation
    CHECK (status <> 'passed' OR (observation IS NOT NULL AND completed_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_cloud_device_runs_attempt
  ON cloud_device_runs (attempt_id, created_at DESC);
