import { Schema } from 'effect'
import { ActorId, WorkspaceId } from './ids'
import { EpochMillis } from './refinements'

export const RepositoryConnectionStatus = Schema.Literals([
  'active',
  'suspended',
  'removed',
  'reconnect_required',
])
export type RepositoryConnectionStatus = Schema.Schema.Type<
  typeof RepositoryConnectionStatus
>

export const ConnectedRepositoryAccount = Schema.Struct({
  provider: Schema.Literal('github'),
  workspaceId: WorkspaceId,
  installationId: Schema.NonEmptyString,
  accountExternalId: Schema.NonEmptyString,
  accountLogin: Schema.NonEmptyString,
  accountType: Schema.optional(Schema.NonEmptyString),
  status: RepositoryConnectionStatus,
  connectedByActorId: ActorId,
  createdAt: EpochMillis,
  updatedAt: EpochMillis,
})
export type ConnectedRepositoryAccount = Schema.Schema.Type<
  typeof ConnectedRepositoryAccount
>
export const decodeConnectedRepositoryAccount = Schema.decodeUnknownEffect(
  ConnectedRepositoryAccount,
)

export const ConnectedRepository = Schema.Struct({
  provider: Schema.Literal('github'),
  workspaceId: WorkspaceId,
  installationId: Schema.NonEmptyString,
  repositoryExternalId: Schema.NonEmptyString,
  repositoryOwner: Schema.NonEmptyString,
  repositoryName: Schema.NonEmptyString,
  repositoryFullName: Schema.NonEmptyString,
  private: Schema.Boolean,
  selected: Schema.Boolean,
  permissionsJson: Schema.optional(Schema.String),
  status: RepositoryConnectionStatus,
  connectedByActorId: ActorId,
  createdAt: EpochMillis,
  updatedAt: EpochMillis,
})
export type ConnectedRepository = Schema.Schema.Type<
  typeof ConnectedRepository
>
export const decodeConnectedRepository = Schema.decodeUnknownEffect(
  ConnectedRepository,
)
export const decodeConnectedRepositories = Schema.Array(ConnectedRepository).pipe(
  Schema.decodeUnknownEffect,
)
