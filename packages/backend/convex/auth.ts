import { AuthKit, type AuthFunctions } from '@convex-dev/workos-authkit'
import { components, internal } from './_generated/api'
import type { DataModel } from './_generated/dataModel'

const authFunctions: AuthFunctions = internal.auth

export const authKit = new AuthKit<DataModel>(components.workOSAuthKit, {
  authFunctions,
})

export const { authKitEvent } = authKit.events({
  'user.created': async (_ctx, _event) => {
    return
  },
  'user.updated': async (_ctx, _event) => {
    return
  },
  'user.deleted': async (_ctx, _event) => {
    return
  },
})

export const { authKitAction } = authKit.actions({
  authentication: async (_ctx, _action, response) => {
    return response.allow()
  },
  userRegistration: async (_ctx, _action, response) => {
    return response.allow()
  },
})
