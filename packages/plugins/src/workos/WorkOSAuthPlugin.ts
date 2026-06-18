import { Effect, Layer, Option, Redacted } from 'effect'
import { WorkOS } from '@workos-inc/node'
import { AuthError } from '@patchplane/domain/errors'
import type { Permission } from '@patchplane/domain/permission'
import { AuthRequestContext } from '@patchplane/core/services/auth-request-context'
import { AuthService } from '@patchplane/core/services/auth-service'
import { WorkOSConfig } from './WorkOSConfig'
import {
  mapWorkOSMembershipToMembership,
  mapWorkOSOrganizationToWorkspace,
} from './mapping'

function stripWorkOSNamespace(value: string, namespace: 'user' | 'org') {
  const prefix = namespace === 'user' ? 'workos:user_' : 'workos:org_'
  return value.startsWith(prefix) ? value.slice('workos:'.length) : undefined
}

export const WorkOSAuthPlugin = {
  layer: Layer.effect(
    AuthService,
    Effect.gen(function* () {
      const config = yield* WorkOSConfig
      const apiHostname = Option.getOrUndefined(config.apiHostname)
      const workos = new WorkOS(Redacted.value(config.apiKey), {
        clientId: config.clientId,
        ...(apiHostname === undefined ? {} : { apiHostname }),
      })

      yield* Effect.logInfo('Initialized WorkOS auth plugin', {
        clientId: workos.options.clientId,
      })

      const getCurrentActor = Effect.gen(function* () {
        const request = yield* AuthRequestContext

        if (!request.actor) {
          return yield* new AuthError({
            operation: 'getCurrentActor',
            message: 'No authenticated actor is available for this request',
            cause: null,
          })
        }

        return request.actor
      })

      const getCurrentWorkspace = Effect.gen(function* () {
        const request = yield* AuthRequestContext

        if (!request.workspace) {
          return yield* new AuthError({
            operation: 'getCurrentWorkspace',
            message: 'No active workspace is available for this request',
            cause: null,
          })
        }

        const organizationId = stripWorkOSNamespace(request.workspace.id, 'org')

        if (organizationId === undefined) {
          return request.workspace
        }

        const organization = yield* Effect.tryPromise({
          try: () => workos.organizations.getOrganization(organizationId),
          catch: (cause) =>
            new AuthError({
              operation: 'getCurrentWorkspace',
              message: 'WorkOS failed to resolve the active organization',
              cause,
            }),
        })

        return mapWorkOSOrganizationToWorkspace(organization)
      })

      const listMemberships = Effect.gen(function* () {
        const request = yield* AuthRequestContext

        if (!request.actor) {
          return yield* new AuthError({
            operation: 'listMemberships',
            message: 'No authenticated actor is available for this request',
            cause: null,
          })
        }

        const userId = stripWorkOSNamespace(request.actor.id, 'user')
        const organizationId = request.workspace
          ? stripWorkOSNamespace(request.workspace.id, 'org')
          : undefined

        if (userId === undefined) {
          return request.memberships
        }

        const activeStatuses: Array<'active'> = ['active']
        const options = organizationId === undefined
          ? { userId, statuses: activeStatuses }
          : { userId, organizationId, statuses: activeStatuses }

        const memberships = yield* Effect.tryPromise({
          try: async () => {
            const result = await workos.userManagement.listOrganizationMemberships(
              options,
            )
            return organizationId === undefined
              ? await result.autoPagination()
              : result.data
          },
          catch: (cause) =>
            new AuthError({
              operation: 'listMemberships',
              message: 'WorkOS failed to list organization memberships',
              cause,
            }),
        })

        return memberships.map(mapWorkOSMembershipToMembership)
      })

      const requirePermission = (permission: Permission) =>
        Effect.gen(function* () {
          const request = yield* AuthRequestContext

          if (!request.actor) {
            return yield* new AuthError({
              operation: 'requirePermission',
              message: 'No authenticated actor is available for this request',
              cause: null,
            })
          }

          if (!request.workspace) {
            return yield* new AuthError({
              operation: 'requirePermission',
              message: 'No active workspace is available for this request',
              cause: null,
            })
          }

          const memberships = yield* listMemberships
          const activeWorkspaceId = request.workspace.id
          const hasActiveMembership = memberships.some(
            (membership) =>
              membership.workspaceId === activeWorkspaceId &&
              membership.status === 'active',
          )
          const hasMembershipPermission = memberships.some(
            (membership) =>
              membership.workspaceId === activeWorkspaceId &&
              membership.status === 'active' &&
              membership.permissions.includes(permission),
          )
          const hasCanonicalSessionPermission = hasActiveMembership &&
            (request.explicitPermissions ?? []).includes(permission)
          const hasPermission = hasMembershipPermission || hasCanonicalSessionPermission

          if (!hasPermission) {
            return yield* new AuthError({
              operation: 'requirePermission',
              message: 'The request actor does not include the permission',
              cause: { permission },
            })
          }

          return undefined
        })

      return AuthService.of({
        getCurrentActor,
        getCurrentWorkspace,
        listMemberships,
        requirePermission,
      })
    }),
  ),
  config: WorkOSConfig,
}
