import { Effect } from 'effect'
import type { Actor } from '@patchplane/domain/actor'
import { decodeExternalWorkflowRef } from '@patchplane/domain/external-workflow-ref'
import type { GitHubNormalizedWorkflowEvent } from '@patchplane/domain/github'
import type { WorkspaceId } from '@patchplane/domain/ids'
import type { WorkflowIntake } from '@patchplane/domain/workflow-intake'
import { GitHubError } from '@patchplane/domain/errors'

export interface GitHubEventToWorkflowIntakeContext {
  readonly actor: Actor
  readonly workspaceId: WorkspaceId
  readonly traceId: string
}

export const GitHubEventToWorkflowIntake = Effect.fn(
  '@patchplane/core/workflows/GitHubEventToWorkflowIntake',
)(function* (
  event: GitHubNormalizedWorkflowEvent,
  context: GitHubEventToWorkflowIntakeContext,
) {
  if (
    !('baseSha' in event) ||
    event.baseSha.trim().length === 0 ||
    !('headSha' in event) ||
    event.headSha.trim().length === 0
  ) {
    return yield* new GitHubError({
      operation: 'GitHubEventToWorkflowIntake.requirePinnedRevision',
      message:
        'Executable GitHub workflow intake requires authoritative pull request base and head SHAs',
      cause: { eventKind: event.kind },
    })
  }

  const externalRef = yield* decodeExternalWorkflowRef({
    provider: 'github',
    deliveryId: event.deliveryId,
    eventKind: event.kind,
    repositoryProvider: 'github',
    repositoryInstallationId: String(event.installationId),
    repositoryExternalId: String(event.repositoryId),
    repositoryOwner: event.owner,
    repositoryName: event.repo,
    repositoryFullName: `${event.owner}/${event.repo}`,
    issueExternalId:
      'issueId' in event
        ? String(event.issueId)
        : 'pullRequestId' in event
          ? String(event.pullRequestId)
          : undefined,
    issueNumber:
      'issueNumber' in event ? event.issueNumber : event.pullRequestNumber,
    issueTitle: event.title,
    issueBody: event.body,
    pullRequestExternalId:
      'pullRequestId' in event ? String(event.pullRequestId) : undefined,
    pullRequestNumber:
      'pullRequestNumber' in event ? event.pullRequestNumber : undefined,
    pullRequestUpdatedAt:
      'pullRequestUpdatedAt' in event ? event.pullRequestUpdatedAt : undefined,
    pullRequestBaseSha: 'baseSha' in event ? event.baseSha : undefined,
    pullRequestHeadSha: 'headSha' in event ? event.headSha : undefined,
    pullRequestPreviousHeadSha:
      'previousHeadSha' in event ? event.previousHeadSha : undefined,
    pullRequestHeadRef: 'headRef' in event ? event.headRef : undefined,
    pullRequestBaseRef: 'baseRef' in event ? event.baseRef : undefined,
    commentExternalId:
      'commentId' in event ? String(event.commentId) : undefined,
    url: event.url,
    senderProvider: 'github',
    senderLogin: event.sender,
  }).pipe(
    Effect.mapError(
      (cause) =>
        new GitHubError({
          operation: 'GitHubEventToWorkflowIntake.decodeExternalRef',
          message:
            'GitHub event could not be mapped to a workflow intake reference',
          cause,
        }),
    ),
  )

  return {
    actor: context.actor,
    workspaceId: context.workspaceId,
    source: 'external',
    traceId: context.traceId,
    prompt: event.prompt,
    externalRef,
  } satisfies WorkflowIntake
})
