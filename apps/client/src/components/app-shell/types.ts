export interface ViewerIdentity {
  subject: string
  name: string
  email?: string
}

export interface ExternalWorkflowRefRow {
  provider: string
  deliveryId: string
  eventKind: string
  repositoryProvider?: string
  repositoryInstallationId?: string
  repositoryExternalId?: string
  repositoryOwner?: string
  repositoryName?: string
  repositoryFullName?: string
  issueExternalId?: string
  issueNumber?: number
  issueTitle?: string
  pullRequestExternalId?: string
  pullRequestNumber?: number
  pullRequestHeadSha?: string
  pullRequestHeadRef?: string
  pullRequestBaseRef?: string
  commentExternalId?: string
  url?: string
  senderProvider?: string
  senderExternalId?: string
  senderLogin?: string
}

export interface PromptRequestRow {
  id: string
  workspaceId: string
  actorId: string
  traceId: string
  source: 'dev' | 'app' | 'external'
  prompt: string
  externalRef?: ExternalWorkflowRefRow
  status: 'created'
  createdAt: number
}

export interface WorkflowRunRow {
  id: string
  promptRequestId: string
  workspaceId: string
  traceId: string
  status: 'queued' | 'running' | 'reviewed' | 'failed'
  modelVersion?: 'v1'
  parentWorkflowRunId?: string
  rootWorkflowRunId?: string
  attemptNumber?: number
  trigger?: 'intake' | 'rerun'
  sourceCommitSha?: string
  trustState?:
    | 'queued'
    | 'running'
    | 'no-sandbox-run'
    | 'sandbox-failed'
    | 'needs-review'
    | 'approved'
    | 'rejected'
    | 'changes-requested'
  updatedAt?: number
  createdAt: number
}

export interface WorkflowStartRow {
  promptRequest: PromptRequestRow
  workflowRun: WorkflowRunRow
}

export interface RuntimeEventRow {
  id: string
  workflowRunId: string
  provider: string
  type: string
  occurredAt: number
  summary?: string
  payloadJson?: string
  idempotencyKey?: string
  sourceSessionId?: string
  sourceCommandId?: string
  sourceStream?: 'stdout' | 'stderr'
  sourceLine?: number
  sourceOffset?: number
}

export interface RuntimeSessionRow {
  id: string
  workflowRunId: string
  provider: string
  sandboxId: string
  sessionId: string
  commandId: string
  status: 'starting' | 'running' | 'completed' | 'failed' | 'cancelled'
  startedAt: number
  updatedAt: number
  completedAt?: number
}

export interface SandboxPolicyRow {
  lifecycle: {
    ephemeral: boolean
    retainAfterRun: boolean
    autoStopMinutes?: number
    autoArchiveMinutes?: number
    autoDeleteMinutes?: number
  }
  network: {
    blockAll?: boolean
    allowList?: string
  }
  resources: {
    cpu?: number
    memoryGb?: number
    diskGb?: number
  }
  timeoutSeconds?: number
}

export interface EvidenceArtifactRow {
  id: string
  workflowRunId: string
  traceId?: string
  kind:
    | 'raw-trace'
    | 'stdout'
    | 'stderr'
    | 'diff'
    | 'test-report'
    | 'screenshot'
    | 'video'
    | 'policy-result'
    | 'trust-report'
  label?: string
  storageProvider: 'cloudflare-r2'
  storageKey: string
  contentType: string
  sizeBytes: number
  sha256: string
  retentionPolicy?: string
  createdAt: number
}

export interface SandboxExecutionRow {
  id: string
  workflowRunId: string
  provider: string
  sandboxId: string
  command: string
  runtimeModel?: string
  status: 'succeeded' | 'failed'
  exitCode?: number
  stdout: string
  stderr?: string
  policy?: SandboxPolicyRow
  startedAt: number
  completedAt: number
}

export interface CandidatePatchSetRow {
  id: string
  workflowRunId: string
  status: 'captured' | 'empty' | 'failed'
  baseRef?: string
  baseSha?: string
  headRef?: string
  headSha?: string
  diffArtifactId?: string
  summary?: string
  stats?: {
    filesChanged: number
    additions: number
    deletions: number
  }
  createdAt: number
}

export interface ReviewRunRow {
  id: string
  workflowRunId: string
  sandboxExecutionId?: string
  candidatePatchSetId?: string
  kind: 'test' | 'lint' | 'policy' | 'manual'
  reviewer: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  summary?: string
  startedAt: number
  completedAt?: number
  createdAt: number
}

export interface ReviewFindingRow {
  id: string
  workflowRunId: string
  reviewRunId?: string
  severity: 'info' | 'warning' | 'error' | 'critical'
  category: 'test' | 'lint' | 'security' | 'policy' | 'quality' | 'unknown'
  message: string
  path?: string
  startLine?: number
  endLine?: number
  evidenceArtifactId?: string
  createdAt: number
}

export interface VerificationRequirementRow {
  id: string
  workflowRunId: string
  key: string
  label: string
  kind: 'test' | 'lint' | 'build' | 'browser' | 'security' | 'review'
  required: boolean
  command?: string
  platform?: 'linux' | 'windows' | 'macos'
  architecture?: string
  requiredArtifactKinds: ReadonlyArray<EvidenceArtifactRow['kind']>
  source: 'repository-config' | 'intake' | 'policy' | 'human'
  createdAt: number
}

export interface VerificationResultRow {
  id: string
  workflowRunId: string
  requirementId: string
  candidatePatchSetId: string
  sandboxExecutionId?: string
  provider: string
  command?: string
  platform: 'linux' | 'windows' | 'macos'
  architecture: string
  environmentImage?: string
  status:
    | 'queued'
    | 'running'
    | 'passed'
    | 'failed'
    | 'error'
    | 'blocked'
    | 'cancelled'
    | 'skipped'
    | 'invalidated'
  exitCode?: number
  summary?: string
  passedCount?: number
  failedCount?: number
  skippedCount?: number
  artifactIds: ReadonlyArray<string>
  producedArtifactKinds: ReadonlyArray<EvidenceArtifactRow['kind']>
  candidateDigestBefore: string
  candidateDigestAfter?: string
  startedAt: number
  completedAt?: number
  idempotencyKey: string
}

export interface PolicyDecisionRow {
  id: string
  workflowRunId: string
  reviewRunId?: string
  candidatePatchSetId?: string
  status: 'approved' | 'rejected' | 'changes-requested' | 'manual-review'
  summary: string
  reason?: string
  policyVersion?: string
  inputDigest?: string
  verificationResultIds?: ReadonlyArray<string>
  missingRequirementIds?: ReadonlyArray<string>
  createdAt: number
}

export interface HumanDecisionRow {
  id: string
  workflowRunId: string
  sandboxExecutionId?: string
  candidatePatchSetId?: string
  reviewRunId?: string
  policyDecisionId?: string
  actorId: string
  status: 'approved' | 'rejected' | 'changes-requested'
  comment: string
  verificationOverride?: boolean
  verificationOverrideReason?: string
  decidedAt: number
  idempotencyKey?: string
}

export interface PublicationResultRow {
  id: string
  workflowRunId: string
  provider: string
  kind: 'issue-comment' | 'check-run' | 'draft-pull-request' | 'branch'
  status: 'pending' | 'published' | 'failed'
  externalId?: string
  url?: string
  summary?: string
  error?: string
  createdAt: number
  idempotencyKey?: string
}

export interface ProvenanceEventRow {
  id: string
  workflowRunId: string
  traceId: string
  parentEventId?: string
  sequence: number
  type: string
  operation: string
  pluginName?: string
  status: 'started' | 'succeeded' | 'failed' | 'blocked'
  startedAt: number
  completedAt?: number
  summary?: string
  artifactRefs: ReadonlyArray<string>
  errorCategory?: string
  idempotencyKey?: string
}

export interface WorkflowDetail extends WorkflowStartRow {
  runtimeEvents: ReadonlyArray<RuntimeEventRow>
  runtimeEventsTruncated: boolean
  runtimeSessions: ReadonlyArray<RuntimeSessionRow>
  runtimeSessionsTruncated?: boolean
  sandboxExecutions: ReadonlyArray<SandboxExecutionRow>
  sandboxExecutionsTruncated?: boolean
  evidenceArtifacts: ReadonlyArray<EvidenceArtifactRow>
  evidenceArtifactsTruncated?: boolean
  candidatePatchSets: ReadonlyArray<CandidatePatchSetRow>
  candidatePatchSetsTruncated?: boolean
  verificationRequirements: ReadonlyArray<VerificationRequirementRow>
  verificationRequirementsTruncated: boolean
  verificationResults: ReadonlyArray<VerificationResultRow>
  verificationResultsTruncated: boolean
  reviewRuns: ReadonlyArray<ReviewRunRow>
  reviewRunsTruncated?: boolean
  reviewFindings: ReadonlyArray<ReviewFindingRow>
  reviewFindingsTruncated?: boolean
  policyDecisions: ReadonlyArray<PolicyDecisionRow>
  policyDecisionsTruncated?: boolean
  humanDecisions: ReadonlyArray<HumanDecisionRow>
  humanDecisionsTruncated?: boolean
  publicationResults: ReadonlyArray<PublicationResultRow>
  publicationResultsTruncated?: boolean
  provenanceEvents: ReadonlyArray<ProvenanceEventRow>
  provenanceEventsTruncated?: boolean
}
