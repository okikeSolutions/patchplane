import type { CandidatePatchSet, HumanDecision } from '@patchplane/domain/decision-review'
import type { SandboxExecution } from '@patchplane/domain/sandbox-execution'
import type { WorkflowStart } from '@patchplane/domain/workflow-start'

export function formatDecisionPatchReportComment(input: {
  readonly workflowStart: WorkflowStart
  readonly humanDecision: HumanDecision
  readonly sandboxExecution?: SandboxExecution | undefined
  readonly candidatePatchSet?: CandidatePatchSet | undefined
}) {
  const externalRef = input.workflowStart.promptRequest.externalRef
  const repository = externalRef?.repositoryFullName ?? 'unknown'
  const sourceRef = externalRef?.pullRequestNumber !== undefined
    ? `PR #${externalRef.pullRequestNumber}`
    : externalRef?.issueNumber !== undefined
    ? `Issue #${externalRef.issueNumber}`
    : 'unknown'
  const execution = input.sandboxExecution
  const verification = execution === undefined
    ? 'not run'
    : execution.status === 'succeeded'
    ? 'verification passed'
    : 'verification failed'
  const patch = input.candidatePatchSet

  return [
    '## PatchPlane Decision Update',
    '',
    `**Decision:** ${decisionLabel(input.humanDecision.status)}`,
    `**Verification:** ${verification}`,
    '',
    `- Repository: ${repository}`,
    `- Source: ${sourceRef}`,
    `- Workflow run: ${input.workflowStart.workflowRun.id}`,
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
}) {
  if (input.humanDecision.status === 'rejected') {
    return 'failure' as const
  }

  if (input.humanDecision.status === 'changes-requested') {
    return 'action_required' as const
  }

  return input.sandboxExecution?.status === 'failed' ? 'failure' as const : 'success' as const
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
