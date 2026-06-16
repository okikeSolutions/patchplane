import { Schema } from 'effect'

export const patchPlanePermissions = [
  'workspace:view',
  'repo:connect',
  'prompt:create',
  'run:start',
  'run:interrupt',
  'review:create',
  'decision:approve',
  'decision:reject',
  'publication:create',
] as const

export const Permission = Schema.Literals(patchPlanePermissions)
export type Permission = Schema.Schema.Type<typeof Permission>

export const Permissions = Schema.Array(Permission)
export type Permissions = Schema.Schema.Type<typeof Permissions>
