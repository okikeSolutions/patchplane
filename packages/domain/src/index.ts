import { Schema } from 'effect'

export const workflowStatuses = [
  'queued',
  'running',
  'reviewed',
  'completed',
  'failed',
] as const

export type WorkflowStatus = (typeof workflowStatuses)[number]

export const statusLabels: Record<WorkflowStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  reviewed: 'Reviewed',
  completed: 'Completed',
  failed: 'Failed',
}

export const PromptRequestSchema = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  executionTargetId: Schema.String,
  policyBundleId: Schema.String,
  createdByUserId: Schema.String,
  prompt: Schema.String,
  scope: Schema.Struct({
    repoUrl: Schema.String,
    baseBranch: Schema.String,
    targetBranch: Schema.String,
    includePaths: Schema.Array(Schema.String),
    excludePaths: Schema.Array(Schema.String),
    intent: Schema.String,
  }),
  status: Schema.Literal(...workflowStatuses),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})

export interface PromptRequest {
  id: string
  projectId: string
  executionTargetId: string
  policyBundleId: string
  createdByUserId: string
  prompt: string
  scope: {
    repoUrl: string
    baseBranch: string
    targetBranch: string
    includePaths: string[]
    excludePaths: string[]
    intent: string
  }
  status: WorkflowStatus
  createdAt: number
  updatedAt: number
}

export const RuntimeEventSchema = Schema.Struct({
  id: Schema.String,
  requestId: Schema.String,
  type: Schema.Literal(
    'session.started',
    'turn.started',
    'tool.called',
    'artifact.emitted',
    'turn.completed',
    'turn.failed',
  ),
  message: Schema.String,
  createdAt: Schema.Number,
})

export interface RuntimeEvent {
  id: string
  requestId: string
  type:
    | 'session.started'
    | 'turn.started'
    | 'tool.called'
    | 'artifact.emitted'
    | 'turn.completed'
    | 'turn.failed'
  message: string
  createdAt: number
}

export const ReviewRunSchema = Schema.Struct({
  id: Schema.String,
  requestId: Schema.String,
  reviewer: Schema.String,
  score: Schema.Number,
  passed: Schema.Boolean,
  summary: Schema.String,
})

export interface ReviewRun {
  id: string
  requestId: string
  reviewer: string
  score: number
  passed: boolean
  summary: string
}

export const coreCapabilities = [
  {
    name: 'Request coordination',
    summary:
      'Track prompts, scopes, policies, and the current lifecycle state.',
  },
  {
    name: 'Runtime normalization',
    summary:
      'Project runtime-specific events into one shared operational timeline.',
  },
  {
    name: 'Review orchestration',
    summary:
      'Capture typed review outputs before merge and rollback logic exists.',
  },
  {
    name: 'Lineage visibility',
    summary:
      'Explain how a request became a run, review, and eventual decision.',
  },
] as const
