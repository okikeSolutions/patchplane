export interface DaytonaCommandSandbox {
  readonly process: {
    readonly executeCommand: (
      command: string,
      cwd?: string,
      env?: Record<string, string>,
      timeout?: number,
    ) => Promise<{
      readonly exitCode: number | undefined
      readonly result: string
    }>
  }
}

export async function executeSandboxCommand(sandbox: DaytonaCommandSandbox, input: {
  readonly command: string
  readonly env?: Record<string, string> | undefined
  readonly timeoutSeconds: number
  readonly traceId: string
}) {
  const response = await sandbox.process.executeCommand(
    input.command,
    'workspace/repo',
    input.env,
    input.timeoutSeconds,
  )

  return {
    exitCode: response.exitCode,
    stdout: response.result,
    stderr: undefined,
  }
}
