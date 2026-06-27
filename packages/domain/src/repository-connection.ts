import { Schema } from 'effect'

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
  workspaceId: Schema.String,
  installationId: Schema.String,
  accountExternalId: Schema.String,
  accountLogin: Schema.String,
  accountType: Schema.optional(Schema.String),
  status: RepositoryConnectionStatus,
  connectedByActorId: Schema.String,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})
export type ConnectedRepositoryAccount = Schema.Schema.Type<
  typeof ConnectedRepositoryAccount
>
export const decodeConnectedRepositoryAccount = Schema.decodeUnknownEffect(
  ConnectedRepositoryAccount,
)

export const ConnectedRepository = Schema.Struct({
  provider: Schema.Literal('github'),
  workspaceId: Schema.String,
  installationId: Schema.String,
  repositoryExternalId: Schema.String,
  repositoryOwner: Schema.String,
  repositoryName: Schema.String,
  repositoryFullName: Schema.String,
  private: Schema.Boolean,
  selected: Schema.Boolean,
  permissionsJson: Schema.optional(Schema.String),
  status: RepositoryConnectionStatus,
  connectedByActorId: Schema.String,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
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
