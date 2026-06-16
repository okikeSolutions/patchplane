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

const requireActor = Effect.fn('WorkOSAuthPlugin.requireActor')(
  function*(operation: string) {
    const request = yield* AuthRequestContext

    if (!request.actor) {
      return yield* new AuthError({
        operation,
        message: 'No authenticated actor is available for this request',
        cause: null,
      })
    }

    return request.actor
  },
)

const requireAuthRequest = Effect.fn('WorkOSAuthPlugin.requireAuthRequest')(
  function*(operation: string) {
    const request = yield* AuthRequestContext

    if (!request.actor) {
      return yield* new AuthError({
        operation,
        message: 'No authenticated actor is available for this request',
        cause: null,
      })
    }

    return request
  },
)

const requireWorkspace = Effect.fn('WorkOSAuthPlugin.requireWorkspace')(
  function*(operation: string) {
    const request = yield* AuthRequestContext

    if (!request.workspace) {
      return yield* new AuthError({
        operation,
        message: 'No active workspace is available for this request',
        cause: null,
      })
    }

    return request.workspace
  },
)

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

      const resolveCurrentWorkspace = Effect.fn(
        'WorkOSAuthPlugin.getCurrentWorkspace',
      )(function*() {
        const workspace = yield* requireWorkspace('getCurrentWorkspace')
        const organizationId = stripWorkOSNamespace(workspace.id, 'org')

        if (organizationId === undefined) {
          return workspace
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

      const resolveMemberships = Effect.fn('WorkOSAuthPlugin.listMemberships')(
        function*() {
          const request = yield* requireAuthRequest('listMemberships')
          const actor = yield* requireActor('listMemberships')
          const userId = stripWorkOSNamespace(actor.id, 'user')
          const organizationId = request.workspace
            ? stripWorkOSNamespace(request.workspace.id, 'org')
            : undefined

          if (userId === undefined) {
            return request.memberships
          }

          const activeStatuses: Array<'active'> = ['active']
          const options =
            organizationId === undefined
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
        },
      )

      const requirePermission = Effect.fn('WorkOSAuthPlugin.requirePermission')(
        function*(permission: Permission) {
          const request = yield* requireAuthRequest('requirePermission')
          const activeWorkspace = yield* requireWorkspace('requirePermission')
          const memberships = yield* resolveMemberships()
          const activeWorkspaceId = activeWorkspace.id
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
          const hasCanonicalSessionPermission =
            hasActiveMembership &&
            (request.explicitPermissions ?? []).includes(permission)
          const hasPermission =
            hasMembershipPermission || hasCanonicalSessionPermission

          if (!hasPermission) {
            return yield* new AuthError({
              operation: 'requirePermission',
              message: 'The request actor does not include the permission',
              cause: { permission },
            })
          }

          return undefined
        },
      )

      return AuthService.of({
        getCurrentActor: requireActor('getCurrentActor'),
        getCurrentWorkspace: resolveCurrentWorkspace(),
        listMemberships: resolveMemberships(),
        requirePermission,
      })
    }),
  ),
  config: WorkOSConfig,
}
