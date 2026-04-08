import { Effect, ParseResult, Schema } from 'effect'
import {
  BoundaryFailure,
  type GitHubWebhookEnvelope,
  type GitHubWebhookIngestor,
  type PatchPlaneCommand,
  type PromptRequestCommand,
} from '@patchplane/domain'
import { PromptRequestCommandSchema } from '@patchplane/domain'

const decodePromptRequestCommand = Schema.decodeUnknown(
  PromptRequestCommandSchema,
)

export interface GitHubCommandDefaults {
  readonly executionTargetKey: string
  readonly policyBundleKey: string
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
  return new BoundaryFailure({
    boundary: 'github.webhookIngestor',
    message,
    retryable: false,
    cause,
  })
}

function createParseFailure(
  message: string,
  cause: ParseResult.ParseError,
): BoundaryFailure {
  return createBoundaryFailure(
    `${message} ${ParseResult.TreeFormatter.formatErrorSync(cause)}`,
    cause,
  )
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

    const defaults = this.defaults

    return Effect.gen(function* () {
      const payload = yield* Effect.try({
        try: () => JSON.parse(delivery.payload) as GitHubIssueCommentPayload,
        catch: (cause) =>
          createBoundaryFailure(
            'Failed to parse GitHub webhook payload JSON.',
            cause,
          ),
      })
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
        return yield* Effect.fail(
          createBoundaryFailure(
            'Issue comment webhook payload is missing required command fields.',
            payload,
          ),
        )
      }

      const promptRequestCommand: PromptRequestCommand =
        yield* decodePromptRequestCommand({
          kind: 'prompt_request.create',
          projectId: repositoryFullName,
          executionTargetKey: defaults.executionTargetKey,
          policyBundleKey: defaults.policyBundleKey,
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
        }).pipe(
          Effect.mapError((cause) =>
            createParseFailure(
              'Failed to decode GitHub webhook payload into PatchPlane commands.',
              cause,
            ),
          ),
        )

      return [promptRequestCommand]
    })
  }
}
