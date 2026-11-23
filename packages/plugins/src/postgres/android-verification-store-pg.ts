import { Effect, Layer, Option, Schema } from 'effect'
import { SqlClient } from 'effect/sql'
import { AndroidVerificationStore } from '@patchplane/core'
import {
  AndroidApkBuildRecord,
  ArbeoJourneyObservation,
  ArtifactKey,
  CloudDeviceRunRecord,
  PersistenceError,
  sanitizeErrorMessage,
} from '@patchplane/domain'

const StrictPositiveSafeInt = Schema.Union([
  Schema.Int.check(
    Schema.isGreaterThan(0),
    Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
  ),
  Schema.String.check(Schema.isPattern(/^[1-9]\d*$/)),
  Schema.BigInt,
])

const ArtifactKeysColumn = Schema.Union([
  Schema.Array(ArtifactKey),
  Schema.fromJsonString(Schema.Array(ArtifactKey)),
])

const ObservationColumn = Schema.NullOr(
  Schema.Union([
    ArbeoJourneyObservation,
    Schema.fromJsonString(ArbeoJourneyObservation),
  ]),
)

const RawApkBuildRow = Schema.Struct({
  attempt_id: Schema.String,
  change_request_id: Schema.String,
  source_sha: Schema.String,
  apk_artifact_key: Schema.String,
  apk_sha256: Schema.String,
  apk_byte_length: StrictPositiveSafeInt,
  build_sandbox_id: Schema.String,
  package_name: Schema.String,
})

const RawCloudDeviceRunRow = Schema.Struct({
  run_id: Schema.String,
  attempt_id: Schema.String,
  change_request_id: Schema.String,
  provider_id: Schema.String,
  source_sha: Schema.String,
  apk_artifact_key: Schema.String,
  apk_sha256: Schema.String,
  status: Schema.String,
  observation: ObservationColumn,
  artifact_keys: ArtifactKeysColumn,
})

/**
 * Maps SQL/decode failures to `PersistenceError` without raw unsanitized
 * `cause` objects so workflow error journals never persist driver internals.
 */
const persistenceError = (operation: string) =>
  Effect.mapError(
    (cause: unknown) =>
      new PersistenceError({
        operation,
        message: sanitizeErrorMessage(cause),
      }),
  )

const parseSafeByteLength = (
  value: number | string | bigint,
  operation: string,
) =>
  Effect.gen(function* () {
    const numeric =
      typeof value === 'number'
        ? value
        : typeof value === 'bigint'
          ? Number(value)
          : Number(value)
    if (!Number.isSafeInteger(numeric) || numeric <= 0) {
      return yield* new PersistenceError({
        operation,
        message:
          'Stored apk_byte_length is outside safe positive integer range',
      })
    }
    return numeric
  })

const decodeApkBuildRow = Effect.fnUntraced(function* (
  row: unknown,
  operation: string,
) {
  const raw = yield* Schema.decodeUnknownEffect(RawApkBuildRow)(row).pipe(
    persistenceError(operation),
  )
  const byteLength = yield* parseSafeByteLength(raw.apk_byte_length, operation)
  return yield* Schema.decodeEffect(AndroidApkBuildRecord)({
    attemptId: raw.attempt_id,
    changeRequestId: raw.change_request_id,
    sourceSha: raw.source_sha,
    apkArtifactKey: raw.apk_artifact_key,
    apkSha256: raw.apk_sha256,
    apkByteLength: byteLength,
    buildSandboxId: raw.build_sandbox_id,
    packageName: raw.package_name,
  }).pipe(persistenceError(operation))
})

const decodeCloudDeviceRunRow = Effect.fnUntraced(function* (
  row: unknown,
  operation: string,
) {
  const raw = yield* Schema.decodeUnknownEffect(RawCloudDeviceRunRow)(row).pipe(
    persistenceError(operation),
  )
  return yield* Schema.decodeUnknownEffect(CloudDeviceRunRecord)({
    runId: raw.run_id,
    attemptId: raw.attempt_id,
    changeRequestId: raw.change_request_id,
    providerId: raw.provider_id,
    sourceSha: raw.source_sha,
    apkArtifactKey: raw.apk_artifact_key,
    apkSha256: raw.apk_sha256,
    status: raw.status,
    ...(raw.observation !== null ? { observation: raw.observation } : {}),
    artifactKeys: raw.artifact_keys,
  }).pipe(persistenceError(operation))
})

export const PostgresAndroidVerificationStoreLayer = Layer.effect(
  AndroidVerificationStore,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    return AndroidVerificationStore.of({
      recordApkBuild: Effect.fn(
        'PostgresAndroidVerificationStore.recordApkBuild',
      )(function* (build) {
        const operation = 'AndroidVerificationStore.recordApkBuild'
        const rows = yield* sql`
          INSERT INTO android_apk_builds (
            attempt_id,
            change_request_id,
            source_sha,
            apk_artifact_key,
            apk_sha256,
            apk_byte_length,
            build_sandbox_id,
            package_name
          )
          VALUES (
            ${build.attemptId},
            ${build.changeRequestId},
            ${build.sourceSha},
            ${build.apkArtifactKey},
            ${build.apkSha256},
            ${build.apkByteLength},
            ${build.buildSandboxId},
            ${build.packageName}
          )
          ON CONFLICT (attempt_id) DO UPDATE
            SET apk_byte_length = android_apk_builds.apk_byte_length
            WHERE android_apk_builds.change_request_id = EXCLUDED.change_request_id
              AND android_apk_builds.source_sha = EXCLUDED.source_sha
              AND android_apk_builds.apk_sha256 = EXCLUDED.apk_sha256
              AND android_apk_builds.apk_artifact_key = EXCLUDED.apk_artifact_key
              AND android_apk_builds.apk_byte_length = EXCLUDED.apk_byte_length
              AND android_apk_builds.package_name = EXCLUDED.package_name
          RETURNING attempt_id, change_request_id, source_sha, apk_artifact_key, apk_sha256, apk_byte_length, build_sandbox_id, package_name
        `.pipe(persistenceError(operation))

        const first = rows[0]
        if (first === undefined) {
          return yield* new PersistenceError({
            operation,
            message: `APK build for attempt "${build.attemptId}" already exists with conflicting metadata or digest`,
          })
        }
        return yield* decodeApkBuildRow(first, operation)
      }),

      recordCloudDeviceRun: Effect.fn(
        'PostgresAndroidVerificationStore.recordCloudDeviceRun',
      )(function* (run) {
        const operation = 'AndroidVerificationStore.recordCloudDeviceRun'
        const observationJson =
          run.observation !== undefined ? JSON.stringify(run.observation) : null
        const artifactKeysJson = JSON.stringify(run.artifactKeys)
        const isTerminal = run.status === 'passed' || run.status === 'failed'

        // Forward-only state machine:
        // - 'dispatched' -> 'passed' | 'failed' (with identical immutable identity)
        // - Identical idempotent replay of an already-recorded row succeeds
        // - Conflicting terminal transitions or identity mismatches fail closed
        const rows = yield* sql`
          INSERT INTO cloud_device_runs (
            run_id,
            attempt_id,
            change_request_id,
            provider_id,
            source_sha,
            apk_artifact_key,
            apk_sha256,
            status,
            observation,
            artifact_keys,
            completed_at
          )
          VALUES (
            ${run.runId},
            ${run.attemptId},
            ${run.changeRequestId},
            ${run.providerId},
            ${run.sourceSha},
            ${run.apkArtifactKey},
            ${run.apkSha256},
            ${run.status},
            ${observationJson}::jsonb,
            ${artifactKeysJson}::jsonb,
            CASE WHEN ${isTerminal} THEN now() ELSE NULL END
          )
          ON CONFLICT (run_id) DO UPDATE
            SET status = EXCLUDED.status,
                observation = COALESCE(EXCLUDED.observation, cloud_device_runs.observation),
                artifact_keys = EXCLUDED.artifact_keys,
                completed_at = CASE
                  WHEN EXCLUDED.status IN ('passed', 'failed') THEN COALESCE(cloud_device_runs.completed_at, now())
                  ELSE cloud_device_runs.completed_at
                END
            WHERE cloud_device_runs.attempt_id = EXCLUDED.attempt_id
              AND cloud_device_runs.change_request_id = EXCLUDED.change_request_id
              AND cloud_device_runs.provider_id = EXCLUDED.provider_id
              AND cloud_device_runs.source_sha = EXCLUDED.source_sha
              AND cloud_device_runs.apk_artifact_key = EXCLUDED.apk_artifact_key
              AND cloud_device_runs.apk_sha256 = EXCLUDED.apk_sha256
              AND (
                (cloud_device_runs.status = 'dispatched' AND EXCLUDED.status IN ('passed', 'failed'))
                OR (
                  cloud_device_runs.status = EXCLUDED.status
                  AND cloud_device_runs.observation IS NOT DISTINCT FROM EXCLUDED.observation
                  AND cloud_device_runs.artifact_keys = EXCLUDED.artifact_keys
                )
              )
          RETURNING run_id, attempt_id, change_request_id, provider_id, source_sha, apk_artifact_key, apk_sha256, status, observation, artifact_keys
        `.pipe(persistenceError(operation))

        const first = rows[0]
        if (first === undefined) {
          return yield* new PersistenceError({
            operation,
            message: `Cloud device run "${run.runId}" cannot be mutated once terminal or mismatched`,
          })
        }
        return yield* decodeCloudDeviceRunRow(first, operation)
      }),

      findApkBuildByAttempt: Effect.fn(
        'PostgresAndroidVerificationStore.findApkBuildByAttempt',
      )(function* (attemptId) {
        const operation = 'AndroidVerificationStore.findApkBuildByAttempt'
        const rows = yield* sql`
          SELECT attempt_id, change_request_id, source_sha, apk_artifact_key, apk_sha256, apk_byte_length, build_sandbox_id, package_name
          FROM android_apk_builds
          WHERE attempt_id = ${attemptId}
        `.pipe(persistenceError(operation))

        const first = rows[0]
        if (first === undefined) return Option.none()
        return Option.some(yield* decodeApkBuildRow(first, operation))
      }),

      findCloudDeviceRunById: Effect.fn(
        'PostgresAndroidVerificationStore.findCloudDeviceRunById',
      )(function* (runId) {
        const operation = 'AndroidVerificationStore.findCloudDeviceRunById'
        const rows = yield* sql`
          SELECT run_id, attempt_id, change_request_id, provider_id, source_sha, apk_artifact_key, apk_sha256, status, observation, artifact_keys
          FROM cloud_device_runs
          WHERE run_id = ${runId}
        `.pipe(persistenceError(operation))

        const first = rows[0]
        if (first === undefined) return Option.none()
        return Option.some(yield* decodeCloudDeviceRunRow(first, operation))
      }),
    })
  }),
)
