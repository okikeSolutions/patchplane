import type { CandidatePatchSet, HumanDecision } from '@patchplane/domain/decision-review'
import type { PatchReportV1 } from '@patchplane/domain/patch-report-v1'
import type { SandboxExecution } from '@patchplane/domain/sandbox-execution'
import type { WorkflowStart } from '@patchplane/domain/workflow-start'

export function formatDecisionPatchReportComment(input: {
  readonly workflowStart: WorkflowStart
  readonly humanDecision: HumanDecision
  readonly sandboxExecution?: SandboxExecution | undefined
  readonly candidatePatchSet?: CandidatePatchSet | undefined
  readonly patchReport?: PatchReportV1 | undefined
  readonly verification?: {
    readonly status: 'not-configured' | 'incomplete' | 'passed' | 'failed'
    readonly requiredCount: number
    readonly passedCount: number
  } | undefined
}) {
  const externalRef = input.workflowStart.promptRequest.externalRef
  const repository = externalRef?.repositoryFullName ?? 'unknown'
  const sourceRef = externalRef?.pullRequestNumber !== undefined
    ? `PR #${externalRef.pullRequestNumber}`
    : externalRef?.issueNumber !== undefined
    ? `Issue #${externalRef.issueNumber}`
    : 'unknown'
  const execution = input.sandboxExecution
  const executionStatus = execution === undefined
    ? 'not run'
    : execution.status === 'succeeded'
    ? 'sandbox execution completed'
    : 'sandbox execution failed'
  const patch = input.candidatePatchSet

  return [
    input.patchReport === undefined ? '## PatchPlane Decision Update' : '## PatchPlane Patch Report V1',
    '',
    `**Decision:** ${decisionLabel(input.humanDecision.status)}`,
    `**Execution:** ${executionStatus}`,
    `**Verification:** ${verificationLabel(input.verification)}`,
    '',
    `- Repository: ${repository}`,
    `- Source: ${sourceRef}`,
    `- Workflow run: ${input.workflowStart.workflowRun.id}`,
    ...(input.patchReport === undefined ? [] : [
      `- Requested: ${input.patchReport.requestedChange}`,
      `- Candidate digest: ${input.patchReport.candidate.digest ?? 'not captured'}`,
      `- Verification coverage: ${input.patchReport.verification.passedCount}/${input.patchReport.verification.requiredCount} required checks`,
      `- Trust state: ${input.patchReport.trustStatus}`,
    ]),
    `- Decided by: ${input.humanDecision.actorId}`,
    `- Comment: ${input.humanDecision.comment}`,
    ...(execution === undefined
      ? []
      : [
        `- Sandbox: ${execution.provider}`,
        `- Command: \`${execution.command.replaceAll('`', '\\`')}\``,
        `- Exit code: ${execution.exitCode ?? 'unknown'}`,
      ]),
    ...(patch?.summary === undefined ? [] : [`- Patch: ${patch.summary}`]),
    ...(patch?.stats === undefined
      ? []
      : [`- Stats: ${patch.stats.filesChanged} files, +${patch.stats.additions} / -${patch.stats.deletions}`]),
  ].join('\n')
}

export function decisionCheckConclusion(input: {
  readonly humanDecision: HumanDecision
  readonly sandboxExecution?: SandboxExecution | undefined
  readonly verification?: {
    readonly status: 'not-configured' | 'incomplete' | 'passed' | 'failed'
  } | undefined
}) {
  if (input.humanDecision.status === 'rejected') {
    return 'failure' as const
  }

  if (input.humanDecision.status === 'changes-requested') {
    return 'action_required' as const
  }

  if (input.sandboxExecution?.status === 'failed' || input.verification?.status === 'failed') {
    return 'failure' as const
  }
  if (
    input.verification?.status === 'passed' &&
    input.humanDecision.verificationOverride !== true
  ) {
    return 'success' as const
  }
  return input.humanDecision.status === 'approved' ? 'neutral' as const : 'action_required' as const
}

function verificationLabel(input: {
  readonly status: 'not-configured' | 'incomplete' | 'passed' | 'failed'
  readonly requiredCount: number
  readonly passedCount: number
} | undefined) {
  if (input === undefined) return 'incomplete — no durable candidate-bound verification projection was supplied'
  if (input.status === 'passed') return `passed — ${input.passedCount}/${input.requiredCount} required checks passed`
  if (input.status === 'failed') return `failed — ${input.passedCount}/${input.requiredCount} required checks passed`
  if (input.status === 'not-configured') return 'not configured — execution completion is not verification'
  return `incomplete — ${input.passedCount}/${input.requiredCount} required checks passed`
}

function decisionLabel(status: HumanDecision['status']) {
  switch (status) {
    case 'approved':
      return 'approved'
    case 'rejected':
      return 'rejected'
    case 'changes-requested':
      return 'changes requested'
    default:
      return status
  }
}
