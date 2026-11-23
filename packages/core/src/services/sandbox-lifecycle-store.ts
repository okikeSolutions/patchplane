import { Context, type Effect, type Option } from 'effect'
import type {
  ArtifactRecord,
  ChangeRequestId,
  DecisionInboxItem,
  EnvironmentQuarantine,
  EnvironmentQuarantineId,
  InboxItemId,
  PersistenceError,
  SandboxId,
  SandboxRecord,
  VerificationAttemptId,
} from '@patchplane/domain'

export interface QuarantineResult {
  readonly quarantine: EnvironmentQuarantine
  readonly inboxItem: DecisionInboxItem
}

export interface SandboxLifecycleStoreService {
  readonly recordSandboxCreated: (input: {
    readonly sandboxId: SandboxId
    readonly attemptId: VerificationAttemptId
    readonly changeRequestId: ChangeRequestId
    readonly labels: Readonly<Record<string, string>>
  }) => Effect.Effect<SandboxRecord, PersistenceError>

  readonly markSandboxDeleted: (
    sandboxId: SandboxId,
  ) => Effect.Effect<void, PersistenceError>

  readonly recordArtifactMetadata: (
    artifact: ArtifactRecord,
  ) => Effect.Effect<ArtifactRecord, PersistenceError>

  /**
   * Atomically quarantines the environment, marks the sandbox row quarantined
   * (creating one if a crash happened before persistence), and creates an open
   * Decision Inbox item in the same Postgres transaction.
   */
  readonly quarantineSandboxEnvironment: (input: {
    readonly quarantineId: EnvironmentQuarantineId
    readonly inboxItemId: InboxItemId
    readonly attemptId: VerificationAttemptId
    readonly changeRequestId: ChangeRequestId
    readonly sandboxId: SandboxId
    readonly labels: Readonly<Record<string, string>>
    readonly reason: string
  }) => Effect.Effect<QuarantineResult, PersistenceError>

  readonly findSandboxById: (
    sandboxId: SandboxId,
  ) => Effect.Effect<Option.Option<SandboxRecord>, PersistenceError>

  readonly listActiveSandboxes: Effect.Effect<
    ReadonlyArray<SandboxRecord>,
    PersistenceError
  >

  readonly listQuarantinedEnvironments: Effect.Effect<
    ReadonlyArray<EnvironmentQuarantine>,
    PersistenceError
  >

  readonly listOpenInboxItems: Effect.Effect<
    ReadonlyArray<DecisionInboxItem>,
    PersistenceError
  >

  readonly listArtifactsByAttempt: (
    attemptId: VerificationAttemptId,
  ) => Effect.Effect<ReadonlyArray<ArtifactRecord>, PersistenceError>
}

export class SandboxLifecycleStore extends Context.Service<
  SandboxLifecycleStore,
  SandboxLifecycleStoreService
>()('@patchplane/core/SandboxLifecycleStore') {}
