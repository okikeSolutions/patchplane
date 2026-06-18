import type { SandboxExecution } from '@patchplane/domain/sandbox-execution'
import type { WorkflowStart } from '@patchplane/domain/workflow-start'

export function formatSandboxResultComment(input: {
  readonly workflowStart: WorkflowStart
  readonly sandboxExecution: SandboxExecution
  readonly maxOutputLength?: number
}) {
  const execution = input.sandboxExecution
  const status = execution.status === 'succeeded' ? 'passed' : 'failed'
  const maxOutputLength = input.maxOutputLength ?? 5000
  const truncatedOutput = execution.stdout.length <= maxOutputLength
    ? execution.stdout
    : `${execution.stdout.slice(0, maxOutputLength)}\n\n…truncated…`

  return [
    `PatchPlane sandbox run ${status}.`,
    '',
    `- Workflow run: ${input.workflowStart.workflowRun.id}`,
    `- Sandbox provider: ${execution.provider}`,
    `- Command: \`${execution.command.replaceAll('`', '\\`')}\``,
    `- Exit code: ${execution.exitCode ?? 'unknown'}`,
    '',
    '<details><summary>Sandbox output</summary>',
    '',
    '```txt',
    truncatedOutput.replaceAll('```', '`\u200b``'),
    '```',
    '',
    '</details>',
  ].join('\n')
}
