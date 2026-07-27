import { Schema } from 'effect'
import { PromptRequestId, WorkflowRunId, WorkspaceId } from './ids'
import { EpochMillis, GitCommitSha, PositiveInt } from './refinements'

export const WorkflowStatus = Schema.Literals([
  'queued',
  'running',
  'reviewed',
  'failed',
])
export type WorkflowStatus = Schema.Schema.Type<typeof WorkflowStatus>

/**
 * Versioned workflow-attempt semantics.
 *
 * Legacy rows may omit these fields. Every V1 workflow run is one immutable
 * patch attempt; an intentional rerun creates a child workflow run.
 */
export const WorkflowRunModelVersion = Schema.Literals(['v1'])
export type WorkflowRunModelVersion = Schema.Schema.Type<
  typeof WorkflowRunModelVersion
>

export const WorkflowRunTrigger = Schema.Literals(['intake', 'rerun'])
export type WorkflowRunTrigger = Schema.Schema.Type<typeof WorkflowRunTrigger>

export const CandidateIdentityVersion = Schema.Literal('incoming-pr-v1')
export type CandidateIdentityVersion = Schema.Schema.Type<
  typeof CandidateIdentityVersion
>

export const WorkflowRun = Schema.Struct({
  id: WorkflowRunId,
  promptRequestId: PromptRequestId,
  workspaceId: WorkspaceId,
  traceId: Schema.NonEmptyString,
  status: WorkflowStatus,
  modelVersion: Schema.optional(WorkflowRunModelVersion),
  parentWorkflowRunId: Schema.optional(WorkflowRunId),
  rootWorkflowRunId: Schema.optional(WorkflowRunId),
  attemptNumber: Schema.optional(PositiveInt),
  trigger: Schema.optional(WorkflowRunTrigger),
  candidateIdentityVersion: Schema.optional(CandidateIdentityVersion),
  sourceBaseSha: Schema.optional(GitCommitSha),
  sourceCommitSha: Schema.optional(GitCommitSha),
  createdAt: EpochMillis,
}).check(
  Schema.makeFilter(
    (run) =>
      run.candidateIdentityVersion === undefined ||
      (run.modelVersion === 'v1' &&
        run.rootWorkflowRunId !== undefined &&
        run.attemptNumber !== undefined &&
        run.trigger !== undefined &&
        run.sourceBaseSha !== undefined &&
        run.sourceCommitSha !== undefined),
    {
      expected:
        'incoming-pr-v1 workflow run with immutable source base and head SHAs',
    },
  ),
)
export type WorkflowRun = Schema.Schema.Type<typeof WorkflowRun>

export const decodeWorkflowRun = Schema.decodeUnknownEffect(WorkflowRun)
