import { Clock, Effect, Result, Schedule, Schema } from 'effect'
import { Daytona } from '@daytona/sdk'
import { SandboxError } from '@patchplane/domain/errors'
import { EffectiveSandboxPolicy } from '@patchplane/domain/sandbox-environment'
import { type ProtectedSourceExecutionPolicy } from '@patchplane/domain/sandbox-policy'
import { DaytonaConfig } from './DaytonaConfig'
import { toDaytonaClientConfig, toSandboxPolicy } from './daytona-adapter'
import { executeSandboxCommand } from './daytona-process'
import { sanitizeDaytonaCause } from './daytona-redaction'
import { shellQuote } from './daytona-shell'
import {
  clearedCapabilitySet,
  protectedSandboxSetupScript,
  protectedVerifierGid,
  protectedVerifierUid,
} from './daytona-scripts'
import type { DaytonaClientLike, DaytonaSandboxLike } from './daytona-types'

export const evidenceCaptureTimeoutSeconds = 30

export const prepareProtectedVerificationSandbox = Effect.fnUntraced(function* (
  sandbox: DaytonaSandboxLike,
  traceId: string,
) {
  const script = protectedSandboxSetupScript
  const result = yield* executeSandboxCommand(sandbox, {
    command: `/bin/bash -c ${shellQuote(script)}`,
    timeoutSeconds: evidenceCaptureTimeoutSeconds,
    traceId: `${traceId}-protected-setup`,
    maxOutputBytes: 64 * 1024,
    stateless: true,
  })
  if (
    result.exitCode !== 0 ||
    !result.stdout.includes('PATCHPLANE_PROTECTED_SETUP_V1')
  ) {
    return yield* new SandboxError({
      operation: 'daytona.prepareProtectedVerificationSandbox',
      message: 'Daytona could not protect the candidate source tree',
      cause: { exitCode: result.exitCode, stderr: result.stderr },
    })
  }
})

export function parseProtectedObservation(
  output: string,
): ProtectedSourceExecutionPolicy | undefined {
  const values = new Map(
    output
      .trim()
      .split('\n')
      .map((line) => line.split('=', 2))
      .filter((entry): entry is [string, string] => entry.length === 2),
  )
  const capabilitiesCleared = [
    'CapInh:',
    'CapPrm:',
    'CapEff:',
    'CapBnd:',
    'CapAmb:',
  ].every((key) => values.get(key) === clearedCapabilitySet)
  if (
    values.get('effectiveUid') !== String(protectedVerifierUid) ||
    values.get('effectiveGid') !== String(protectedVerifierGid) ||
    values.get('NoNewPrivs:') !== '1' ||
    values.get('Seccomp:') !== '2' ||
    Number(values.get('Seccomp_filters:') ?? '0') < 1 ||
    !capabilitiesCleared ||
    values.get('namespacePid') !== '1' ||
    values.get('networkNamespace') !== '1' ||
    values.get('nestedNamespaceCreationBlocked') !== '1' ||
    values.get('sourceReadOnly') !== '1' ||
    values.get('gitMetadataReadOnly') !== '1' ||
    values.get('descendantsTerminated') !== '1'
  ) {
    return undefined
  }
  return {
    version: 'linux-v1',
    effectiveUid: protectedVerifierUid,
    effectiveGid: protectedVerifierGid,
    noNewPrivileges: true,
    capabilitySetsCleared: true,
    sourceReadOnly: true,
    gitMetadataReadOnly: true,
    privatePidNamespace: true,
    privateNetworkNamespace: true,
    nestedNamespaceCreationBlocked: true,
    descendantsTerminated: true,
  }
}

export function isDaytonaNotFoundCause(cause: unknown): boolean {
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

export function sandboxBoundaryError(operation: string, message: string) {
  return (cause: unknown) =>
    new SandboxError({
      operation,
      message,
      cause: sanitizeDaytonaCause(cause),
    })
}

export const readEffectiveSandboxPolicy = Effect.fnUntraced(function* (
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

export function deleteSandboxWithRetries(input: {
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

export const confirmSandboxDeleted = Effect.fnUntraced(function* (input: {
  readonly daytona: DaytonaClientLike
  readonly sandboxId: string
  readonly traceId: string
}) {
  const cleanupDeadline = (yield* Clock.currentTimeMillis) + 120_000
  let consecutiveReadFailures = 0
  for (let attempt = 1; attempt <= 120; attempt += 1) {
    const remainingMs = cleanupDeadline - (yield* Clock.currentTimeMillis)
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
      const sleepMs = Math.min(
        1_000,
        cleanupDeadline - (yield* Clock.currentTimeMillis),
      )
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

export function makeDefaultDaytonaClient(
  config: DaytonaConfig,
): DaytonaClientLike {
  const daytona = new Daytona(toDaytonaClientConfig(config))
  return {
    create: (params, options) => daytona.create(params, options),
    delete: (sandbox, timeout) => sandbox.delete(timeout),
    get: (sandboxIdOrName) => daytona.get(sandboxIdOrName),
    [Symbol.asyncDispose]: () =>
      daytona[Symbol.asyncDispose]?.() ?? Promise.resolve(),
  }
}
