import { Effect, Schema } from 'effect'
import type {
  BoundaryFailure,
  GitHubWebhookEnvelope,
  GitHubWebhookIngestor,
  PatchPlaneCommand,
  PromptRequestCommand,
} from '@patchplane/domain'
import { PromptRequestCommandSchema } from '@patchplane/domain'

const decodePromptRequestCommand = Schema.decodeUnknownSync(
  PromptRequestCommandSchema,
)

export interface GitHubCommandDefaults {
  readonly executionTargetId: string
  readonly policyBundleId: string
}

interface GitHubIssueCommentPayload {
  readonly action?: string
  readonly installation?: { readonly id?: number }
  readonly repository?: {
    readonly id?: number
    readonly node_id?: string
    readonly full_name?: string
    readonly clone_url?: string
    readonly default_branch?: string
  }
  readonly issue?: { readonly number?: number }
  readonly comment?: { readonly id?: number; readonly body?: string }
  readonly sender?: { readonly login?: string }
}

function createBoundaryFailure(
  message: string,
  cause?: unknown,
): BoundaryFailure {
  return {
    boundary: 'github.webhookIngestor',
    message,
    retryable: false,
    cause,
  }
}

export function extractPatchPlaneCommand(body: string): string | null {
  const commandLine = body
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('/patchplane'))

  if (!commandLine) {
    return null
  }

  const command = commandLine.slice('/patchplane'.length).trim()
  return command.length > 0 ? command : null
}

export class IssueCommentGitHubWebhookIngestor implements GitHubWebhookIngestor {
  readonly name = 'github-issue-comment-ingestor'

  constructor(private readonly defaults: GitHubCommandDefaults) {}

  ingest(
    delivery: GitHubWebhookEnvelope,
  ): Effect.Effect<ReadonlyArray<PatchPlaneCommand>, BoundaryFailure> {
    if (delivery.event !== 'issue_comment' || delivery.action !== 'created') {
      return Effect.succeed([])
    }

    return Effect.try({
      try: () => {
        const payload = JSON.parse(
          delivery.payload,
        ) as GitHubIssueCommentPayload
        const command = extractPatchPlaneCommand(payload.comment?.body ?? '')

        if (!command) {
          return []
        }

        const repositoryFullName = payload.repository?.full_name
        const externalRepositoryId = payload.repository?.id
        const repositoryNodeId = payload.repository?.node_id
        const externalInstallationId = payload.installation?.id
        const issueNumber = payload.issue?.number
        const commentId = payload.comment?.id
        const actorLogin = payload.sender?.login

        if (
          !repositoryFullName ||
          !externalRepositoryId ||
          !repositoryNodeId ||
          !externalInstallationId ||
          !issueNumber ||
          !commentId ||
          !actorLogin
        ) {
          throw createBoundaryFailure(
            'Issue comment webhook payload is missing required command fields.',
            payload,
          )
        }

        const promptRequestCommand: PromptRequestCommand =
          decodePromptRequestCommand({
            kind: 'prompt_request.create',
            projectId: repositoryFullName,
            executionTargetId: this.defaults.executionTargetId,
            policyBundleId: this.defaults.policyBundleId,
            createdByUserId: `github:${actorLogin}`,
            prompt: command,
            scope: {
              repoUrl:
                payload.repository?.clone_url ??
                `https://github.com/${repositoryFullName}.git`,
              baseBranch: payload.repository?.default_branch ?? 'main',
              targetBranch: `patchplane/comment-${commentId}`,
              includePaths: [],
              excludePaths: [],
              intent: 'github.issue_comment',
            },
            source: {
              kind: 'github.issue_comment',
              deliveryId: delivery.deliveryId,
              externalInstallationId,
              externalRepositoryId,
              externalRepositoryNodeId: repositoryNodeId,
              repositoryFullName,
              issueNumber,
              commentId,
              actorLogin,
              command,
            },
          })

        return [promptRequestCommand]
      },
      catch: (cause) =>
        typeof cause === 'object' &&
        cause !== null &&
        'boundary' in cause &&
        'message' in cause
          ? (cause as BoundaryFailure)
          : createBoundaryFailure(
              'Failed to decode GitHub webhook payload into PatchPlane commands.',
              cause,
            ),
    })
  }
}
