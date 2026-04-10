import { internal } from '../_generated/api'
import type { Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import type { ExecutionTarget, PromptRequestCommand } from '@patchplane/domain'
import {
  ensureExecutionTargetByKey,
  ensureExecutionTargetByReference,
  ensurePolicyBundleByKey,
  ensurePolicyBundleByReference,
} from './configResolution'

interface CreatePromptRequestFlowInput {
  readonly command: PromptRequestCommand
  readonly githubInstallationId?: Id<'githubInstallations'>
  readonly repositoryConnectionId?: Id<'repositories'>
}

interface CreatePromptRequestFlowResult {
  readonly promptRequestId: Id<'promptRequests'>
  readonly workflowRunId: Id<'workflowRuns'>
  readonly executionTargetId: Id<'executionTargets'>
  readonly policyBundleId: Id<'policyBundles'>
}

interface EnsurePromptRequestConfigReferencesInput {
  readonly promptRequestId: Id<'promptRequests'>
  readonly projectId: string
  readonly repositoryConnectionId?: Id<'repositories'>
  readonly executionTargetReference: string
  readonly policyBundleReference: string
}

export function buildPromptRequestScope(
  command: PromptRequestCommand,
  executionTarget: Pick<ExecutionTarget, 'defaultBaseBranch'>,
) {
  return {
    ...command.scope,
    baseBranch: executionTarget.defaultBaseBranch ?? command.scope.baseBranch,
    includePaths: [...command.scope.includePaths],
    excludePaths: [...command.scope.excludePaths],
  }
}

export async function ensurePromptRequestConfigReferences(
  ctx: MutationCtx,
  input: EnsurePromptRequestConfigReferencesInput,
) {
  const executionTarget = await ensureExecutionTargetByReference(ctx, {
    projectId: input.projectId,
    reference: input.executionTargetReference,
    repositoryConnectionId: input.repositoryConnectionId,
  })
  const policyBundle = await ensurePolicyBundleByReference(ctx, {
    projectId: input.projectId,
    reference: input.policyBundleReference,
  })

  if (
    input.executionTargetReference !== String(executionTarget._id) ||
    input.policyBundleReference !== String(policyBundle._id)
  ) {
    await ctx.db.patch('promptRequests', input.promptRequestId, {
      executionTargetId: executionTarget._id,
      policyBundleId: policyBundle._id,
      updatedAt: Date.now(),
    })
  }

  return {
    executionTarget,
    policyBundle,
  }
}

export async function createPromptRequestFlow(
  ctx: MutationCtx,
  input: CreatePromptRequestFlowInput,
): Promise<CreatePromptRequestFlowResult> {
  const now = Date.now()
  const executionTarget = await ensureExecutionTargetByKey(ctx, {
    projectId: input.command.projectId,
    key: input.command.executionTargetKey,
    repositoryConnectionId: input.repositoryConnectionId,
  })
  const policyBundle = await ensurePolicyBundleByKey(ctx, {
    projectId: input.command.projectId,
    key: input.command.policyBundleKey,
  })

  const promptRequestId = await ctx.db.insert('promptRequests', {
    projectId: input.command.projectId,
    executionTargetId: executionTarget._id,
    policyBundleId: policyBundle._id,
    createdByUserId: input.command.createdByUserId,
    prompt: input.command.prompt,
    scope: buildPromptRequestScope(input.command, executionTarget),
    source: input.command.source,
    status: 'queued',
    createdAt: now,
    updatedAt: now,
  })

  const workflowRunId = await ctx.db.insert('workflowRuns', {
    promptRequestId,
    githubInstallationId: input.githubInstallationId,
    repositoryConnectionId: input.repositoryConnectionId,
    sandboxProvider: executionTarget.sandboxProvider,
    runtimeProvider: executionTarget.runtimeProvider,
    status: 'queued',
    createdAt: now,
    updatedAt: now,
  })

  await ctx.scheduler.runAfter(0, internal.workflowWorker.executeWorkflowRun, {
    workflowRunId,
  })

  if (
    input.command.source.kind === 'github.issue_comment' &&
    input.repositoryConnectionId !== undefined
  ) {
    const githubSource = input.command.source
    const repositoryConnectionId = input.repositoryConnectionId

    const existingIssueBinding = await ctx.db
      .query('issueBindings')
      .withIndex('by_repository_connection_and_issue', (queryBuilder) =>
        queryBuilder
          .eq('repositoryConnectionId', repositoryConnectionId)
          .eq('issueNumber', githubSource.issueNumber),
      )
      .unique()

    if (existingIssueBinding) {
      await ctx.db.patch('issueBindings', existingIssueBinding._id, {
        promptRequestId,
        workflowRunId,
        latestCommentId: githubSource.commentId,
        updatedAt: now,
      })
    } else {
      await ctx.db.insert('issueBindings', {
        repositoryConnectionId,
        issueNumber: githubSource.issueNumber,
        promptRequestId,
        workflowRunId,
        latestCommentId: githubSource.commentId,
        createdAt: now,
        updatedAt: now,
      })
    }
  }

  return {
    promptRequestId,
    workflowRunId,
    executionTargetId: executionTarget._id,
    policyBundleId: policyBundle._id,
  }
}
