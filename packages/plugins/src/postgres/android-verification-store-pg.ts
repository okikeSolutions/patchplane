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

const RawApkBuildRow = Schema.Struct({
  attempt_id: Schema.String,
  change_request_id: Schema.String,
  source_sha: Schema.String,
  apk_artifact_key: Schema.String,
  apk_sha256: Schema.String,
  apk_byte_length: Schema.Union([Schema.Finite, Schema.String, Schema.BigInt]),
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
  observation: Schema.NullOr(Schema.Unknown),
  artifact_keys: Schema.Unknown,
})

const persistenceError = (operation: string) =>
  Effect.mapError(
    (cause: unknown) =>
      new PersistenceError({
        operation,
        message: sanitizeErrorMessage(cause),
        cause,
      }),
  )

const decodeApkBuildRow = (row: unknown, operation: string) =>
  Effect.gen(function* () {
    const raw = yield* Schema.decodeUnknownEffect(RawApkBuildRow)(row).pipe(
      persistenceError(operation),
    )
    const byteLength =
      typeof raw.apk_byte_length === 'number'
        ? raw.apk_byte_length
        : typeof raw.apk_byte_length === 'bigint'
          ? Number(raw.apk_byte_length)
          : Number.parseInt(raw.apk_byte_length, 10)
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

const decodeCloudDeviceRunRow = (row: unknown, operation: string) =>
  Effect.gen(function* () {
    const raw = yield* Schema.decodeUnknownEffect(RawCloudDeviceRunRow)(
      row,
    ).pipe(persistenceError(operation))
    const rawKeysValue = raw.artifact_keys
    const rawKeys: unknown =
      typeof rawKeysValue === 'string'
        ? yield* Effect.try({
            try: () => JSON.parse(rawKeysValue) as unknown,
            catch: (cause) =>
              new PersistenceError({
                operation,
                message: sanitizeErrorMessage(cause),
                cause,
              }),
          })
        : rawKeysValue
    const artifactKeys = yield* Schema.decodeUnknownEffect(
      Schema.Array(ArtifactKey),
    )(rawKeys).pipe(persistenceError(operation))

    const rawObservationValue = raw.observation
    const rawObservation: unknown =
      typeof rawObservationValue === 'string'
        ? yield* Effect.try({
            try: () => JSON.parse(rawObservationValue) as unknown,
            catch: (cause) =>
              new PersistenceError({
                operation,
                message: sanitizeErrorMessage(cause),
                cause,
              }),
          })
        : rawObservationValue
    const observation =
      rawObservation !== null && rawObservation !== undefined
        ? yield* Schema.decodeUnknownEffect(ArbeoJourneyObservation)(
            rawObservation,
          ).pipe(persistenceError(operation))
        : undefined

    return yield* Schema.decodeUnknownEffect(CloudDeviceRunRecord)({
      runId: raw.run_id,
      attemptId: raw.attempt_id,
      changeRequestId: raw.change_request_id,
      providerId: raw.provider_id,
      sourceSha: raw.source_sha,
      apkArtifactKey: raw.apk_artifact_key,
      apkSha256: raw.apk_sha256,
      status: raw.status,
      ...(observation !== undefined ? { observation } : {}),
      artifactKeys,
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
            WHERE android_apk_builds.source_sha = EXCLUDED.source_sha
              AND android_apk_builds.apk_sha256 = EXCLUDED.apk_sha256
              AND android_apk_builds.apk_artifact_key = EXCLUDED.apk_artifact_key
          RETURNING attempt_id, change_request_id, source_sha, apk_artifact_key, apk_sha256, apk_byte_length, build_sandbox_id, package_name
        `.pipe(persistenceError(operation))

        const first = rows[0]
        if (first === undefined) {
          return yield* new PersistenceError({
            operation,
            message: `APK build for attempt "${build.attemptId}" already exists with conflicting source SHA or APK digest`,
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
            WHERE cloud_device_runs.status = 'dispatched'
              AND cloud_device_runs.attempt_id = EXCLUDED.attempt_id
              AND cloud_device_runs.apk_sha256 = EXCLUDED.apk_sha256
          RETURNING run_id, attempt_id, change_request_id, provider_id, source_sha, apk_artifact_key, apk_sha256, status, observation, artifact_keys
        `.pipe(persistenceError(operation))

        const first = rows[0]
        if (first === undefined) {
          return yield* new PersistenceError({
            operation,
            message: `Cloud device run "${run.runId}" cannot be overwritten once terminal or mismatched`,
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
