import { AuthKit, type AuthFunctions } from '@convex-dev/workos-authkit'
import { components, internal } from './_generated/api'
import type { DataModel } from './_generated/dataModel'

const authFunctions: AuthFunctions = internal.auth

export const authKit = new AuthKit<DataModel>(components.workOSAuthKit, {
  authFunctions,
})

export const { authKitEvent } = authKit.events({
  'user.created': (_ctx, _event) => {
    return Promise.resolve()
  },
  'user.updated': (_ctx, _event) => {
    return Promise.resolve()
  },
  'user.deleted': (_ctx, _event) => {
    return Promise.resolve()
  },
})

export const { authKitAction } = authKit.actions({
  authentication: (_ctx, _action, response) => {
    return Promise.resolve(response.allow())
  },
  userRegistration: (_ctx, _action, response) => {
    return Promise.resolve(response.allow())
  },
})
