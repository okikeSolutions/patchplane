import { Context, type Effect, type Option } from 'effect'
import type {
  AndroidApkBuildRecord,
  CloudDeviceRunId,
  CloudDeviceRunRecord,
  PersistenceError,
  VerificationAttemptId,
} from '@patchplane/domain'

export interface AndroidVerificationStoreService {
  readonly recordApkBuild: (
    build: AndroidApkBuildRecord,
  ) => Effect.Effect<AndroidApkBuildRecord, PersistenceError>

  readonly recordCloudDeviceRun: (
    run: CloudDeviceRunRecord,
  ) => Effect.Effect<CloudDeviceRunRecord, PersistenceError>

  readonly findApkBuildByAttempt: (
    attemptId: VerificationAttemptId,
  ) => Effect.Effect<Option.Option<AndroidApkBuildRecord>, PersistenceError>

  readonly findCloudDeviceRunById: (
    runId: CloudDeviceRunId,
  ) => Effect.Effect<Option.Option<CloudDeviceRunRecord>, PersistenceError>
}

export class AndroidVerificationStore extends Context.Service<
  AndroidVerificationStore,
  AndroidVerificationStoreService
>()('@patchplane/core/AndroidVerificationStore') {}
