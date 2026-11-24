import { Context, type Effect } from 'effect'
import type * as Redacted from 'effect/Redacted'
import type {
  AuthenticationError,
  HumanPrincipalId,
  OrganizationId,
  WorkOsAuthenticatedIdentity,
} from '@patchplane/domain'

/**
 * B2B user sign-in and organization membership boundary backed by WorkOS with
 * GitHub OAuth. WorkOS proves user identity and organization membership ONLY;
 * it NEVER grants repository approval authority on its own.
 */
export interface WorkOsAuthProviderService {
  readonly authenticateGitHubOAuthCallback: (input: {
    readonly code: Redacted.Redacted
    readonly state: string
    readonly expectedState: string
  }) => Effect.Effect<WorkOsAuthenticatedIdentity, AuthenticationError>

  readonly verifySessionToken: (
    token: Redacted.Redacted,
  ) => Effect.Effect<WorkOsAuthenticatedIdentity, AuthenticationError>

  readonly verifyOrganizationMembership: (input: {
    readonly principalId: HumanPrincipalId
    readonly organizationId: OrganizationId
  }) => Effect.Effect<boolean, AuthenticationError>
}

export class WorkOsAuthProvider extends Context.Service<
  WorkOsAuthProvider,
  WorkOsAuthProviderService
>()('@patchplane/core/WorkOsAuthProvider') {}
