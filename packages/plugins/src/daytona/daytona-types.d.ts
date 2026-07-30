import { toDaytonaCreateSandboxParams } from './daytona-adapter'

export interface DaytonaClientLike {
  readonly create: (
    params: ReturnType<typeof toDaytonaCreateSandboxParams>,
    options?: { readonly timeout?: number },
  ) => Promise<DaytonaSandboxLike>
  readonly delete: (
    sandbox: DaytonaSandboxLike,
    timeout?: number,
  ) => Promise<void>
  readonly get: (sandboxIdOrName: string) => Promise<DaytonaSandboxLike>
  readonly [Symbol.asyncDispose]?: () => Promise<void>
}

export interface DaytonaSandboxLike {
  readonly id: string
  readonly name?: string | undefined
  readonly target?: string | undefined
  readonly state?: string | undefined
  readonly snapshot?: string | undefined
  readonly buildInfo?: { readonly snapshotRef?: string | undefined } | undefined
  readonly public?: boolean | undefined
  readonly cpu?: number | undefined
  readonly memory?: number | undefined
  readonly disk?: number | undefined
  readonly autoStopInterval?: number | undefined
  readonly autoArchiveInterval?: number | null | undefined
  readonly autoDeleteInterval?: number | undefined
  readonly networkBlockAll?: boolean | null | undefined
  readonly networkAllowList?: string | null | undefined
  readonly linkedSandboxId?: string | undefined
  readonly volumes?: ReadonlyArray<unknown> | undefined
  readonly refreshData: () => Promise<void>
  readonly git: {
    readonly clone: (
      url: string,
      path: string,
      branch?: string,
      commitId?: string,
      username?: string,
      password?: string,
      insecureSkipTls?: boolean,
    ) => Promise<void>
  }
  readonly process: {
    readonly executeCommand?: (
      command: string,
      cwd?: string,
      env?: Record<string, string>,
      timeout?: number,
    ) => Promise<{
      readonly exitCode?: number | undefined
      readonly result?: string | undefined
      readonly output?: string | undefined
      readonly stdout?: string | undefined
      readonly stderr?: string | undefined
    }>
    readonly createSession: (sessionId: string) => Promise<void>
    readonly executeSessionCommand: (
      sessionId: string,
      request: {
        readonly command: string
        readonly runAsync?: boolean
        readonly suppressInputEcho?: boolean
      },
      timeout?: number,
    ) => Promise<{
      readonly exitCode?: number | undefined
      readonly output?: string | undefined
      readonly stdout?: string | undefined
      readonly stderr?: string | undefined
    }>
    readonly getSessionCommand?: (
      sessionId: string,
      commandId: string,
    ) => Promise<{
      readonly id?: string | undefined
      readonly command?: string | undefined
      readonly exitCode?: number | undefined
    }>
    readonly getSessionCommandLogs?: {
      (
        sessionId: string,
        commandId: string,
      ): Promise<{
        readonly output?: string | undefined
        readonly stdout?: string | undefined
        readonly stderr?: string | undefined
      }>
      (
        sessionId: string,
        commandId: string,
        onStdout: (chunk: string) => void,
        onStderr: (chunk: string) => void,
      ): Promise<void>
    }
    readonly sendSessionCommandInput?: (
      sessionId: string,
      commandId: string,
      data: string,
    ) => Promise<void>
    readonly deleteSession: (sessionId: string) => Promise<void>
  }
  readonly waitUntilStarted: (timeout?: number) => Promise<void>
  readonly delete: (timeout?: number) => Promise<void>
}
