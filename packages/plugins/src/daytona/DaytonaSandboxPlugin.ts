import { Config, Effect, Exit, Layer, Schedule, Stream } from 'effect'
import { Daytona } from '@daytona/sdk'
import { SandboxError } from '@patchplane/domain/errors'
import {
  SandboxService,
  type SandboxEvidenceArtifact,
  type SandboxVerificationResult,
} from '@patchplane/core/services/sandbox-service'
import {
  DAYTONA_DEFAULT_COMMAND,
  DAYTONA_DEFAULT_COMMAND_TIMEOUT_SECONDS,
  DAYTONA_DEFAULT_CREATE_TIMEOUT_SECONDS,
  DAYTONA_DEFAULT_DELETE_RETRY_ATTEMPTS,
  DAYTONA_DEFAULT_DELETE_TIMEOUT_SECONDS,
  DAYTONA_DEFAULT_PI_CLI_VERSION,
  DAYTONA_DEFAULT_START_TIMEOUT_SECONDS,
  DaytonaConfig,
} from './DaytonaConfig'
import {
  shouldRetainDaytonaSandboxes,
  toDaytonaClientConfig,
  toDaytonaCreateSandboxParams,
  toSandboxPolicy,
} from './daytona-adapter'
import { executeSandboxCommand, startSandboxSessionCommand, streamSandboxSessionCommandLogs } from './daytona-process'
import { sanitizeDaytonaCause } from './daytona-redaction'
import { shellQuote } from './daytona-shell'
import { buildPiCommandSpec, buildPiRpcCommandSpec, buildRedactedPiCommandSpec, renderShellCommand } from '../sandbox-runtime/pi/command'
import { piRuntimeEnvironment } from '../sandbox-runtime/pi/config'
import { parsePiJsonRuntimeEventsEffect } from '../sandbox-runtime/pi/events'
import { decodePiRpcRuntimeEvents, type PiRpcRuntimeEvent } from '../sandbox-runtime/pi/ingestion'
import { makePiRuntimeSession } from '../sandbox-runtime/pi/runtime-session'
import { makePiRpcCommandSender } from '../sandbox-runtime/pi/transport'

const evidenceCaptureTimeoutSeconds = 30
const textArtifactMarker = '\n---PATCHPLANE_ARTIFACT_BODY---\n'
const binaryArtifactMarker = '\n---PATCHPLANE_ARTIFACT_BODY_BASE64---\n'

export interface DaytonaClientLike {
  readonly create: (
    params: ReturnType<typeof toDaytonaCreateSandboxParams>,
    options?: { readonly timeout?: number },
  ) => Promise<DaytonaSandboxLike>
  readonly delete: (sandbox: DaytonaSandboxLike, timeout?: number) => Promise<void>
  readonly get?: (sandboxIdOrName: string) => Promise<DaytonaSandboxLike>
  readonly [Symbol.asyncDispose]?: () => Promise<void>
}

export interface DaytonaSandboxLike {
  readonly id: string
  readonly name?: string | undefined
  readonly target?: string | undefined
  readonly state?: string | undefined
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
    readonly getSessionCommand?: (sessionId: string, commandId: string) => Promise<{
      readonly id?: string | undefined
      readonly command?: string | undefined
      readonly exitCode?: number | undefined
    }>
    readonly getSessionCommandLogs?: {
      (sessionId: string, commandId: string): Promise<{
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
    readonly sendSessionCommandInput?: (sessionId: string, commandId: string, data: string) => Promise<void>
    readonly deleteSession: (sessionId: string) => Promise<void>
  }
  readonly waitUntilStarted: (timeout?: number) => Promise<void>
  readonly delete: (timeout?: number) => Promise<void>
}

function isDaytonaNotFoundCause(cause: unknown): boolean {
  const text = cause instanceof Error ? cause.message : String(cause)
  return /\b(404|not found|not_found)\b/i.test(text)
}

function sandboxBoundaryError(operation: string, message: string) {
  return (cause: unknown) => new SandboxError({
    operation,
    message,
    cause: sanitizeDaytonaCause(cause),
  })
}

function deleteSandboxWithRetries(input: {
  readonly daytona: DaytonaClientLike
  readonly sandbox: DaytonaSandboxLike
  readonly traceId: string
  readonly timeoutSeconds: number
  readonly retryAttempts: number
}) {
  const totalRetries = Math.max(0, Math.floor(input.retryAttempts))
  let attempt = 0

  return Effect.tryPromise({
    try: () => input.daytona.delete(input.sandbox, input.timeoutSeconds),
    catch: (cause) => ({ cause, attempt: ++attempt }),
  }).pipe(
    Effect.tapError(({ cause, attempt: loggedAttempt }) =>
      Effect.logWarning('Failed to delete Daytona sandbox', {
        traceId: input.traceId,
        sandboxId: input.sandbox.id,
        attempt: loggedAttempt,
        totalAttempts: totalRetries + 1,
        cause: sanitizeDaytonaCause(cause),
      })
    ),
    Effect.mapError(({ cause }) => cause),
    Effect.retry(Schedule.recurs(totalRetries)),
  )
}

function makeDefaultDaytonaClient(config: DaytonaConfig): DaytonaClientLike {
  const daytona = new Daytona(toDaytonaClientConfig(config))
  return {
    create: (params, options) => daytona.create(params, options),
    delete: (sandbox, timeout) => sandbox.delete(timeout),
    get: (sandboxIdOrName) => daytona.get(sandboxIdOrName),
    [Symbol.asyncDispose]: () => daytona[Symbol.asyncDispose]?.() ?? Promise.resolve(),
  }
}

function nonEmpty(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0
}

function parseTextArtifactProbe(stdout: string) {
  const markerIndex = stdout.indexOf(textArtifactMarker)
  if (markerIndex < 0) return undefined
  const path = stdout.slice(0, markerIndex).trim()
  const body = stdout.slice(markerIndex + textArtifactMarker.length)
  return path.length === 0 || body.length === 0 ? undefined : { path, body }
}

function parseBinaryArtifactProbe(stdout: string) {
  const markerIndex = stdout.indexOf(binaryArtifactMarker)
  if (markerIndex < 0) return undefined
  const path = stdout.slice(0, markerIndex).trim()
  const encoded = stdout.slice(markerIndex + binaryArtifactMarker.length).replace(/\s+/g, '')
  if (path.length === 0 || encoded.length === 0) return undefined
  const binary = atob(encoded)
  const body = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    body[index] = binary.charCodeAt(index)
  }
  return { path, body }
}

function testReportContentType(path: string) {
  return path.endsWith('.xml') ? 'application/xml' : 'application/json'
}

function testReportProbeCommand() {
  return [
    'for file in',
    [
      '.patchplane/test-report.json',
      '.patchplane/test-report.xml',
      'patchplane-test-report.json',
      'patchplane-test-report.xml',
      'test-results/junit.xml',
      'junit.xml',
      'coverage/coverage-final.json',
    ].map((path) => `'${path}'`).join(' '),
    '; do',
    'if [ -s "$file" ]; then',
    `printf '%s${textArtifactMarker.replaceAll('\n', '\\n')}' "$file";`,
    'cat "$file";',
    'exit 0;',
    'fi;',
    'done',
  ].join(' ')
}

function screenshotProbeCommand() {
  const paths = [
    '.patchplane/browser-screenshot.png',
    'patchplane-browser-screenshot.png',
    'test-results/browser-screenshot.png',
    'playwright-report/browser-screenshot.png',
  ]
  const script = [
    'const fs=require("fs");',
    `const paths=${JSON.stringify(paths)};`,
    'const path=paths.find((candidate)=>fs.existsSync(candidate)&&fs.statSync(candidate).size>0);',
    'if(path){',
    `process.stdout.write(path+${JSON.stringify(binaryArtifactMarker)}+fs.readFileSync(path).toString("base64"));`,
    '}',
  ].join('')
  return `node -e '${script}'`
}

function captureRepositoryBaseSha(sandbox: DaytonaSandboxLike, traceId: string) {
  return Effect.gen(function* () {
    const result = yield* executeSandboxCommand(sandbox, {
      command: 'git rev-parse HEAD',
      timeoutSeconds: evidenceCaptureTimeoutSeconds,
      traceId: `${traceId}-base-sha`,
    })
    const baseSha = result.stdout.trim()
    if (result.exitCode !== 0 || !/^[0-9a-f]{40,64}$/i.test(baseSha)) {
      return yield* new SandboxError({
        operation: 'daytona.captureRepositoryBaseSha',
        message: 'Daytona could not determine the repository base commit for evidence capture',
        cause: { exitCode: result.exitCode, stderr: result.stderr },
      })
    }
    return baseSha
  })
}

function collectSandboxEvidenceArtifacts(
  sandbox: DaytonaSandboxLike,
  input: {
    readonly traceId: string
    readonly baseSha: string
    readonly evidenceTestReportCommand?: string | undefined
    readonly evidenceBrowserScreenshotCommand?: string | undefined
  },
) {
  return Effect.gen(function* () {
    const artifacts: Array<SandboxEvidenceArtifact> = []
    const verificationResults: Array<SandboxVerificationResult> = []
    const runCaptureCommand = (operation: string, command: string) =>
      executeSandboxCommand(sandbox, {
        command,
        timeoutSeconds: evidenceCaptureTimeoutSeconds,
        traceId: `${input.traceId}-${operation}`,
      }).pipe(
        Effect.catch((error) =>
          Effect.logWarning('Evidence artifact probe failed', {
            traceId: input.traceId,
            operation,
            error: error.message,
          }).pipe(Effect.as(undefined))
        ),
      )

    const diff = yield* runCaptureCommand(
      'diff',
      `git add -N . >/dev/null 2>&1 || true; git diff --binary --no-ext-diff ${shellQuote(input.baseSha)} -- .`,
    )
    if (diff !== undefined && diff.exitCode === 0 && diff.stdout.trim().length > 0) {
      artifacts.push({
        kind: 'diff',
        label: 'Candidate patch diff',
        contentType: 'text/x-diff',
        body: diff.stdout,
        retentionPolicy: 'alpha-14d',
      })
    }

    if (nonEmpty(input.evidenceTestReportCommand)) {
      const result = yield* runCaptureCommand('test-report-command', input.evidenceTestReportCommand)
      verificationResults.push(result === undefined
        ? {
            kind: 'test',
            command: input.evidenceTestReportCommand,
            status: 'failed',
            message: 'Test verification command could not be executed.',
          }
        : {
            kind: 'test',
            command: input.evidenceTestReportCommand,
            status: result.exitCode === 0 ? 'succeeded' : 'failed',
            ...(result.exitCode === undefined ? {} : { exitCode: result.exitCode }),
            ...(result.exitCode === 0 ? {} : { message: `Test verification command failed with exit ${result.exitCode ?? 'unknown'}.` }),
          })
    }
    const testReport = yield* runCaptureCommand('test-report-probe', testReportProbeCommand())
    if (testReport !== undefined && testReport.exitCode === 0) {
      const probed = parseTextArtifactProbe(testReport.stdout)
      if (probed !== undefined) {
        artifacts.push({
          kind: 'test-report',
          label: 'Test report',
          contentType: testReportContentType(probed.path),
          body: probed.body,
          retentionPolicy: 'alpha-14d',
        })
      }
    }
    if (nonEmpty(input.evidenceTestReportCommand) && !artifacts.some((artifact) => artifact.kind === 'test-report')) {
      const result = verificationResults.find((verification) => verification.kind === 'test')
      if (result?.status === 'succeeded') {
        verificationResults[verificationResults.indexOf(result)] = {
          ...result,
          status: 'failed',
          message: 'Test verification command did not produce a supported test report artifact.',
        }
      }
    }

    if (nonEmpty(input.evidenceBrowserScreenshotCommand)) {
      const result = yield* runCaptureCommand('browser-screenshot-command', input.evidenceBrowserScreenshotCommand)
      verificationResults.push(result === undefined
        ? {
            kind: 'browser',
            command: input.evidenceBrowserScreenshotCommand,
            status: 'failed',
            message: 'Browser verification command could not be executed.',
          }
        : {
            kind: 'browser',
            command: input.evidenceBrowserScreenshotCommand,
            status: result.exitCode === 0 ? 'succeeded' : 'failed',
            ...(result.exitCode === undefined ? {} : { exitCode: result.exitCode }),
            ...(result.exitCode === 0 ? {} : { message: `Browser verification command failed with exit ${result.exitCode ?? 'unknown'}.` }),
          })
    }
    const screenshot = yield* runCaptureCommand('browser-screenshot-probe', screenshotProbeCommand())
    if (screenshot !== undefined && screenshot.exitCode === 0) {
      const probed = parseBinaryArtifactProbe(screenshot.stdout)
      if (probed !== undefined) {
        artifacts.push({
          kind: 'screenshot',
          label: 'Browser verification screenshot',
          contentType: 'image/png',
          body: probed.body,
          retentionPolicy: 'alpha-14d',
        })
      }
    }
    if (nonEmpty(input.evidenceBrowserScreenshotCommand) && !artifacts.some((artifact) => artifact.kind === 'screenshot')) {
      const result = verificationResults.find((verification) => verification.kind === 'browser')
      if (result?.status === 'succeeded') {
        verificationResults[verificationResults.indexOf(result)] = {
          ...result,
          status: 'failed',
          message: 'Browser verification command did not produce a supported screenshot artifact.',
        }
      }
    }

    return { artifacts, verificationResults }
  })
}

export function makeDaytonaSandboxLayer(
  makeClient: (config: DaytonaConfig) => DaytonaClientLike = makeDefaultDaytonaClient,
) {
  return Layer.effect(
    SandboxService,
    Effect.gen(function* () {
      const config = yield* DaytonaConfig

      const runWithSandbox = <A>(input: {
        readonly traceId: string
        readonly repositoryFullName: string
        readonly envVars?: Record<string, string> | undefined
        readonly retainAfterUse?: boolean | undefined
      }, use: (sandbox: DaytonaSandboxLike) => Effect.Effect<A, unknown>) =>
        Effect.acquireUseRelease(
          Effect.gen(function* () {
            const daytona = makeClient(config)
            const retainSandboxes = shouldRetainDaytonaSandboxes(config)
            const sandbox = yield* Effect.tryPromise({
              try: () => daytona.create(
                toDaytonaCreateSandboxParams(config, input),
                { timeout: DAYTONA_DEFAULT_CREATE_TIMEOUT_SECONDS },
              ),
              catch: sandboxBoundaryError('daytona.createSandbox', 'Daytona failed to create sandbox'),
            })

            yield* Effect.logInfo('Created Daytona sandbox', {
              traceId: input.traceId,
              sandboxId: sandbox.id,
              sandboxName: sandbox.name,
              target: sandbox.target,
              retainSandboxes: retainSandboxes || input.retainAfterUse === true,
            })

            yield* Effect.tryPromise({
              try: () => sandbox.waitUntilStarted(DAYTONA_DEFAULT_START_TIMEOUT_SECONDS),
              catch: sandboxBoundaryError('daytona.waitUntilStarted', 'Daytona sandbox failed to start'),
            })

            yield* Effect.logInfo('Started Daytona sandbox', {
              traceId: input.traceId,
              sandboxId: sandbox.id,
              state: sandbox.state,
            })

            return { daytona, sandbox, retainSandboxes }
          }),
          ({ sandbox }) => use(sandbox),
          ({ daytona, sandbox, retainSandboxes }) =>
            Effect.gen(function* () {
              if (retainSandboxes || input.retainAfterUse === true) {
                yield* Effect.logInfo('Retaining Daytona sandbox for inspection', {
                  traceId: input.traceId,
                  sandboxId: sandbox.id,
                })
              } else {
                const deleteExit = yield* deleteSandboxWithRetries({
                  daytona,
                  sandbox,
                  traceId: input.traceId,
                  timeoutSeconds: DAYTONA_DEFAULT_DELETE_TIMEOUT_SECONDS,
                  retryAttempts: DAYTONA_DEFAULT_DELETE_RETRY_ATTEMPTS,
                }).pipe(
                  Effect.mapError(sandboxBoundaryError('daytona.deleteSandbox', 'Daytona failed to delete sandbox')),
                  Effect.exit,
                )

                if (Exit.isSuccess(deleteExit)) {
                  yield* Effect.logInfo('Deleted Daytona sandbox', {
                    traceId: input.traceId,
                    sandboxId: sandbox.id,
                  })
                } else {
                  yield* Effect.logWarning('Failed to delete Daytona sandbox after retries', {
                    traceId: input.traceId,
                    sandboxId: sandbox.id,
                  })
                }
              }

              yield* Effect.tryPromise({
                try: () => daytona[Symbol.asyncDispose]?.call(daytona) ?? Promise.resolve(),
                catch: sandboxBoundaryError('daytona.disposeClient', 'Daytona client disposal failed'),
              }).pipe(Effect.ignore)
            }),
        )

      const cloneRepository = (sandbox: DaytonaSandboxLike, input: {
        readonly repositoryUrl: string
        readonly branch?: string | undefined
        readonly commitId?: string | undefined
        readonly gitUsername?: string | undefined
        readonly gitPassword?: string | undefined
      }) =>
        Effect.tryPromise({
          try: () => sandbox.git.clone(
            input.repositoryUrl,
            'workspace/repo',
            input.branch,
            input.commitId,
            input.gitUsername,
            input.gitPassword,
          ),
          catch: sandboxBoundaryError('daytona.git.clone', 'Daytona failed to clone repository'),
        })

      return SandboxService.of({
        runRepositoryAgent: (input) =>
          Effect.gen(function* () {
            const startedAt = Date.now()
            const envVars = yield* piRuntimeEnvironment({ provider: input.provider }).pipe(
              Effect.mapError(sandboxBoundaryError('pi.config', 'Pi runtime provider configuration is invalid')),
            )
            return yield* runWithSandbox(
              { ...input, envVars, retainAfterUse: input.mode === 'rpc' },
              (sandbox) => Effect.gen(function* () {
                yield* cloneRepository(sandbox, input)
                const baseSha = yield* captureRepositoryBaseSha(sandbox, input.traceId)
                const timeoutSeconds = input.timeoutSeconds ?? DAYTONA_DEFAULT_COMMAND_TIMEOUT_SECONDS
                if (input.mode === 'rpc') {
                  const command = renderShellCommand(buildPiRpcCommandSpec({
                    provider: input.provider,
                    model: input.model,
                    version: DAYTONA_DEFAULT_PI_CLI_VERSION,
                    thinking: input.thinking,
                  }))
                  const handle = yield* startSandboxSessionCommand(sandbox, {
                    command,
                    timeoutSeconds,
                    traceId: input.traceId,
                  })
                  if (input.onRuntimeSessionStarted !== undefined) {
                    yield* input.onRuntimeSessionStarted({
                      provider: 'daytona:pi-rpc',
                      sandboxId: sandbox.id,
                      sessionId: handle.sessionId,
                      commandId: handle.commandId,
                      startedAt,
                    })
                  }
                  const persistRuntimeEvents = (events: ReadonlyArray<PiRpcRuntimeEvent>) =>
                    events.length === 0 || input.onRuntimeEvents === undefined
                      ? Effect.void
                      : input.onRuntimeEvents(events).pipe(
                        Effect.catch((error) => Effect.logWarning('Failed to persist incremental Pi RPC runtime events', {
                          traceId: input.traceId,
                          error: String(error),
                        })),
                      )

                  const pi = makePiRuntimeSession({
                    sessionId: handle.sessionId,
                    commandId: handle.commandId,
                    sendInput: handle.sendInput,
                    stdout: streamSandboxSessionCommandLogs(sandbox, handle.sessionId, handle.commandId).pipe(
                      Stream.filter((chunk) => chunk.stream === 'stdout'),
                      Stream.map((chunk) => chunk.chunk),
                    ),
                  })

                  yield* pi.events.pipe(
                    Stream.runForEach((event) => persistRuntimeEvents([event])),
                    Effect.tapError((error) => Effect.logWarning('Pi RPC log stream ended with error; reconciling from buffered logs', {
                      traceId: input.traceId,
                      error: error.message,
                    })),
                    Effect.ignore,
                    Effect.andThen(Effect.gen(function* () {
                      const reconcileLogs = yield* handle.getLogs().pipe(Effect.catch(() => Effect.succeed({ stdout: '' })))
                      const reconciledEvents = yield* Stream.make(reconcileLogs.stdout).pipe(
                        decodePiRpcRuntimeEvents({
                          sessionId: handle.sessionId,
                          commandId: handle.commandId,
                          stream: 'stdout',
                        }),
                        Stream.runCollect,
                        Effect.map((events) => Array.from(events)),
                      )
                      yield* persistRuntimeEvents(reconciledEvents)
                    })),
                    Effect.forkDetach,
                  )

                  yield* pi.getState({ id: `${input.traceId}:get-state` })
                  yield* pi.prompt({ id: `${input.traceId}:prompt`, message: input.prompt })
                  const logs = yield* handle.getLogs()
                  const commandStatus = yield* handle.getCommand()
                  const parsedRuntimeEvents = yield* Stream.make(logs.stdout).pipe(
                    decodePiRpcRuntimeEvents({
                      sessionId: handle.sessionId,
                      commandId: handle.commandId,
                      stream: 'stdout',
                    }),
                    Stream.runCollect,
                    Effect.map((events) => Array.from(events)),
                  )
                  const { artifacts: evidenceArtifacts, verificationResults } = yield* collectSandboxEvidenceArtifacts(
                    sandbox,
                    { ...input, baseSha },
                  )

                  return {
                    provider: 'daytona:pi-rpc',
                    sandboxId: sandbox.id,
                    sessionId: handle.sessionId,
                    commandId: handle.commandId,
                    command: renderShellCommand(buildPiRpcCommandSpec({
                      provider: input.provider,
                      model: input.model,
                      version: DAYTONA_DEFAULT_PI_CLI_VERSION,
                      thinking: input.thinking,
                    })),
                    exitCode: commandStatus.exitCode,
                    stdout: logs.stdout,
                    stderr: logs.stderr,
                    policy: toSandboxPolicy(config, { timeoutSeconds }),
                    runtimeEvents: parsedRuntimeEvents,
                    evidenceArtifacts,
                    verificationResults,
                    baseSha,
                    startedAt,
                    completedAt: Date.now(),
                  }
                }

                const command = renderShellCommand(buildPiCommandSpec({
                  provider: input.provider,
                  model: input.model,
                  prompt: input.prompt,
                  version: DAYTONA_DEFAULT_PI_CLI_VERSION,
                  thinking: input.thinking,
                }))
                const response = yield* executeSandboxCommand(sandbox, {
                  command,
                  timeoutSeconds,
                  traceId: input.traceId,
                })
                const parsedRuntimeEvents = yield* parsePiJsonRuntimeEventsEffect(response.stdout)

                if (parsedRuntimeEvents.parseErrors.length > 0) {
                  yield* Effect.logWarning('Pi JSON event parsing skipped malformed output lines', {
                    traceId: input.traceId,
                    sandboxId: sandbox.id,
                    parseErrors: parsedRuntimeEvents.parseErrors,
                  })
                }
                const { artifacts: evidenceArtifacts, verificationResults } = yield* collectSandboxEvidenceArtifacts(
                  sandbox,
                  { ...input, baseSha },
                )

                return {
                  provider: 'daytona:pi',
                  sandboxId: sandbox.id,
                  command: renderShellCommand(buildRedactedPiCommandSpec({
                    provider: input.provider,
                    model: input.model,
                    version: DAYTONA_DEFAULT_PI_CLI_VERSION,
                    thinking: input.thinking,
                  })),
                  exitCode: response.exitCode,
                  stdout: response.stdout,
                  stderr: response.stderr,
                  policy: toSandboxPolicy(config, { timeoutSeconds }),
                  runtimeEvents: parsedRuntimeEvents.events,
                  evidenceArtifacts,
                  verificationResults,
                  baseSha,
                  startedAt,
                  completedAt: Date.now(),
                }
              }))
          }).pipe(
            Effect.mapError(
              (cause) =>
                new SandboxError({
                  operation: 'daytona.runRepositoryAgent',
                  message: 'Daytona failed to run Pi agent in repository sandbox',
                  cause,
                }),
            ),
          ),
        abortRuntimeSession: (input) =>
          Effect.gen(function* () {
            const daytona = makeClient(config)
            const sandbox = yield* Effect.tryPromise({
              try: () => daytona.get?.(input.sandboxId) ?? Promise.reject(new Error('Daytona get is unavailable')),
              catch: sandboxBoundaryError('daytona.getSandbox', 'Daytona failed to get sandbox for runtime abort'),
            })
            const pi = makePiRpcCommandSender({
              sendInput: (data) => Effect.tryPromise({
                try: () => sandbox.process.sendSessionCommandInput?.(input.sessionId, input.commandId, data) ?? Promise.reject(new Error('Daytona sendSessionCommandInput is unavailable')),
                catch: sandboxBoundaryError('daytona.sendSessionCommandInput', 'Daytona failed to send abort to runtime session'),
              }),
            })
            yield* pi.abort({ id: `${input.traceId}:abort` })
            return { provider: 'daytona:pi-rpc', sandboxId: input.sandboxId, sessionId: input.sessionId, commandId: input.commandId, status: 'sent' as const }
          }).pipe(Effect.ensuring(Effect.tryPromise({
            try: () => makeClient(config)[Symbol.asyncDispose]?.() ?? Promise.resolve(),
            catch: sandboxBoundaryError('daytona.disposeClient', 'Daytona client disposal failed'),
          }).pipe(Effect.ignore))),
        steerRuntimeSession: (input) =>
          Effect.gen(function* () {
            const daytona = makeClient(config)
            const sandbox = yield* Effect.tryPromise({
              try: () => daytona.get?.(input.sandboxId) ?? Promise.reject(new Error('Daytona get is unavailable')),
              catch: sandboxBoundaryError('daytona.getSandbox', 'Daytona failed to get sandbox for runtime steering'),
            })
            const pi = makePiRpcCommandSender({
              sendInput: (data) => Effect.tryPromise({
                try: () => sandbox.process.sendSessionCommandInput?.(input.sessionId, input.commandId, data) ?? Promise.reject(new Error('Daytona sendSessionCommandInput is unavailable')),
                catch: sandboxBoundaryError('daytona.sendSessionCommandInput', 'Daytona failed to send steering to runtime session'),
              }),
            })
            yield* pi.steer({ id: `${input.traceId}:steer`, message: input.message })
            return { provider: 'daytona:pi-rpc', sandboxId: input.sandboxId, sessionId: input.sessionId, commandId: input.commandId, status: 'sent' as const }
          }),
        followUpRuntimeSession: (input) =>
          Effect.gen(function* () {
            const daytona = makeClient(config)
            const sandbox = yield* Effect.tryPromise({
              try: () => daytona.get?.(input.sandboxId) ?? Promise.reject(new Error('Daytona get is unavailable')),
              catch: sandboxBoundaryError('daytona.getSandbox', 'Daytona failed to get sandbox for runtime follow-up'),
            })
            const pi = makePiRpcCommandSender({
              sendInput: (data) => Effect.tryPromise({
                try: () => sandbox.process.sendSessionCommandInput?.(input.sessionId, input.commandId, data) ?? Promise.reject(new Error('Daytona sendSessionCommandInput is unavailable')),
                catch: sandboxBoundaryError('daytona.sendSessionCommandInput', 'Daytona failed to send follow-up to runtime session'),
              }),
            })
            yield* pi.followUp({ id: `${input.traceId}:follow-up`, message: input.message })
            return { provider: 'daytona:pi-rpc', sandboxId: input.sandboxId, sessionId: input.sessionId, commandId: input.commandId, status: 'sent' as const }
          }),
        terminateRuntimeSession: (input) =>
          Effect.gen(function* () {
            const daytona = makeClient(config)
            const sandbox = yield* Effect.tryPromise({
              try: () => daytona.get?.(input.sandboxId) ?? Promise.reject(new Error('Daytona get is unavailable')),
              catch: sandboxBoundaryError('daytona.getSandbox', 'Daytona failed to get sandbox for runtime termination'),
            })
            yield* Effect.tryPromise({
              try: async () => {
                try {
                  await sandbox.process.deleteSession(input.sessionId)
                } catch (cause) {
                  if (!isDaytonaNotFoundCause(cause)) throw cause
                }
              },
              catch: sandboxBoundaryError('daytona.deleteSession', 'Daytona failed to terminate runtime session'),
            })
            return { provider: 'daytona:pi-rpc', sandboxId: input.sandboxId, sessionId: input.sessionId, commandId: input.commandId, status: 'terminated' as const }
          }),
        runRepositoryCommand: (input) =>
          Effect.gen(function* () {
            const startedAt = Date.now()
            return yield* runWithSandbox(
              { ...input, envVars: input.env === undefined ? undefined : { ...input.env } },
              (sandbox) => Effect.gen(function* () {
                yield* cloneRepository(sandbox, input)
                const baseSha = yield* captureRepositoryBaseSha(sandbox, input.traceId)
                const command = input.command.trim().length === 0
                  ? DAYTONA_DEFAULT_COMMAND
                  : input.command
                const timeoutSeconds = input.timeoutSeconds ?? DAYTONA_DEFAULT_COMMAND_TIMEOUT_SECONDS
                const response = yield* executeSandboxCommand(sandbox, {
                  command,
                  timeoutSeconds,
                  traceId: input.traceId,
                })
                const { artifacts: evidenceArtifacts, verificationResults } = yield* collectSandboxEvidenceArtifacts(
                  sandbox,
                  { ...input, baseSha },
                )

                return {
                  provider: 'daytona',
                  sandboxId: sandbox.id,
                  command,
                  exitCode: response.exitCode,
                  stdout: response.stdout,
                  stderr: response.stderr,
                  policy: toSandboxPolicy(config, { timeoutSeconds }),
                  evidenceArtifacts,
                  verificationResults,
                  baseSha,
                  startedAt,
                  completedAt: Date.now(),
                }
              }))
          }).pipe(
            Effect.mapError(
              (cause) =>
                new SandboxError({
                  operation: 'daytona.runRepositoryCommand',
                  message: 'Daytona failed to run repository command',
                  cause,
                }),
            ),
          ),
      })
    }),
  )
}

export const DaytonaSandboxPlugin = {
  layer: makeDaytonaSandboxLayer(),
  config: DaytonaConfig,
} satisfies {
  readonly layer: Layer.Layer<SandboxService, Config.ConfigError>
  readonly config: typeof DaytonaConfig
}
