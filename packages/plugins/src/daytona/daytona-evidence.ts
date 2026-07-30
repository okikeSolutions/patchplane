import { Clock, Effect, Option, Schema } from 'effect'
import { XMLValidator } from 'fast-xml-parser'
import { PNG } from 'pngjs'
import { SandboxError } from '@patchplane/domain/errors'
import { type ProtectedSourceExecutionPolicy } from '@patchplane/domain/sandbox-policy'
import {
  type SandboxCommandInput,
  type SandboxCommandResult,
  type SandboxEvidenceArtifact,
  type SandboxVerificationResult,
} from '@patchplane/core/services/sandbox-service'
import {
  executeSandboxCommand,
  startSandboxSessionCommand,
  waitForSandboxSessionCommand,
} from './daytona-process'
import { shellQuote } from './daytona-shell'
import {
  binaryArtifactMarker,
  protectedExecutionReadbackScript,
  protectedVerificationCommand,
  screenshotProbeCommand,
  testReportProbeCommand,
  textArtifactMarker,
} from './daytona-scripts'
import type { DaytonaSandboxLike } from './daytona-types'
import {
  evidenceCaptureTimeoutSeconds,
  parseProtectedObservation,
} from './daytona-policy'

export const maxVerificationCommandOutputBytes = 2 * 1024 * 1024

const maxCandidateDiffBytes = 10_000_000

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

export const captureRepositoryBaseSha = Effect.fnUntraced(function* (
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

export const captureInitialCandidateState = Effect.fnUntraced(function* (
  sandbox: DaytonaSandboxLike,
  input: { readonly baseSha: string; readonly traceId: string },
) {
  const result = yield* executeSandboxCommand(sandbox, {
    command: `head="$(git rev-parse HEAD)"; git add -N . ${evidenceOutputPathspecExclusions} >/dev/null 2>&1 || true; digest="$(git diff --binary --no-ext-diff ${shellQuote(input.baseSha)} -- . | sha256sum)"; printf '%s\\n%s\\n' "$head" "$digest"`,
    timeoutSeconds: evidenceCaptureTimeoutSeconds,
    traceId: input.traceId,
    stateless: true,
  })
  const [baseSha, digestLine] = result.stdout.trim().split('\n', 2)
  if (
    result.exitCode !== 0 ||
    baseSha === undefined ||
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(baseSha)
  ) {
    return yield* new SandboxError({
      operation: 'daytona.captureInitialCandidateState',
      message:
        'Daytona could not determine the repository base commit for evidence capture',
      cause: { exitCode: result.exitCode, stderr: result.stderr },
    })
  }
  const digest = digestLine?.trim().split(/\s+/, 1)[0]
  return {
    baseSha,
    candidateStateDigest:
      digest !== undefined && /^[0-9a-f]{64}$/i.test(digest)
        ? `sha256:${digest.toLowerCase()}`
        : undefined,
  }
})

function candidateStateDigestFromOutput(output: string) {
  const digest = output.trim().split(/\s+/, 1)[0]
  return digest !== undefined && /^[0-9a-f]{64}$/i.test(digest)
    ? `sha256:${digest.toLowerCase()}`
    : undefined
}

export const captureCandidateStateDigest = Effect.fnUntraced(function* (
  sandbox: DaytonaSandboxLike,
  input: { readonly baseSha: string; readonly traceId: string },
) {
  const result = yield* executeSandboxCommand(sandbox, {
    command: `git add -N . ${evidenceOutputPathspecExclusions} >/dev/null 2>&1 || true; git diff --binary --no-ext-diff ${shellQuote(input.baseSha)} -- . | sha256sum`,
    timeoutSeconds: evidenceCaptureTimeoutSeconds,
    traceId: input.traceId,
    stateless: true,
  })
  return result.exitCode === 0
    ? candidateStateDigestFromOutput(result.stdout)
    : undefined
})

const captureProtectedPostExecutionState = Effect.fnUntraced(function* (
  sandbox: DaytonaSandboxLike,
  input: { readonly baseSha: string; readonly traceId: string },
) {
  const headMarker = '__PATCHPLANE_HEAD__='
  const digestMarker = '__PATCHPLANE_DIGEST__='
  const inspect = `${protectedExecutionReadbackScript}
printf '${headMarker}'
git rev-parse HEAD
printf '${digestMarker}'
git add -N . ${evidenceOutputPathspecExclusions} >/dev/null 2>&1 || true
git diff --binary --no-ext-diff ${shellQuote(input.baseSha)} -- . | sha256sum
`
  const result = yield* executeSandboxCommand(sandbox, {
    command: `/bin/bash -c ${shellQuote(inspect)}`,
    timeoutSeconds: evidenceCaptureTimeoutSeconds,
    traceId: `${input.traceId}-protected-post-execution-readback`,
    maxOutputBytes: 64 * 1024,
    stateless: true,
  })
  const policy =
    result.exitCode === 0 ? parseProtectedObservation(result.stdout) : undefined
  if (policy === undefined) {
    return yield* new SandboxError({
      operation: 'daytona.captureProtectedPostExecutionState',
      message:
        'Daytona protected execution readback was missing or inconsistent',
      cause: {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      },
    })
  }
  const head = result.stdout.match(
    new RegExp(`${headMarker}([0-9a-f]{40}|[0-9a-f]{64})(?:\\n|$)`),
  )?.[1]
  const digestOutput = result.stdout.split(digestMarker, 2)[1]
  return {
    policy,
    repositoryHeadAfter: head,
    candidateStateDigest:
      digestOutput === undefined
        ? undefined
        : candidateStateDigestFromOutput(digestOutput),
  }
})

export const collectSandboxEvidenceArtifacts = Effect.fnUntraced(function* (
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
  let protectedExecution: ProtectedSourceExecutionPolicy | undefined
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
    return {
      ...result,
      startedAt,
      completedAt: yield* Clock.currentTimeMillis,
    }
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
    const cleanupAndCandidateState =
      cleanupCommands.length === 0
        ? undefined
        : yield* runCaptureCommand(
            'verification-clean-and-candidate-before',
            `/bin/bash -c ${shellQuote(`set -euo pipefail
${cleanupCommands.join('; ')}
git add -N . ${evidenceOutputPathspecExclusions} >/dev/null 2>&1 || true
git diff --binary --no-ext-diff ${shellQuote(input.candidateBaseSha)} -- . | sha256sum`)}`,
          )
    const cleanup = cleanupAndCandidateState ?? { exitCode: 0 }
    const candidateDigestBefore =
      cleanupCommands.length === 0
        ? yield* captureCandidateState('verification-candidate-before')
        : cleanupAndCandidateState?.exitCode === 0
          ? candidateStateDigestFromOutput(cleanupAndCandidateState.stdout)
          : undefined
    if (cleanup?.exitCode === 0) {
      const invocationStartedAt = yield* Clock.currentTimeMillis
      const handle = yield* startSandboxSessionCommand(sandbox, {
        command: protectedVerificationCommand(invocation.command),
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
    const protectedPostExecutionState =
      invocationCommandResult === undefined
        ? undefined
        : yield* captureProtectedPostExecutionState(sandbox, {
            baseSha: input.candidateBaseSha,
            traceId: input.traceId,
          })
    protectedExecution = protectedPostExecutionState?.policy
    repositoryHeadAfter =
      protectedPostExecutionState?.repositoryHeadAfter ??
      (yield* captureRepositoryBaseSha(
        sandbox,
        `${input.traceId}-verification-head-after`,
      ).pipe(
        Effect.catch((error) =>
          Effect.logWarning(
            'Repository HEAD capture failed after trusted command',
            {
              traceId: input.traceId,
              error: error.message,
            },
          ).pipe(Effect.as(undefined)),
        ),
      ))
    const candidateDigestAfter =
      protectedPostExecutionState?.candidateStateDigest ??
      (invocationCommandResult === undefined
        ? yield* captureCandidateState('verification-candidate-after')
        : undefined)
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
    ? yield* runCaptureCommand(
        'test-report-probe',
        testReportProbeCommand(invocation !== undefined),
      )
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
        screenshotProbeCommand(invocation !== undefined),
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

  // Incoming verification already has a provider-checksummed frozen diff in R2.
  // Avoid a redundant Daytona toolbox subrequest on Cloudflare's 50-subrequest
  // Free-plan path; endpoint snapshots remain integrity readbacks, not provenance.
  const diff =
    invocation === undefined
      ? yield* runCaptureCommand(
          'diff',
          `git add -N . ${evidenceOutputPathspecExclusions} >/dev/null 2>&1 || true; tmp=$(mktemp); trap 'rm -f "$tmp"' EXIT; git diff --binary --no-ext-diff ${shellQuote(input.candidateBaseSha)} -- . > "$tmp" || exit $?; node -e 'const fs=require("fs");const fd=fs.openSync(process.argv[1],"r");try{const body=Buffer.alloc(${maxCandidateDiffBytes + 1});const read=fs.readSync(fd,body,0,body.length,0);if(read>${maxCandidateDiffBytes})process.exit(65);process.stdout.write(body.subarray(0,read));}finally{fs.closeSync(fd);}' "$tmp"`,
        )
      : undefined
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
  const candidateStateDigest =
    invocation === undefined
      ? yield* captureCandidateState('candidate-final')
      : verificationResults.find(
          (verification) =>
            verification.requirementKey === invocation.requirementKey,
        )?.candidateDigestAfter

  return {
    artifacts,
    verificationResults,
    candidateStateDigest,
    repositoryHeadAfter,
    invocationCommandResult,
    protectedExecution,
  }
})
