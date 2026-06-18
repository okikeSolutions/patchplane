import { Schema } from 'effect'

export const ActorIdNamespace = Schema.Literals([
  'workos',
  'github',
  'github-app',
  'agent',
  'system',
])
export type ActorIdNamespace = Schema.Schema.Type<typeof ActorIdNamespace>

export const WorkspaceIdNamespace = Schema.Literals(['workos', 'system'])
export type WorkspaceIdNamespace = Schema.Schema.Type<
  typeof WorkspaceIdNamespace
>

/**
 * Stable PatchPlane actor identifier.
 *
 * @remarks
 * Actor ids are namespaced strings such as `workos:user_123` or
 * `github-app:987`. Use the constructor helpers in this module instead of
 * concatenating ids at call sites.
 */
export const ActorId = Schema.TemplateLiteral([
  ActorIdNamespace,
  ':',
  Schema.NonEmptyString,
]).pipe(Schema.brand('ActorId'))
export type ActorId = Schema.Schema.Type<typeof ActorId>

/**
 * Stable PatchPlane workspace identifier.
 *
 * @remarks
 * Workspace ids are namespaced strings, currently `workos:<organizationId>`
 * for customer workspaces and `system:<id>` for internal/system workflows.
 */
export const WorkspaceId = Schema.TemplateLiteral([
  WorkspaceIdNamespace,
  ':',
  Schema.NonEmptyString,
]).pipe(Schema.brand('WorkspaceId'))
export type WorkspaceId = Schema.Schema.Type<typeof WorkspaceId>

export const PromptRequestId = Schema.String.pipe(Schema.brand('PromptRequestId'))
export type PromptRequestId = Schema.Schema.Type<typeof PromptRequestId>

export const WorkflowRunId = Schema.String.pipe(Schema.brand('WorkflowRunId'))
export type WorkflowRunId = Schema.Schema.Type<typeof WorkflowRunId>

const decodeActorIdSync = Schema.decodeUnknownSync(ActorId)
const decodeWorkspaceIdSync = Schema.decodeUnknownSync(WorkspaceId)
const decodePromptRequestIdSync = Schema.decodeUnknownSync(PromptRequestId)
const decodeWorkflowRunIdSync = Schema.decodeUnknownSync(WorkflowRunId)

export function makeWorkspaceId(workspaceId: string): WorkspaceId {
  return decodeWorkspaceIdSync(workspaceId)
}

export function makePromptRequestId(promptRequestId: string): PromptRequestId {
  return decodePromptRequestIdSync(promptRequestId)
}

export function makeWorkflowRunId(workflowRunId: string): WorkflowRunId {
  return decodeWorkflowRunIdSync(workflowRunId)
}

/** Creates a PatchPlane actor id for a WorkOS user id. */
export function makeWorkOSActorId(userId: string): ActorId {
  return decodeActorIdSync(`workos:${userId}`)
}

/** Creates a PatchPlane actor id for a GitHub App installation. */
export function makeGitHubAppActorId(installationId: string): ActorId {
  return decodeActorIdSync(`github-app:${installationId}`)
}

export function makeSystemActorId(actorId: string): ActorId {
  return decodeActorIdSync(`system:${actorId}`)
}

/** Creates a PatchPlane workspace id for a WorkOS organization id. */
export function makeWorkOSWorkspaceId(organizationId: string): WorkspaceId {
  return decodeWorkspaceIdSync(`workos:${organizationId}`)
}

export function makeSystemWorkspaceId(workspaceId: string): WorkspaceId {
  return decodeWorkspaceIdSync(`system:${workspaceId}`)
}
