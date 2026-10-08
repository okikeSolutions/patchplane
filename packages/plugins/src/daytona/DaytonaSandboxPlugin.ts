import { Clock, Config, Effect, Exit, Layer, Stream } from 'effect'
import { SandboxError } from '@patchplane/domain/errors'
import { SandboxService } from '@patchplane/core/services/sandbox-service'
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
  toDaytonaCreateSandboxParams,
  toSandboxPolicy,
} from './daytona-adapter'
import {
  executeSandboxCommand,
  startSandboxSessionCommand,
  streamSandboxSessionCommandLogs,
} from './daytona-process'
import {
  buildPiCommandSpec,
  buildPiRpcCommandSpec,
  buildRedactedPiCommandSpec,
  renderShellCommand,
} from '../sandbox-runtime/pi/command'
import { piRuntimeEnvironment } from '../sandbox-runtime/pi/config'
import { parsePiJsonRuntimeEventsEffect } from '../sandbox-runtime/pi/events'
import {
  decodePiRpcRuntimeEvents,
  type PiRpcRuntimeEvent,
} from '../sandbox-runtime/pi/ingestion'
import { makePiRuntimeSession } from '../sandbox-runtime/pi/runtime-session'
import { makePiRpcCommandSender } from '../sandbox-runtime/pi/transport'
import type { DaytonaClientLike, DaytonaSandboxLike } from './daytona-types'
import {
  prepareProtectedVerificationSandbox,
  isDaytonaNotFoundCause,
  settleDaytonaPromise,
  sandboxBoundaryError,
  readEffectiveSandboxPolicy,
  deleteSandboxWithRetries,
  confirmSandboxDeleted,
  makeDefaultDaytonaClient,
} from './daytona-policy'
import {
  maxVerificationCommandOutputBytes,
  captureRepositoryBaseSha,
  captureInitialCandidateState,
  captureCandidateStateDigest,
  collectSandboxEvidenceArtifacts,
} from './daytona-evidence'
const maximumPiRuntimeEventsPerSession = 1_000

function projectPiRuntimeTranscript(
  events: ReadonlyArray<{
    readonly type: string
    readonly occurredAt: number
    readonly summary?: string | undefined
    readonly payloadJson?: string | undefined
  }>,
) {
  return events
    .map((event) =>
      JSON.stringify({
        type: event.type,
        occurredAt: event.occurredAt,
        summary: event.summary,
        payloadJson: event.payloadJson,
      }),
    )
    .join('\n')
}

const cloneRepository = (
  sandbox: DaytonaSandboxLike,
  input: {
    readonly repositoryUrl: string
    readonly branch?: string | undefined
    readonly commitId?: string | undefined
    readonly gitUsername?: string | undefined
    readonly gitPassword?: string | undefined
  },
) =>
  Effect.tryPromise({
    try: () =>
      sandbox.git.clone(
        input.repositoryUrl,
        'workspace/repo',
        input.branch,
        input.commitId,
        input.gitUsername,
        input.gitPassword,
      ),
    catch: sandboxBoundaryError(
      'daytona.git.clone',
      'Daytona failed to clone repository',
    ),
  })

const sendPiCommand = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.mapError(
      sandboxBoundaryError(
        'daytona.pi.rpc.send',
        'Daytona failed to deliver a Pi RPC command',
      ),
    ),
  )

export { settleDaytonaPromise } from './daytona-policy'
export type { DaytonaClientLike, DaytonaSandboxLike } from './daytona-types'

export function makeDaytonaSandboxLayer(
  makeClient: (
    config: DaytonaConfig,
  ) => DaytonaClientLike = makeDefaultDaytonaClient,
) {
  return Layer.effect(
    SandboxService,
    Effect.gen(function* () {
      const config = yield* DaytonaConfig

      const withDaytonaClient = <A, E, R>(
        use: (daytona: DaytonaClientLike) => Effect.Effect<A, E, R>,
      ) =>
        Effect.acquireUseRelease(
          Effect.sync(() => makeClient(config)),
          use,
          (daytona) =>
            Effect.logInfo('Starting Daytona client disposal').pipe(
              Effect.andThen(
                Effect.tryPromise({
                  try: async () => {
                    const dispose =
                      daytona[Symbol.asyncDispose]?.() ?? Promise.resolve()
                    let timer: ReturnType<typeof setTimeout> | undefined
                    try {
                      await Promise.race([
                        dispose,
                        new Promise<void>((resolve) => {
                          timer = setTimeout(resolve, 5_000)
                        }),
                      ])
                    } finally {
                      if (timer !== undefined) clearTimeout(timer)
                    }
                  },
                  catch: sandboxBoundaryError(
                    'daytona.disposeClient',
                    'Daytona client disposal failed',
                  ),
                }),
              ),
              Effect.tap(() =>
                Effect.logInfo('Finished Daytona client disposal'),
              ),
              Effect.ignore,
            ),
        )

      const runWithSandbox = <A>(
        input: {
          readonly traceId: string
          readonly repositoryFullName: string
          readonly envVars?: Record<string, string> | undefined
          readonly retainAfterUse?: boolean | undefined
          readonly forceDeleteAfterUse?: boolean | undefined
          readonly timeoutSeconds?: number | undefined
          readonly onSandboxCleanup?:
            | ((status: 'deleted' | 'failed' | 'retained') => void)
            | undefined
          readonly onSandboxStarted?:
            | ((sandboxId: string) => Effect.Effect<void, unknown>)
            | undefined
        },
        use: (
          sandbox: DaytonaSandboxLike,
          effectivePolicy: ReturnType<typeof toSandboxPolicy>,
        ) => Effect.Effect<A, unknown>,
      ) =>
        withDaytonaClient((daytona) => {
          const retainSandboxes = shouldRetainDaytonaSandboxes(config)
          return Effect.acquireUseRelease(
            Effect.tryPromise({
              try: () =>
                settleDaytonaPromise(
                  daytona.create(toDaytonaCreateSandboxParams(config, input), {
                    timeout: DAYTONA_DEFAULT_CREATE_TIMEOUT_SECONDS,
                  }),
                  (DAYTONA_DEFAULT_CREATE_TIMEOUT_SECONDS + 5) * 1_000,
                ),
              catch: sandboxBoundaryError(
                'daytona.createSandbox',
                'Daytona failed to create sandbox',
              ),
            }),
            (sandbox) =>
              Effect.gen(function* () {
                yield* Effect.logInfo('Created Daytona sandbox', {
                  traceId: input.traceId,
                  sandboxId: sandbox.id,
                  sandboxName: sandbox.name,
                  target: sandbox.target,
                  retainSandboxes:
                    retainSandboxes || input.retainAfterUse === true,
                })

                yield* Effect.tryPromise({
                  try: () =>
                    sandbox.waitUntilStarted(
                      DAYTONA_DEFAULT_START_TIMEOUT_SECONDS,
                    ),
                  catch: sandboxBoundaryError(
                    'daytona.waitUntilStarted',
                    'Daytona sandbox failed to start',
                  ),
                })

                yield* Effect.logInfo('Started Daytona sandbox', {
                  traceId: input.traceId,
                  sandboxId: sandbox.id,
                  state: sandbox.state,
                })
                if (input.onSandboxStarted !== undefined) {
                  yield* input.onSandboxStarted(sandbox.id)
                }
                return yield* use(sandbox, toSandboxPolicy(config, input)).pipe(
                  Effect.tap(() =>
                    Effect.logInfo('Daytona sandbox work completed', {
                      traceId: input.traceId,
                      sandboxId: sandbox.id,
                    }),
                  ),
                )
              }),
            (sandbox, exit) =>
              Effect.gen(function* () {
                const shouldRetain =
                  input.forceDeleteAfterUse !== true &&
                  (retainSandboxes ||
                    (input.retainAfterUse === true && Exit.isSuccess(exit)))
                if (shouldRetain) {
                  input.onSandboxCleanup?.('retained')
                  yield* Effect.logInfo(
                    'Retaining Daytona sandbox for inspection',
                    {
                      traceId: input.traceId,
                      sandboxId: sandbox.id,
                    },
                  )
                } else {
                  yield* Effect.logInfo('Starting Daytona sandbox cleanup', {
                    traceId: input.traceId,
                    sandboxId: sandbox.id,
                  })
                  const deleteExit = yield* deleteSandboxWithRetries({
                    daytona,
                    sandbox,
                    traceId: input.traceId,
                    timeoutSeconds: DAYTONA_DEFAULT_DELETE_TIMEOUT_SECONDS,
                    retryAttempts: DAYTONA_DEFAULT_DELETE_RETRY_ATTEMPTS,
                  }).pipe(
                    Effect.mapError(
                      sandboxBoundaryError(
                        'daytona.deleteSandbox',
                        'Daytona failed to delete sandbox',
                      ),
                    ),
                    Effect.exit,
                  )

                  const confirmationExit = yield* confirmSandboxDeleted({
                    daytona,
                    sandboxId: sandbox.id,
                    traceId: input.traceId,
                  }).pipe(Effect.exit)
                  if (Exit.isSuccess(confirmationExit)) {
                    input.onSandboxCleanup?.('deleted')
                    yield* Effect.logInfo(
                      'Confirmed Daytona sandbox deletion',
                      {
                        traceId: input.traceId,
                        sandboxId: sandbox.id,
                        deleteRequestCompleted: Exit.isSuccess(deleteExit),
                      },
                    )
                  } else {
                    input.onSandboxCleanup?.('failed')
                    yield* Effect.logWarning(
                      'Daytona sandbox deletion could not be confirmed',
                      {
                        traceId: input.traceId,
                        sandboxId: sandbox.id,
                        deleteRequestCompleted: Exit.isSuccess(deleteExit),
                      },
                    )
                  }
                }
              }),
          )
        })

      return SandboxService.of({
        runRepositoryAgent: Effect.fn(
          'DaytonaSandboxPlugin.runRepositoryAgent',
        )((input) =>
          Effect.gen(function* () {
            const clock = yield* Clock.Clock
            const startedAt = clock.currentTimeMillisUnsafe()
            const envVars = yield* piRuntimeEnvironment({
              provider: input.provider,
            }).pipe(
              Effect.mapError(
                sandboxBoundaryError(
                  'pi.config',
                  'Pi runtime provider configuration is invalid',
                ),
              ),
            )
            return yield* runWithSandbox(
              { ...input, envVars, retainAfterUse: input.mode === 'rpc' },
              (sandbox) =>
                Effect.scoped(
                  Effect.gen(function* () {
                    yield* cloneRepository(sandbox, input)
                    const baseSha = yield* captureRepositoryBaseSha(
                      sandbox,
                      input.traceId,
                    )
                    const initialCandidateStateDigest =
                      input.candidateBaseSha === undefined
                        ? undefined
                        : yield* captureCandidateStateDigest(sandbox, {
                            baseSha: input.candidateBaseSha,
                            traceId: `${input.traceId}-candidate-initial`,
                          })
                    const timeoutSeconds =
                      input.timeoutSeconds ??
                      DAYTONA_DEFAULT_COMMAND_TIMEOUT_SECONDS
                    if (input.mode === 'rpc') {
                      const command = renderShellCommand(
                        buildPiRpcCommandSpec({
                          provider: input.provider,
                          model: input.model,
                          version: DAYTONA_DEFAULT_PI_CLI_VERSION,
                          thinking: input.thinking,
                        }),
                      )
                      const handle = yield* startSandboxSessionCommand(
                        sandbox,
                        {
                          command,
                          timeoutSeconds,
                          traceId: input.traceId,
                        },
                      )
                      const observedRuntimeEventKeys = new Set<string>()
                      const confirmedRuntimeEventKeys = new Set<string>()
                      const persistRuntimeEvents = (
                        events: ReadonlyArray<PiRpcRuntimeEvent>,
                      ) => {
                        for (const event of events) {
                          observedRuntimeEventKeys.add(event.idempotencyKey)
                        }
                        if (
                          observedRuntimeEventKeys.size >
                          maximumPiRuntimeEventsPerSession
                        ) {
                          return handle.deleteSession.pipe(
                            Effect.ignore,
                            Effect.andThen(
                              Effect.fail(
                                new SandboxError({
                                  operation: 'daytona.pi.rpc.events.limit',
                                  message:
                                    'Pi RPC runtime event count exceeded its trusted bound',
                                  cause: {
                                    maximumPiRuntimeEventsPerSession,
                                  },
                                }),
                              ),
                            ),
                          )
                        }
                        const unconfirmedEvents = events.filter(
                          (event) =>
                            !confirmedRuntimeEventKeys.has(
                              event.idempotencyKey,
                            ),
                        )
                        if (
                          unconfirmedEvents.length === 0 ||
                          input.onRuntimeEvents === undefined
                        ) {
                          return Effect.void
                        }
                        return input.onRuntimeEvents(unconfirmedEvents).pipe(
                          Effect.tap(() =>
                            Effect.sync(() => {
                              for (const event of unconfirmedEvents) {
                                confirmedRuntimeEventKeys.add(
                                  event.idempotencyKey,
                                )
                              }
                            }),
                          ),
                          Effect.catch((error) =>
                            Effect.logWarning(
                              'Failed to persist incremental Pi RPC runtime events',
                              {
                                traceId: input.traceId,
                                error: String(error),
                              },
                            ),
                          ),
                        )
                      }

                      const pi = makePiRuntimeSession({
                        sessionId: handle.sessionId,
                        commandId: handle.commandId,
                        sendInput: handle.sendInput,
                        now: () => clock.currentTimeMillisUnsafe(),
                        stdout: streamSandboxSessionCommandLogs(
                          sandbox,
                          handle.sessionId,
                          handle.commandId,
                          maxVerificationCommandOutputBytes,
                        ).pipe(
                          Stream.filter((chunk) => chunk.stream === 'stdout'),
                          Stream.map((chunk) => chunk.chunk),
                        ),
                      })

                      yield* pi.events.pipe(
                        Stream.runForEach((event) =>
                          persistRuntimeEvents([event]),
                        ),
                        Effect.tapError((error) =>
                          handle.deleteSession.pipe(
                            Effect.ignore,
                            Effect.andThen(
                              Effect.logWarning(
                                'Pi RPC log stream ended with error; terminated session before bounded reconciliation',
                                {
                                  traceId: input.traceId,
                                  error: error.message,
                                },
                              ),
                            ),
                          ),
                        ),
                        Effect.ignore,
                        Effect.andThen(
                          Effect.gen(function* () {
                            const reconcileLogs = yield* handle
                              .getLogs(maxVerificationCommandOutputBytes)
                              .pipe(
                                Effect.orElseSucceed(() => ({ stdout: '' })),
                              )
                            const reconciledEvents = yield* Stream.make(
                              reconcileLogs.stdout,
                            ).pipe(
                              decodePiRpcRuntimeEvents({
                                sessionId: handle.sessionId,
                                commandId: handle.commandId,
                                stream: 'stdout',
                                now: () => clock.currentTimeMillisUnsafe(),
                              }),
                              Stream.take(maximumPiRuntimeEventsPerSession + 1),
                              Stream.runCollect,
                              Effect.map((events) => Array.from(events)),
                            )
                            yield* persistRuntimeEvents(reconciledEvents)
                          }),
                        ),
                        Effect.forkScoped,
                      )

                      yield* sendPiCommand(
                        pi.getState({ id: `${input.traceId}:get-state` }),
                      )
                      yield* sendPiCommand(
                        pi.prompt({
                          id: `${input.traceId}:prompt`,
                          message: input.prompt,
                        }),
                      )
                      if (input.onRuntimeSessionStarted !== undefined) {
                        yield* input.onRuntimeSessionStarted({
                          provider: 'daytona:pi-rpc',
                          sandboxId: sandbox.id,
                          sessionId: handle.sessionId,
                          commandId: handle.commandId,
                          startedAt,
                        })
                      }
                      const logs = yield* handle.getLogs(
                        maxVerificationCommandOutputBytes,
                      )
                      const commandStatus = yield* handle.getCommand
                      const parsedRuntimeEvents = yield* Stream.make(
                        logs.stdout,
                      ).pipe(
                        decodePiRpcRuntimeEvents({
                          sessionId: handle.sessionId,
                          commandId: handle.commandId,
                          stream: 'stdout',
                          now: () => clock.currentTimeMillisUnsafe(),
                        }),
                        Stream.take(maximumPiRuntimeEventsPerSession + 1),
                        Stream.runCollect,
                        Effect.map((events) => Array.from(events)),
                      )
                      if (
                        parsedRuntimeEvents.length >
                        maximumPiRuntimeEventsPerSession
                      ) {
                        yield* handle.deleteSession.pipe(Effect.ignore)
                        return yield* new SandboxError({
                          operation: 'daytona.pi.rpc.events.snapshotLimit',
                          message:
                            'Pi RPC runtime event snapshot exceeded its trusted bound',
                          cause: { maximumPiRuntimeEventsPerSession },
                        })
                      }
                      if (input.onRuntimeEvents !== undefined) {
                        const unconfirmedSnapshotEvents =
                          parsedRuntimeEvents.filter(
                            (event) =>
                              !confirmedRuntimeEventKeys.has(
                                event.idempotencyKey,
                              ),
                          )
                        if (unconfirmedSnapshotEvents.length > 0) {
                          yield* input
                            .onRuntimeEvents(unconfirmedSnapshotEvents)
                            .pipe(
                              Effect.mapError(
                                (cause) =>
                                  new SandboxError({
                                    operation:
                                      'daytona.pi.rpc.events.finalPersistence',
                                    message:
                                      'Pi RPC final runtime event persistence failed',
                                    cause,
                                  }),
                              ),
                            )
                        }
                      }
                      const projectedTranscript =
                        projectPiRuntimeTranscript(parsedRuntimeEvents)
                      const {
                        artifacts: evidenceArtifacts,
                        verificationResults,
                        candidateStateDigest,
                      } = yield* collectSandboxEvidenceArtifacts(sandbox, {
                        ...input,
                        candidateBaseSha: input.candidateBaseSha ?? baseSha,
                      })

                      return {
                        provider: 'daytona:pi-rpc',
                        sandboxId: sandbox.id,
                        sessionId: handle.sessionId,
                        commandId: handle.commandId,
                        command: renderShellCommand(
                          buildPiRpcCommandSpec({
                            provider: input.provider,
                            model: input.model,
                            version: DAYTONA_DEFAULT_PI_CLI_VERSION,
                            thinking: input.thinking,
                          }),
                        ),
                        exitCode: commandStatus.exitCode,
                        stdout: projectedTranscript,
                        stderr: '',
                        policy: toSandboxPolicy(config, { timeoutSeconds }),
                        runtimeEvents: parsedRuntimeEvents,
                        evidenceArtifacts,
                        verificationResults,
                        candidateStateDigest,
                        ...(initialCandidateStateDigest === undefined
                          ? {}
                          : { initialCandidateStateDigest }),
                        baseSha,
                        startedAt,
                        completedAt: yield* Clock.currentTimeMillis,
                      }
                    }

                    const command = renderShellCommand(
                      buildPiCommandSpec({
                        provider: input.provider,
                        model: input.model,
                        prompt: input.prompt,
                        version: DAYTONA_DEFAULT_PI_CLI_VERSION,
                        thinking: input.thinking,
                      }),
                    )
                    const response = yield* executeSandboxCommand(sandbox, {
                      command,
                      timeoutSeconds,
                      traceId: input.traceId,
                      maxOutputBytes: maxVerificationCommandOutputBytes,
                    })
                    const parsedRuntimeEvents =
                      yield* parsePiJsonRuntimeEventsEffect(response.stdout, {
                        now: () => clock.currentTimeMillisUnsafe(),
                      })

                    if (parsedRuntimeEvents.lineLimitExceeded) {
                      return yield* new SandboxError({
                        operation: 'daytona.pi.json.events.lineLimit',
                        message:
                          'Pi JSON event transcript exceeded its trusted line bound',
                        cause: { maximumLines: 1_000 },
                      })
                    }

                    if (parsedRuntimeEvents.parseErrors.length > 0) {
                      yield* Effect.logWarning(
                        'Pi JSON event parsing skipped malformed output lines',
                        {
                          traceId: input.traceId,
                          sandboxId: sandbox.id,
                          parseErrors: parsedRuntimeEvents.parseErrors,
                        },
                      )
                    }
                    const {
                      artifacts: evidenceArtifacts,
                      verificationResults,
                      candidateStateDigest,
                    } = yield* collectSandboxEvidenceArtifacts(sandbox, {
                      ...input,
                      candidateBaseSha: input.candidateBaseSha ?? baseSha,
                    })

                    return {
                      provider: 'daytona:pi',
                      sandboxId: sandbox.id,
                      command: renderShellCommand(
                        buildRedactedPiCommandSpec({
                          provider: input.provider,
                          model: input.model,
                          version: DAYTONA_DEFAULT_PI_CLI_VERSION,
                          thinking: input.thinking,
                        }),
                      ),
                      exitCode: response.exitCode,
                      stdout: projectPiRuntimeTranscript(
                        parsedRuntimeEvents.events,
                      ),
                      stderr: '',
                      policy: toSandboxPolicy(config, { timeoutSeconds }),
                      runtimeEvents: parsedRuntimeEvents.events,
                      evidenceArtifacts,
                      verificationResults,
                      candidateStateDigest,
                      ...(initialCandidateStateDigest === undefined
                        ? {}
                        : { initialCandidateStateDigest }),
                      baseSha,
                      startedAt,
                      completedAt: yield* Clock.currentTimeMillis,
                    }
                  }),
                ),
            )
          }).pipe(
            Effect.mapError(
              (cause) =>
                new SandboxError({
                  operation: 'daytona.runRepositoryAgent',
                  message:
                    'Daytona failed to run Pi agent in repository sandbox',
                  cause,
                }),
            ),
          ),
        ),
        abortRuntimeSession: Effect.fn(
          'DaytonaSandboxPlugin.abortRuntimeSession',
        )((input) =>
          withDaytonaClient((daytona) =>
            Effect.gen(function* () {
              const sandbox = yield* Effect.tryPromise({
                try: () =>
                  daytona.get?.(input.sandboxId) ??
                  Promise.reject(new Error('Daytona get is unavailable')),
                catch: sandboxBoundaryError(
                  'daytona.getSandbox',
                  'Daytona failed to get sandbox for runtime abort',
                ),
              })
              const pi = makePiRpcCommandSender({
                sendInput: (data) =>
                  Effect.tryPromise({
                    try: () =>
                      sandbox.process.sendSessionCommandInput?.(
                        input.sessionId,
                        input.commandId,
                        data,
                      ) ??
                      Promise.reject(
                        new Error(
                          'Daytona sendSessionCommandInput is unavailable',
                        ),
                      ),
                    catch: sandboxBoundaryError(
                      'daytona.sendSessionCommandInput',
                      'Daytona failed to send abort to runtime session',
                    ),
                  }),
              })
              yield* pi
                .abort({ id: `${input.traceId}:abort` })
                .pipe(
                  Effect.mapError(
                    sandboxBoundaryError(
                      'daytona.pi.rpc.abort',
                      'Daytona failed to send abort to runtime session',
                    ),
                  ),
                )
              return {
                provider: 'daytona:pi-rpc',
                sandboxId: input.sandboxId,
                sessionId: input.sessionId,
                commandId: input.commandId,
                status: 'sent' as const,
              }
            }),
          ),
        ),
        steerRuntimeSession: Effect.fn(
          'DaytonaSandboxPlugin.steerRuntimeSession',
        )((input) =>
          withDaytonaClient((daytona) =>
            Effect.gen(function* () {
              const sandbox = yield* Effect.tryPromise({
                try: () =>
                  daytona.get?.(input.sandboxId) ??
                  Promise.reject(new Error('Daytona get is unavailable')),
                catch: sandboxBoundaryError(
                  'daytona.getSandbox',
                  'Daytona failed to get sandbox for runtime steering',
                ),
              })
              const pi = makePiRpcCommandSender({
                sendInput: (data) =>
                  Effect.tryPromise({
                    try: () =>
                      sandbox.process.sendSessionCommandInput?.(
                        input.sessionId,
                        input.commandId,
                        data,
                      ) ??
                      Promise.reject(
                        new Error(
                          'Daytona sendSessionCommandInput is unavailable',
                        ),
                      ),
                    catch: sandboxBoundaryError(
                      'daytona.sendSessionCommandInput',
                      'Daytona failed to send steering to runtime session',
                    ),
                  }),
              })
              yield* pi
                .steer({ id: `${input.traceId}:steer`, message: input.message })
                .pipe(
                  Effect.mapError(
                    sandboxBoundaryError(
                      'daytona.pi.rpc.steer',
                      'Daytona failed to send steering to runtime session',
                    ),
                  ),
                )
              return {
                provider: 'daytona:pi-rpc',
                sandboxId: input.sandboxId,
                sessionId: input.sessionId,
                commandId: input.commandId,
                status: 'sent' as const,
              }
            }),
          ),
        ),
        followUpRuntimeSession: Effect.fn(
          'DaytonaSandboxPlugin.followUpRuntimeSession',
        )((input) =>
          withDaytonaClient((daytona) =>
            Effect.gen(function* () {
              const sandbox = yield* Effect.tryPromise({
                try: () =>
                  daytona.get?.(input.sandboxId) ??
                  Promise.reject(new Error('Daytona get is unavailable')),
                catch: sandboxBoundaryError(
                  'daytona.getSandbox',
                  'Daytona failed to get sandbox for runtime follow-up',
                ),
              })
              const pi = makePiRpcCommandSender({
                sendInput: (data) =>
                  Effect.tryPromise({
                    try: () =>
                      sandbox.process.sendSessionCommandInput?.(
                        input.sessionId,
                        input.commandId,
                        data,
                      ) ??
                      Promise.reject(
                        new Error(
                          'Daytona sendSessionCommandInput is unavailable',
                        ),
                      ),
                    catch: sandboxBoundaryError(
                      'daytona.sendSessionCommandInput',
                      'Daytona failed to send follow-up to runtime session',
                    ),
                  }),
              })
              yield* pi
                .followUp({
                  id: `${input.traceId}:follow-up`,
                  message: input.message,
                })
                .pipe(
                  Effect.mapError(
                    sandboxBoundaryError(
                      'daytona.pi.rpc.followUp',
                      'Daytona failed to send follow-up to runtime session',
                    ),
                  ),
                )
              return {
                provider: 'daytona:pi-rpc',
                sandboxId: input.sandboxId,
                sessionId: input.sessionId,
                commandId: input.commandId,
                status: 'sent' as const,
              }
            }),
          ),
        ),
        terminateRuntimeSession: Effect.fn(
          'DaytonaSandboxPlugin.terminateRuntimeSession',
        )((input) =>
          withDaytonaClient((daytona) =>
            Effect.gen(function* () {
              const sandbox = yield* Effect.tryPromise({
                try: () =>
                  daytona.get?.(input.sandboxId) ??
                  Promise.reject(new Error('Daytona get is unavailable')),
                catch: sandboxBoundaryError(
                  'daytona.getSandbox',
                  'Daytona failed to get sandbox for runtime termination',
                ),
              })
              yield* Effect.raceFirst(
                Effect.tryPromise({
                  try: async () => {
                    try {
                      await sandbox.process.deleteSession(input.sessionId)
                    } catch (cause) {
                      if (!isDaytonaNotFoundCause(cause)) throw cause
                    }
                  },
                  catch: sandboxBoundaryError(
                    'daytona.deleteSession',
                    'Daytona failed to terminate runtime session',
                  ),
                }),
                Effect.sleep('5 seconds').pipe(
                  Effect.andThen(
                    Effect.fail(
                      new SandboxError({
                        operation: 'daytona.deleteSession.timeout',
                        message:
                          'Daytona runtime session termination timed out',
                        cause: undefined,
                      }),
                    ),
                  ),
                ),
              )
              return {
                provider: 'daytona:pi-rpc',
                sandboxId: input.sandboxId,
                sessionId: input.sessionId,
                commandId: input.commandId,
                status: 'terminated' as const,
              }
            }),
          ),
        ),
        runRepositoryCommand: Effect.fn(
          'DaytonaSandboxPlugin.runRepositoryCommand',
        )((input) =>
          Effect.gen(function* () {
            const startedAt = yield* Clock.currentTimeMillis
            let cleanupStatus:
              | 'not-started'
              | 'deleted'
              | 'failed'
              | 'retained' = 'not-started'
            const result = yield* runWithSandbox(
              {
                ...input,
                envVars: input.env === undefined ? undefined : { ...input.env },
                forceDeleteAfterUse: input.forceDeleteAfterUse,
                timeoutSeconds: input.timeoutSeconds,
                onSandboxCleanup: (status) => {
                  cleanupStatus = status
                },
              },
              (sandbox, requestedPolicy) =>
                Effect.gen(function* () {
                  yield* cloneRepository(sandbox, input)
                  const effectivePolicy =
                    input.verificationInvocation === undefined
                      ? requestedPolicy
                      : yield* readEffectiveSandboxPolicy(
                          config,
                          sandbox,
                          input,
                        )
                  const policyEnvironment: unknown =
                    'environment' in effectivePolicy
                      ? effectivePolicy.environment
                      : undefined
                  const observedArchitecture =
                    typeof policyEnvironment === 'object' &&
                    policyEnvironment !== null &&
                    'architecture' in policyEnvironment &&
                    typeof policyEnvironment.architecture === 'string'
                      ? policyEnvironment.architecture
                      : undefined
                  const initialCandidateState =
                    input.verificationInvocation !== undefined &&
                    input.candidateBaseSha !== undefined
                      ? yield* captureInitialCandidateState(sandbox, {
                          baseSha: input.candidateBaseSha,
                          traceId: `${input.traceId}-candidate-initial`,
                        })
                      : undefined
                  const baseSha =
                    initialCandidateState?.baseSha ??
                    (yield* captureRepositoryBaseSha(sandbox, input.traceId))
                  const initialCandidateStateDigest =
                    initialCandidateState?.candidateStateDigest ??
                    (input.verificationInvocation !== undefined ||
                    input.candidateBaseSha === undefined
                      ? undefined
                      : yield* captureCandidateStateDigest(sandbox, {
                          baseSha: input.candidateBaseSha,
                          traceId: `${input.traceId}-candidate-initial`,
                        }))
                  if (input.verificationInvocation !== undefined) {
                    yield* prepareProtectedVerificationSandbox(
                      sandbox,
                      input.traceId,
                    )
                  }
                  const command =
                    input.command.trim().length === 0
                      ? DAYTONA_DEFAULT_COMMAND
                      : input.command
                  const timeoutSeconds =
                    input.timeoutSeconds ??
                    DAYTONA_DEFAULT_COMMAND_TIMEOUT_SECONDS
                  const response =
                    input.verificationInvocation === undefined
                      ? yield* executeSandboxCommand(sandbox, {
                          command,
                          timeoutSeconds,
                          traceId: input.traceId,
                        })
                      : undefined
                  const {
                    artifacts: evidenceArtifacts,
                    verificationResults,
                    candidateStateDigest,
                    repositoryHeadAfter,
                    invocationCommandResult,
                    protectedExecution,
                  } = yield* collectSandboxEvidenceArtifacts(sandbox, {
                    ...input,
                    candidateBaseSha: input.candidateBaseSha ?? baseSha,
                    ...(observedArchitecture === undefined
                      ? {}
                      : { observedArchitecture }),
                  })
                  const executed = invocationCommandResult ?? response
                  const persistedPolicy =
                    protectedExecution === undefined
                      ? effectivePolicy
                      : { ...effectivePolicy, protectedExecution }
                  const executedCommand =
                    input.verificationInvocation?.command ?? command

                  return {
                    provider: 'daytona',
                    sandboxId: sandbox.id,
                    ...(invocationCommandResult === undefined
                      ? {}
                      : {
                          sessionId: invocationCommandResult.sessionId,
                          commandId: invocationCommandResult.commandId,
                        }),
                    command: executedCommand,
                    exitCode: executed?.exitCode,
                    stdout: executed?.stdout ?? '',
                    stderr: executed?.stderr,
                    policy: persistedPolicy,
                    evidenceArtifacts,
                    verificationResults,
                    candidateStateDigest,
                    ...(initialCandidateStateDigest === undefined
                      ? {}
                      : { initialCandidateStateDigest }),
                    repositoryHeadBefore: baseSha,
                    ...(repositoryHeadAfter === undefined
                      ? {}
                      : { repositoryHeadAfter }),
                    baseSha,
                    startedAt,
                    completedAt: yield* Clock.currentTimeMillis,
                  }
                }),
            )
            yield* Effect.logInfo(
              'Daytona repository command lifecycle returned',
              {
                traceId: input.traceId,
                sandboxId: result.sandboxId,
                cleanupStatus,
              },
            )
            return { ...result, cleanupStatus }
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
