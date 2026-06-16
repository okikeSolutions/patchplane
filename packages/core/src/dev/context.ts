import type { Actor } from '@patchplane/domain/actor'
import { makeSystemActorId, makeSystemWorkspaceId } from '@patchplane/domain/ids'
import type { Workspace } from '@patchplane/domain/workspace'

export const devActor = {
  id: makeSystemActorId('dev-actor'),
  displayName: 'Development Actor',
} satisfies Actor

export const devWorkspace = {
  id: makeSystemWorkspaceId('dev-workspace'),
  name: 'Development Workspace',
} satisfies Workspace
