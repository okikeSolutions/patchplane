import { Context, Effect } from 'effect'
import type { Actor } from '@patchplane/domain/actor'
import type { AuthError } from '@patchplane/domain/errors'
import type { Membership } from '@patchplane/domain/membership'
import type { Permission } from '@patchplane/domain/permission'
import type { Workspace } from '@patchplane/domain/workspace'
import type { AuthRequestContext } from './auth-request-context'

export class AuthService extends Context.Service<AuthService, {
  readonly getCurrentActor: Effect.Effect<Actor, AuthError, AuthRequestContext>
  readonly getCurrentWorkspace: Effect.Effect<Workspace, AuthError, AuthRequestContext>
  readonly listMemberships: Effect.Effect<
    ReadonlyArray<Membership>,
    AuthError,
    AuthRequestContext
  >
  readonly requirePermission: (
    permission: Permission,
  ) => Effect.Effect<void, AuthError, AuthRequestContext>
}>()('@patchplane/core/services/AuthService') {}
