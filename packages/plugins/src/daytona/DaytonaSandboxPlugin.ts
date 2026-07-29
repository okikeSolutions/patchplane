import {
  Clock,
  Config,
  Effect,
  Exit,
  Layer,
  Option,
  Result,
  Schedule,
  Schema,
  Stream,
} from 'effect'
import { Daytona } from '@daytona/sdk'
import { XMLValidator } from 'fast-xml-parser'
import { PNG } from 'pngjs'
import { SandboxError } from '@patchplane/domain/errors'
import { EffectiveSandboxPolicy } from '@patchplane/domain/sandbox-environment'
import {
  SandboxService,
  type SandboxCommandInput,
  type SandboxCommandResult,
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
import {
  executeSandboxCommand,
  startSandboxSessionCommand,
  streamSandboxSessionCommandLogs,
  waitForSandboxSessionCommand,
} from './daytona-process'
import { sanitizeDaytonaCause } from './daytona-redaction'
import { shellQuote } from './daytona-shell'
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

const evidenceCaptureTimeoutSeconds = 30
const maxEvidenceArtifactBytes = 5_000_000
const maxVerificationCommandOutputBytes = 2 * 1024 * 1024
const maxCandidateDiffBytes = 10_000_000
const textArtifactMarker = '\n---PATCHPLANE_ARTIFACT_BODY---\n'
const binaryArtifactMarker = '\n---PATCHPLANE_ARTIFACT_BODY_BASE64---\n'

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

function isDaytonaNotFoundCause(cause: unknown): boolean {
  if (typeof cause !== 'object' || cause === null) return false
  const value = cause as {
    readonly name?: unknown
    readonly statusCode?: unknown
    readonly errorCode?: unknown
  }
  return (
    value.statusCode === 404 &&
    (value.name === 'DaytonaNotFoundError' || value.errorCode === 'NOT_FOUND')
  )
}

export async function settleDaytonaPromise<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('Daytona operation deadline exceeded')),
          timeoutMs,
        )
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function sandboxBoundaryError(operation: string, message: string) {
  return (cause: unknown) =>
    new SandboxError({
      operation,
      message,
      cause: sanitizeDaytonaCause(cause),
    })
}

const readEffectiveSandboxPolicy = Effect.fnUntraced(function* (
  config: DaytonaConfig,
  sandbox: DaytonaSandboxLike,
  input: {
    readonly timeoutSeconds?: number | undefined
    readonly traceId: string
  },
) {
  yield* Effect.raceFirst(
    Effect.tryPromise({
      try: () => sandbox.refreshData(),
      catch: sandboxBoundaryError(
        'daytona.refreshSandbox',
        'Daytona failed to read back the effective sandbox environment',
      ),
    }),
    Effect.sleep('10 seconds').pipe(
      Effect.andThen(
        Effect.fail(
          new SandboxError({
            operation: 'daytona.refreshSandbox.timeout',
            message: 'Daytona effective environment readback timed out',
            cause: undefined,
          }),
        ),
      ),
    ),
  )
  const system = yield* executeSandboxCommand(sandbox, {
    command: 'uname -s && uname -m',
    timeoutSeconds: evidenceCaptureTimeoutSeconds,
    traceId: `${input.traceId}-environment`,
    stateless: true,
  })
  const [operatingSystem, architecture] = system.stdout.trim().split(/\r?\n/u)
  const requested = toSandboxPolicy(config, input)
  const image = (sandbox.buildInfo?.snapshotRef ?? sandbox.snapshot)?.trim()
  const target = sandbox.target?.trim()
  const state = sandbox.state?.trim()
  const resources = {
    cpu: sandbox.cpu,
    memoryGb: sandbox.memory,
    diskGb: sandbox.disk,
  }
  const valid =
    system.exitCode === 0 &&
    operatingSystem === 'Linux' &&
    typeof architecture === 'string' &&
    architecture.length > 0 &&
    architecture.length <= 128 &&
    image !== undefined &&
    image.length > 0 &&
    image.length <= 512 &&
    target !== undefined &&
    target.length > 0 &&
    target.length <= 256 &&
    state === 'started' &&
    sandbox.public === false &&
    sandbox.linkedSandboxId === undefined &&
    Array.isArray(sandbox.volumes) &&
    sandbox.volumes.length === 0 &&
    Number.isFinite(resources.cpu) &&
    Number(resources.cpu) > 0 &&
    Number.isFinite(resources.memoryGb) &&
    Number(resources.memoryGb) > 0 &&
    Number.isFinite(resources.diskGb) &&
    Number(resources.diskGb) > 0 &&
    sandbox.autoStopInterval === requested.lifecycle.autoStopMinutes &&
    (sandbox.autoArchiveInterval === requested.lifecycle.autoArchiveMinutes ||
      (requested.lifecycle.autoArchiveMinutes === 0 &&
        (sandbox.autoArchiveInterval === undefined ||
          sandbox.autoArchiveInterval === null))) &&
    sandbox.autoDeleteInterval === requested.lifecycle.autoDeleteMinutes &&
    (requested.network.blockAll === undefined ||
      sandbox.networkBlockAll === requested.network.blockAll) &&
    (requested.network.allowList === undefined ||
      sandbox.networkAllowList === requested.network.allowList) &&
    (requested.resources.cpu === undefined ||
      sandbox.cpu === requested.resources.cpu) &&
    (requested.resources.memoryGb === undefined ||
      sandbox.memory === requested.resources.memoryGb) &&
    (requested.resources.diskGb === undefined ||
      sandbox.disk === requested.resources.diskGb)
  if (!valid) {
    return yield* new SandboxError({
      operation: 'daytona.validateSandboxEnvironment',
      message:
        'Daytona effective sandbox environment did not match the trusted request',
      cause: {
        sandboxId: sandbox.id,
        stateMatched: state === 'started',
        hasBoundedImage:
          image !== undefined && image.length > 0 && image.length <= 512,
        hasBoundedTarget:
          target !== undefined && target.length > 0 && target.length <= 256,
        public: sandbox.public,
        linked: sandbox.linkedSandboxId !== undefined,
        volumeCount: Array.isArray(sandbox.volumes)
          ? sandbox.volumes.length
          : undefined,
        autoStopMatched:
          sandbox.autoStopInterval === requested.lifecycle.autoStopMinutes,
        autoArchiveInterval: sandbox.autoArchiveInterval,
        autoArchiveMatched:
          sandbox.autoArchiveInterval ===
            requested.lifecycle.autoArchiveMinutes ||
          (requested.lifecycle.autoArchiveMinutes === 0 &&
            (sandbox.autoArchiveInterval === undefined ||
              sandbox.autoArchiveInterval === null)),
        autoDeleteMatched:
          sandbox.autoDeleteInterval === requested.lifecycle.autoDeleteMinutes,
        networkBlockMatched:
          requested.network.blockAll === undefined ||
          sandbox.networkBlockAll === requested.network.blockAll,
        networkAllowListMatched:
          requested.network.allowList === undefined ||
          sandbox.networkAllowList === requested.network.allowList,
        resourcesMatched:
          (requested.resources.cpu === undefined ||
            sandbox.cpu === requested.resources.cpu) &&
          (requested.resources.memoryGb === undefined ||
            sandbox.memory === requested.resources.memoryGb) &&
          (requested.resources.diskGb === undefined ||
            sandbox.disk === requested.resources.diskGb),
        exitCode: system.exitCode,
      },
    })
  }
  const normalized = {
    ...requested,
    lifecycle: {
      ephemeral: requested.lifecycle.ephemeral,
      retainAfterRun: requested.lifecycle.retainAfterRun,
      ...(sandbox.autoStopInterval === undefined
        ? {}
        : { autoStopMinutes: sandbox.autoStopInterval }),
      ...(sandbox.autoArchiveInterval === undefined ||
      sandbox.autoArchiveInterval === null
        ? {}
        : { autoArchiveMinutes: sandbox.autoArchiveInterval }),
      ...(sandbox.autoDeleteInterval === undefined
        ? {}
        : { autoDeleteMinutes: sandbox.autoDeleteInterval }),
    },
    network: {
      ...(sandbox.networkBlockAll === undefined ||
      sandbox.networkBlockAll === null
        ? {}
        : { blockAll: sandbox.networkBlockAll }),
      ...(sandbox.networkAllowList === undefined ||
      sandbox.networkAllowList === null
        ? {}
        : { allowList: sandbox.networkAllowList }),
    },
    resources: resources as { cpu: number; memoryGb: number; diskGb: number },
    environment: {
      sandboxClass: 'linux-container',
      sandboxClassSource: 'trusted-request' as const,
      operatingSystem,
      architecture,
      image,
      target,
      providerState: state,
      public: false,
      linked: false,
      volumeCount: 0,
      observedAt: yield* Clock.currentTimeMillis,
    },
  }
  return yield* Schema.decodeUnknownEffect(EffectiveSandboxPolicy)(
    normalized,
  ).pipe(
    Effect.mapError(
      sandboxBoundaryError(
        'daytona.decodeSandboxEnvironment',
        'Daytona effective sandbox environment was outside PatchPlane bounds',
      ),
    ),
  )
})

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
    try: () =>
      settleDaytonaPromise(
        input.daytona.delete(input.sandbox, input.timeoutSeconds),
        (input.timeoutSeconds + 5) * 1_000,
      ),
    catch: (cause) => ({ cause, attempt: ++attempt }),
  }).pipe(
    Effect.catch((error) =>
      isDaytonaNotFoundCause(error.cause) ? Effect.void : Effect.fail(error),
    ),
    Effect.tapError(({ cause, attempt: loggedAttempt }) =>
      Effect.logWarning('Failed to delete Daytona sandbox', {
        traceId: input.traceId,
        sandboxId: input.sandbox.id,
        attempt: loggedAttempt,
        totalAttempts: totalRetries + 1,
        cause: sanitizeDaytonaCause(cause),
      }),
    ),
    Effect.mapError(({ cause }) => cause),
    Effect.retry(Schedule.recurs(totalRetries)),
  )
}

const confirmSandboxDeleted = Effect.fnUntraced(function* (input: {
  readonly daytona: DaytonaClientLike
  readonly sandboxId: string
  readonly traceId: string
}) {
  const cleanupDeadline = Date.now() + 120_000
  let consecutiveReadFailures = 0
  for (let attempt = 1; attempt <= 120; attempt += 1) {
    const remainingMs = cleanupDeadline - Date.now()
    if (remainingMs <= 0) break
    const readback = yield* Effect.raceFirst(
      Effect.tryPromise({
        try: () => input.daytona.get(input.sandboxId),
        catch: (cause) => ({ cause }),
      }),
      Effect.sleep(Math.min(5_000, remainingMs)).pipe(
        Effect.andThen(
          Effect.fail({
            cause: new SandboxError({
              operation: 'daytona.confirmSandboxDeleted.timeout',
              message: 'Daytona sandbox deletion readback timed out',
              cause: undefined,
            }),
          }),
        ),
      ),
    ).pipe(Effect.result)
    if (Result.isFailure(readback)) {
      if (isDaytonaNotFoundCause(readback.failure.cause)) return
      consecutiveReadFailures += 1
      if (consecutiveReadFailures < 3) continue
      return yield* new SandboxError({
        operation: 'daytona.confirmSandboxDeleted',
        message: 'Daytona sandbox deletion readback failed after retries',
        cause: sanitizeDaytonaCause(readback.failure.cause),
      })
    }
    consecutiveReadFailures = 0
    if (attempt < 120) {
      const sleepMs = Math.min(1_000, cleanupDeadline - Date.now())
      if (sleepMs > 0) yield* Effect.sleep(sleepMs)
    }
  }
  return yield* new SandboxError({
    operation: 'daytona.confirmSandboxDeleted',
    message:
      'Daytona sandbox still existed after the deletion confirmation deadline',
    cause: { sandboxId: input.sandboxId, traceId: input.traceId },
  })
})

function makeDefaultDaytonaClient(config: DaytonaConfig): DaytonaClientLike {
  const daytona = new Daytona(toDaytonaClientConfig(config))
  return {
    create: (params, options) => daytona.create(params, options),
    delete: (sandbox, timeout) => sandbox.delete(timeout),
    get: (sandboxIdOrName) => daytona.get(sandboxIdOrName),
    [Symbol.asyncDispose]: () =>
      daytona[Symbol.asyncDispose]?.() ?? Promise.resolve(),
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
  const encoded = stdout
    .slice(markerIndex + binaryArtifactMarker.length)
    .replace(/\s+/g, '')
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

const TestReportJson = Schema.fromJsonString(
  Schema.Union([
    Schema.Struct({ ok: Schema.Boolean }),
    Schema.Struct({
      numTotalTests: Schema.Finite.check(Schema.isGreaterThan(0)),
      numFailedTests: Schema.Literal(0),
    }),
    Schema.Struct({
      failed: Schema.Literal(0),
      passed: Schema.Finite.check(Schema.isGreaterThan(0)),
    }),
  ]),
)
const decodeTestReportJson = Schema.decodeUnknownOption(TestReportJson)

function isValidTestReport(path: string, body: string) {
  if (path.endsWith('.xml')) {
    if (XMLValidator.validate(body) !== true) return false
    const root = body.match(/<testsuites?\b([^>]*)>/i)
    const tests = root?.[1]?.match(/\btests=["'](\d+)["']/i)?.[1]
    const failures = root?.[1]?.match(/\bfailures=["'](\d+)["']/i)?.[1] ?? '0'
    const errors = root?.[1]?.match(/\berrors=["'](\d+)["']/i)?.[1] ?? '0'
    return (
      root !== null &&
      Number(tests) > 0 &&
      Number(failures) === 0 &&
      Number(errors) === 0
    )
  }
  const decoded = decodeTestReportJson(body)
  if (Option.isNone(decoded)) return false
  const value = decoded.value
  if ('ok' in value) return value.ok
  if ('numTotalTests' in value) return value.numFailedTests === 0
  return value.failed === 0
}

function isValidPng(body: Uint8Array) {
  try {
    const image = PNG.sync.read(Buffer.from(body), { checkCRC: true })
    return image.width > 0 && image.height > 0
  } catch {
    return false
  }
}

function testReportProbeCommand() {
  const paths = [
    '.patchplane/test-report.json',
    '.patchplane/test-report.xml',
    'patchplane-test-report.json',
    'patchplane-test-report.xml',
    'test-results/junit.xml',
    'junit.xml',
  ]
  const script = [
    'const fs=require("fs");',
    `const paths=${JSON.stringify(paths)};`,
    `const limit=${maxEvidenceArtifactBytes};`,
    'for(const path of paths){let fd;try{fd=fs.openSync(path,"r");const size=fs.fstatSync(fd).size;if(size<=0||size>limit)continue;',
    'const body=Buffer.alloc(size);const read=fs.readSync(fd,body,0,size,0);if(read!==size)continue;',
    `process.stdout.write(path+${JSON.stringify(textArtifactMarker)}+body);break;`,
    '}catch{}finally{if(fd!==undefined)fs.closeSync(fd);}}',
  ].join('')
  return `node -e '${script}'`
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
    `const limit=${maxEvidenceArtifactBytes};`,
    'for(const path of paths){let fd;try{fd=fs.openSync(path,"r");const size=fs.fstatSync(fd).size;if(size<=0||size>limit)continue;',
    'const body=Buffer.alloc(size);const read=fs.readSync(fd,body,0,size,0);if(read!==size)continue;',
    `process.stdout.write(path+${JSON.stringify(binaryArtifactMarker)}+body.toString("base64"));break;`,
    '}catch{}finally{if(fd!==undefined)fs.closeSync(fd);}}',
  ].join('')
  return `node -e '${script}'`
}

const captureRepositoryBaseSha = Effect.fnUntraced(function* (
  sandbox: DaytonaSandboxLike,
  traceId: string,
) {
  const result = yield* executeSandboxCommand(sandbox, {
    command: 'git rev-parse HEAD',
    timeoutSeconds: evidenceCaptureTimeoutSeconds,
    traceId: `${traceId}-base-sha`,
    stateless: true,
  })
  const baseSha = result.stdout.trim()
  if (
    result.exitCode !== 0 ||
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(baseSha)
  ) {
    return yield* new SandboxError({
      operation: 'daytona.captureRepositoryBaseSha',
      message:
        'Daytona could not determine the repository base commit for evidence capture',
      cause: { exitCode: result.exitCode, stderr: result.stderr },
    })
  }
  return baseSha
})

const evidenceOutputPathspecExclusions = [
  ':(exclude).patchplane/**',
  ':(exclude)patchplane-test-report.json',
  ':(exclude)patchplane-test-report.xml',
  ':(exclude)test-results/junit.xml',
  ':(exclude)junit.xml',
  ':(exclude)coverage/coverage-final.json',
  ':(exclude)patchplane-browser-screenshot.png',
  ':(exclude)test-results/browser-screenshot.png',
  ':(exclude)playwright-report/browser-screenshot.png',
]
  .map(shellQuote)
  .join(' ')

const captureCandidateStateDigest = Effect.fnUntraced(function* (
  sandbox: DaytonaSandboxLike,
  input: { readonly baseSha: string; readonly traceId: string },
) {
  const result = yield* executeSandboxCommand(sandbox, {
    command: `git add -N . ${evidenceOutputPathspecExclusions} >/dev/null 2>&1 || true; git diff --binary --no-ext-diff ${shellQuote(input.baseSha)} -- . | sha256sum`,
    timeoutSeconds: evidenceCaptureTimeoutSeconds,
    traceId: input.traceId,
    stateless: true,
  })
  const digest = result.stdout.trim().split(/\s+/, 1)[0]
  return result.exitCode === 0 &&
    digest !== undefined &&
    /^[0-9a-f]{64}$/i.test(digest)
    ? `sha256:${digest.toLowerCase()}`
    : undefined
})

const collectSandboxEvidenceArtifacts = Effect.fnUntraced(function* (
  sandbox: DaytonaSandboxLike,
  input: {
    readonly traceId: string
    readonly candidateBaseSha: string
    readonly verificationInvocation?:
      | {
          readonly requirementKey: string
          readonly kind: SandboxVerificationResult['kind']
          readonly command: string
          readonly platform: 'linux' | 'windows' | 'macos'
          readonly architecture?: string | undefined
          readonly timeoutSeconds: number
          readonly requiredArtifactKinds: ReadonlyArray<
            SandboxEvidenceArtifact['kind']
          >
        }
      | undefined
    readonly evidenceTestReportCommand?: string | undefined
    readonly evidenceTestTimeoutSeconds?: number | undefined
    readonly evidenceBrowserScreenshotCommand?: string | undefined
    readonly evidenceBrowserTimeoutSeconds?: number | undefined
    readonly timeoutSeconds?: number | undefined
    readonly observedArchitecture?: string | undefined
    readonly onVerificationCommandStarted?: SandboxCommandInput['onVerificationCommandStarted']
  },
) {
  const artifacts: Array<SandboxEvidenceArtifact> = []
  const verificationResults: Array<SandboxVerificationResult> = []
  let repositoryHeadAfter: string | undefined
  const runCaptureCommand = Effect.fnUntraced(function* (
    operation: string,
    command: string,
    timeoutSeconds = evidenceCaptureTimeoutSeconds,
    maxOutputBytes?: number,
  ) {
    const startedAt = yield* Clock.currentTimeMillis
    const result = yield* executeSandboxCommand(sandbox, {
      command,
      timeoutSeconds,
      traceId: `${input.traceId}-${operation}`,
      ...(maxOutputBytes === undefined ? {} : { maxOutputBytes }),
      stateless: true,
    }).pipe(
      Effect.catch((error) =>
        Effect.logWarning('Evidence artifact probe failed', {
          traceId: input.traceId,
          operation,
          error: error.message,
        }).pipe(Effect.as(undefined)),
      ),
    )
    if (result === undefined) return undefined
    return { ...result, startedAt, completedAt: yield* Clock.currentTimeMillis }
  })

  const architectureProbe =
    input.observedArchitecture === undefined
      ? yield* runCaptureCommand('architecture', 'uname -m')
      : undefined
  const architecture =
    input.observedArchitecture ??
    (architectureProbe?.exitCode === 0 &&
    architectureProbe.stdout.trim().length > 0
      ? architectureProbe.stdout.trim()
      : 'unknown')
  const captureCandidateState = (operation: string) =>
    captureCandidateStateDigest(sandbox, {
      baseSha: input.candidateBaseSha,
      traceId: `${input.traceId}-${operation}`,
    }).pipe(
      Effect.catch((error) =>
        Effect.logWarning('Candidate state capture failed', {
          traceId: input.traceId,
          operation,
          error: error.message,
        }).pipe(Effect.as(undefined)),
      ),
    )

  const invocation = input.verificationInvocation
  let invocationCommandResult:
    | {
        readonly exitCode: number | undefined
        readonly stdout: string
        readonly stderr?: string | undefined
        readonly startedAt: number
        readonly completedAt: number
        readonly sessionId: NonNullable<SandboxCommandResult['sessionId']>
        readonly commandId: NonNullable<SandboxCommandResult['commandId']>
      }
    | undefined
  if (invocation !== undefined) {
    const cleanupCommands = [
      ...(invocation.requiredArtifactKinds.includes('test-report')
        ? [
            'rm -f .patchplane/test-report.json .patchplane/test-report.xml patchplane-test-report.json patchplane-test-report.xml test-results/junit.xml junit.xml coverage/coverage-final.json',
          ]
        : []),
      ...(invocation.requiredArtifactKinds.includes('screenshot')
        ? [
            'rm -f .patchplane/browser-screenshot.png patchplane-browser-screenshot.png test-results/browser-screenshot.png playwright-report/browser-screenshot.png',
          ]
        : []),
    ]
    const cleanup =
      cleanupCommands.length === 0
        ? { exitCode: 0 }
        : yield* runCaptureCommand(
            'verification-clean',
            cleanupCommands.join('; '),
          )
    const candidateDigestBefore = yield* captureCandidateState(
      'verification-candidate-before',
    )
    if (cleanup?.exitCode === 0) {
      const invocationStartedAt = yield* Clock.currentTimeMillis
      const handle = yield* startSandboxSessionCommand(sandbox, {
        command: invocation.command,
        timeoutSeconds: invocation.timeoutSeconds,
        traceId: `${input.traceId}-verification-command`,
        maxOutputBytes: maxVerificationCommandOutputBytes,
      })
      const terminal = yield* Effect.gen(function* () {
        if (input.onVerificationCommandStarted !== undefined) {
          yield* input.onVerificationCommandStarted({
            sandboxId: sandbox.id,
            sessionId: handle.sessionId,
            commandId: handle.commandId,
          })
        }
        return yield* waitForSandboxSessionCommand(handle, {
          timeoutSeconds: invocation.timeoutSeconds,
          maxOutputBytes: maxVerificationCommandOutputBytes,
        })
      }).pipe(Effect.ensuring(handle.deleteSession))
      invocationCommandResult = {
        ...terminal,
        startedAt: invocationStartedAt,
        completedAt: yield* Clock.currentTimeMillis,
        sessionId: handle.sessionId,
        commandId: handle.commandId,
      }
      yield* Effect.logInfo('Daytona trusted command reached terminal status', {
        traceId: input.traceId,
        sandboxId: sandbox.id,
        sessionId: handle.sessionId,
        commandId: handle.commandId,
        exitCode: terminal.exitCode,
      })
    }
    repositoryHeadAfter = yield* captureRepositoryBaseSha(
      sandbox,
      `${input.traceId}-verification-head-after`,
    ).pipe(
      Effect.catch((error) =>
        Effect.logWarning('Repository HEAD capture failed after trusted command', {
          traceId: input.traceId,
          error: error.message,
        }).pipe(Effect.as(undefined)),
      ),
    )
    const candidateDigestAfter = yield* captureCandidateState(
      'verification-candidate-after',
    )
    yield* Effect.logInfo('Captured candidate state after trusted command', {
      traceId: input.traceId,
      sandboxId: sandbox.id,
      candidateUnchanged: candidateDigestBefore === candidateDigestAfter,
    })
    verificationResults.push({
      requirementKey: invocation.requirementKey,
      kind: invocation.kind,
      command: invocation.command,
      status: invocationCommandResult?.exitCode === 0 ? 'succeeded' : 'failed',
      ...(invocationCommandResult?.exitCode === undefined
        ? {}
        : { exitCode: invocationCommandResult.exitCode }),
      message:
        cleanup?.exitCode !== 0
          ? 'Verification setup failed while removing stale artifacts.'
          : invocationCommandResult === undefined
            ? 'Verification command could not be executed.'
            : invocationCommandResult.exitCode === 0
              ? undefined
              : `Verification command failed with exit ${invocationCommandResult.exitCode ?? 'unknown'}.`,
      provider: 'daytona',
      platform: invocation.platform,
      architecture,
      ...(candidateDigestBefore === undefined ? {} : { candidateDigestBefore }),
      ...(candidateDigestAfter === undefined ? {} : { candidateDigestAfter }),
      ...(invocationCommandResult === undefined
        ? {}
        : {
            startedAt: invocationCommandResult.startedAt,
            completedAt: invocationCommandResult.completedAt,
          }),
    })
  }

  let shouldProbeTestReport =
    invocation?.requiredArtifactKinds.includes('test-report') ?? false
  if (invocation === undefined && nonEmpty(input.evidenceTestReportCommand)) {
    const cleanup = yield* runCaptureCommand(
      'test-report-clean',
      'rm -f .patchplane/test-report.json .patchplane/test-report.xml patchplane-test-report.json patchplane-test-report.xml test-results/junit.xml junit.xml coverage/coverage-final.json',
    )
    if (cleanup === undefined || cleanup.exitCode !== 0) {
      verificationResults.push({
        kind: 'test',
        command: input.evidenceTestReportCommand,
        status: 'failed',
        message:
          'Test verification setup failed while removing stale report artifacts.',
        provider: 'daytona',
        platform: 'linux',
        architecture,
      })
    } else {
      shouldProbeTestReport = true
      const candidateDigestBefore = yield* captureCandidateState(
        'test-candidate-before',
      )
      const result = yield* runCaptureCommand(
        'test-report-command',
        input.evidenceTestReportCommand,
        input.evidenceTestTimeoutSeconds ?? evidenceCaptureTimeoutSeconds,
      )
      const candidateDigestAfter = yield* captureCandidateState(
        'test-candidate-after',
      )
      verificationResults.push(
        result === undefined
          ? {
              kind: 'test',
              command: input.evidenceTestReportCommand,
              status: 'failed',
              message: 'Test verification command could not be executed.',
              provider: 'daytona',
              platform: 'linux',
              architecture,
              ...(candidateDigestBefore === undefined
                ? {}
                : { candidateDigestBefore }),
              ...(candidateDigestAfter === undefined
                ? {}
                : { candidateDigestAfter }),
            }
          : {
              kind: 'test',
              command: input.evidenceTestReportCommand,
              status: result.exitCode === 0 ? 'succeeded' : 'failed',
              ...(result.exitCode === undefined
                ? {}
                : { exitCode: result.exitCode }),
              provider: 'daytona',
              platform: 'linux',
              architecture,
              ...(candidateDigestBefore === undefined
                ? {}
                : { candidateDigestBefore }),
              ...(candidateDigestAfter === undefined
                ? {}
                : { candidateDigestAfter }),
              startedAt: result.startedAt,
              completedAt: result.completedAt,
              ...(result.exitCode === 0
                ? {}
                : {
                    message: `Test verification command failed with exit ${result.exitCode ?? 'unknown'}.`,
                  }),
            },
      )
    }
  }
  const testReport = shouldProbeTestReport
    ? yield* runCaptureCommand('test-report-probe', testReportProbeCommand())
    : undefined
  if (testReport !== undefined && testReport.exitCode === 0) {
    const probed = parseTextArtifactProbe(testReport.stdout)
    if (probed !== undefined && isValidTestReport(probed.path, probed.body)) {
      artifacts.push({
        kind: 'test-report',
        label: 'Test report',
        contentType: testReportContentType(probed.path),
        body: probed.body,
        retentionPolicy: 'alpha-14d',
      })
    }
  }
  if (
    (invocation?.requiredArtifactKinds.includes('test-report') === true ||
      nonEmpty(input.evidenceTestReportCommand)) &&
    !artifacts.some((artifact) => artifact.kind === 'test-report')
  ) {
    const result = verificationResults.find(
      (verification) => verification.kind === 'test',
    )
    if (result?.status === 'succeeded') {
      verificationResults[verificationResults.indexOf(result)] = {
        ...result,
        status: 'failed',
        message:
          'Test verification command did not produce a supported test report artifact.',
      }
    }
  }

  let shouldProbeScreenshot =
    invocation?.requiredArtifactKinds.includes('screenshot') ?? false
  if (
    invocation === undefined &&
    nonEmpty(input.evidenceBrowserScreenshotCommand)
  ) {
    const cleanup = yield* runCaptureCommand(
      'browser-screenshot-clean',
      'rm -f .patchplane/browser-screenshot.png patchplane-browser-screenshot.png test-results/browser-screenshot.png playwright-report/browser-screenshot.png',
    )
    if (cleanup === undefined || cleanup.exitCode !== 0) {
      verificationResults.push({
        kind: 'browser',
        command: input.evidenceBrowserScreenshotCommand,
        status: 'failed',
        message:
          'Browser verification setup failed while removing stale screenshot artifacts.',
        provider: 'daytona',
        platform: 'linux',
        architecture,
      })
    } else {
      shouldProbeScreenshot = true
      const candidateDigestBefore = yield* captureCandidateState(
        'browser-candidate-before',
      )
      const result = yield* runCaptureCommand(
        'browser-screenshot-command',
        input.evidenceBrowserScreenshotCommand,
        input.evidenceBrowserTimeoutSeconds ?? evidenceCaptureTimeoutSeconds,
      )
      const candidateDigestAfter = yield* captureCandidateState(
        'browser-candidate-after',
      )
      verificationResults.push(
        result === undefined
          ? {
              kind: 'browser',
              command: input.evidenceBrowserScreenshotCommand,
              status: 'failed',
              message: 'Browser verification command could not be executed.',
              provider: 'daytona',
              platform: 'linux',
              architecture,
              ...(candidateDigestBefore === undefined
                ? {}
                : { candidateDigestBefore }),
              ...(candidateDigestAfter === undefined
                ? {}
                : { candidateDigestAfter }),
            }
          : {
              kind: 'browser',
              command: input.evidenceBrowserScreenshotCommand,
              status: result.exitCode === 0 ? 'succeeded' : 'failed',
              ...(result.exitCode === undefined
                ? {}
                : { exitCode: result.exitCode }),
              provider: 'daytona',
              platform: 'linux',
              architecture,
              ...(candidateDigestBefore === undefined
                ? {}
                : { candidateDigestBefore }),
              ...(candidateDigestAfter === undefined
                ? {}
                : { candidateDigestAfter }),
              startedAt: result.startedAt,
              completedAt: result.completedAt,
              ...(result.exitCode === 0
                ? {}
                : {
                    message: `Browser verification command failed with exit ${result.exitCode ?? 'unknown'}.`,
                  }),
            },
      )
    }
  }
  const screenshot = shouldProbeScreenshot
    ? yield* runCaptureCommand(
        'browser-screenshot-probe',
        screenshotProbeCommand(),
      )
    : undefined
  if (screenshot !== undefined && screenshot.exitCode === 0) {
    const probed = parseBinaryArtifactProbe(screenshot.stdout)
    if (probed !== undefined && isValidPng(probed.body)) {
      artifacts.push({
        kind: 'screenshot',
        label: 'Browser verification screenshot',
        contentType: 'image/png',
        body: probed.body,
        retentionPolicy: 'alpha-14d',
      })
    }
  }
  if (
    (invocation?.requiredArtifactKinds.includes('screenshot') === true ||
      nonEmpty(input.evidenceBrowserScreenshotCommand)) &&
    !artifacts.some((artifact) => artifact.kind === 'screenshot')
  ) {
    const result = verificationResults.find(
      (verification) => verification.kind === 'browser',
    )
    if (result?.status === 'succeeded') {
      verificationResults[verificationResults.indexOf(result)] = {
        ...result,
        status: 'failed',
        message:
          'Browser verification command did not produce a supported screenshot artifact.',
      }
    }
  }

  const diff = yield* runCaptureCommand(
    'diff',
    `git add -N . ${evidenceOutputPathspecExclusions} >/dev/null 2>&1 || true; tmp=$(mktemp); trap 'rm -f "$tmp"' EXIT; git diff --binary --no-ext-diff ${shellQuote(input.candidateBaseSha)} -- . > "$tmp" || exit $?; node -e 'const fs=require("fs");const fd=fs.openSync(process.argv[1],"r");try{const body=Buffer.alloc(${maxCandidateDiffBytes + 1});const read=fs.readSync(fd,body,0,body.length,0);if(read>${maxCandidateDiffBytes})process.exit(65);process.stdout.write(body.subarray(0,read));}finally{fs.closeSync(fd);}' "$tmp"`,
  )
  if (
    diff !== undefined &&
    diff.exitCode === 0 &&
    diff.stdout.trim().length > 0
  ) {
    artifacts.push({
      kind: 'diff',
      label: 'Candidate patch diff',
      contentType: 'text/x-diff',
      body: diff.stdout,
      retentionPolicy: 'alpha-14d',
    })
  }
  const candidateStateDigest = yield* captureCandidateState('candidate-final')

  return {
    artifacts,
    verificationResults,
    candidateStateDigest,
    repositoryHeadAfter,
    invocationCommandResult,
  }
})

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

      return SandboxService.of({
        runRepositoryAgent: (input) =>
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
                      if (input.onRuntimeSessionStarted !== undefined) {
                        yield* input.onRuntimeSessionStarted({
                          provider: 'daytona:pi-rpc',
                          sandboxId: sandbox.id,
                          sessionId: handle.sessionId,
                          commandId: handle.commandId,
                          startedAt,
                        })
                      }
                      const persistRuntimeEvents = (
                        events: ReadonlyArray<PiRpcRuntimeEvent>,
                      ) =>
                        events.length === 0 ||
                        input.onRuntimeEvents === undefined
                          ? Effect.void
                          : input.onRuntimeEvents(events).pipe(
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

                      const pi = makePiRuntimeSession({
                        sessionId: handle.sessionId,
                        commandId: handle.commandId,
                        sendInput: handle.sendInput,
                        now: () => clock.currentTimeMillisUnsafe(),
                        stdout: streamSandboxSessionCommandLogs(
                          sandbox,
                          handle.sessionId,
                          handle.commandId,
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
                          Effect.logWarning(
                            'Pi RPC log stream ended with error; reconciling from buffered logs',
                            {
                              traceId: input.traceId,
                              error: error.message,
                            },
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
                              Stream.runCollect,
                              Effect.map((events) => Array.from(events)),
                            )
                            yield* persistRuntimeEvents(reconciledEvents)
                          }),
                        ),
                        Effect.forkScoped,
                      )

                      const sendPiCommand = <A, E, R>(
                        effect: Effect.Effect<A, E, R>,
                      ) =>
                        effect.pipe(
                          Effect.mapError(
                            sandboxBoundaryError(
                              'daytona.pi.rpc.send',
                              'Daytona failed to deliver a Pi RPC command',
                            ),
                          ),
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
                        Stream.runCollect,
                        Effect.map((events) => Array.from(events)),
                      )
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
                        stdout: logs.stdout,
                        stderr: logs.stderr,
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
                    })
                    const parsedRuntimeEvents =
                      yield* parsePiJsonRuntimeEventsEffect(response.stdout, {
                        now: () => clock.currentTimeMillisUnsafe(),
                      })

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
                      stdout: response.stdout,
                      stderr: response.stderr,
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
        abortRuntimeSession: (input) =>
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
        steerRuntimeSession: (input) =>
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
        followUpRuntimeSession: (input) =>
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
        terminateRuntimeSession: (input) =>
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
        runRepositoryCommand: (input) =>
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
                  } = yield* collectSandboxEvidenceArtifacts(sandbox, {
                    ...input,
                    candidateBaseSha: input.candidateBaseSha ?? baseSha,
                    ...(observedArchitecture === undefined
                      ? {}
                      : { observedArchitecture }),
                  })
                  const executed = invocationCommandResult ?? response
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
                    policy: effectivePolicy,
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
