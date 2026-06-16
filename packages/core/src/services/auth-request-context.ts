import { Context } from 'effect'
import type { Actor } from '@patchplane/domain/actor'
import type { Membership } from '@patchplane/domain/membership'
import type { Permission } from '@patchplane/domain/permission'
import type { Workspace } from '@patchplane/domain/workspace'

/**
 * @effect-leakable-service
 * Request-scoped authentication identity intentionally flows through AuthService
 * methods so app boundaries can provide it per request.
 */
export interface AuthRequest {
  readonly actor: Actor | null
  readonly workspace: Workspace | null
  readonly memberships: ReadonlyArray<Membership>
  readonly permissions: ReadonlyArray<Permission>
  /** Verified permission claims from the auth provider for the active session. */
  readonly explicitPermissions?: ReadonlyArray<Permission>
  /** Provider access token for backend services that need to forward user auth. */
  readonly accessToken?: string
}

/** @effect-leakable-service */
export class AuthRequestContext extends Context.Service<
  AuthRequestContext,
  AuthRequest
>()('@patchplane/core/services/AuthRequestContext') {}
