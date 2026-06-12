import type { Actor } from '@patchplane/domain/actor'
import type { Workspace } from '@patchplane/domain/workspace'

export const devActor = {
  id: 'dev-actor',
  displayName: 'Development Actor',
} satisfies Actor

export const devWorkspace = {
  id: 'dev-workspace',
  name: 'Development Workspace',
} satisfies Workspace
