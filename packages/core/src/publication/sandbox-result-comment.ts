import type { SandboxExecution } from '@patchplane/domain/sandbox-execution'
import type { WorkflowStart } from '@patchplane/domain/workflow-start'

export function formatSandboxResultComment(input: {
  readonly workflowStart: WorkflowStart
  readonly sandboxExecution: SandboxExecution
  readonly maxOutputLength?: number
}) {
  const execution = input.sandboxExecution
  const status = execution.status === 'succeeded' ? 'verification passed' : 'verification failed'
  const maxOutputLength = input.maxOutputLength ?? 5000
  const truncatedOutput = execution.stdout.length <= maxOutputLength
    ? execution.stdout
    : `${execution.stdout.slice(0, maxOutputLength)}\n\n…truncated…`
  const externalRef = input.workflowStart.promptRequest.externalRef
  const repository = externalRef?.repositoryFullName ?? 'unknown'
  const sourceRef = externalRef?.pullRequestNumber !== undefined
    ? `PR #${externalRef.pullRequestNumber}`
    : externalRef?.issueNumber !== undefined
    ? `Issue #${externalRef.issueNumber}`
    : 'unknown'

  return [
    '## PatchPlane Patch Report',
    '',
    `**Status:** ${status}`,
    '',
    'For this AI-generated patch:',
    '',
    `- Repository: ${repository}`,
    `- Source: ${sourceRef}`,
    `- Workflow run: ${input.workflowStart.workflowRun.id}`,
    `- Sandbox: ${execution.provider}`,
    `- Command: \`${execution.command.replaceAll('`', '\\`')}\``,
    `- Exit code: ${execution.exitCode ?? 'unknown'}`,
    `- Decision: pending human approval`,
    '',
    '> This patch is not trusted until a maintainer reviews the evidence and records a decision.',
    '',
    '<details><summary>Sandbox output evidence</summary>',
    '',
    '```txt',
    truncatedOutput.replaceAll('```', '`\u200b``'),
    '```',
    '',
    '</details>',
  ].join('\n')
}
