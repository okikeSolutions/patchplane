import {
  CriticalPathBreadcrumbStatus,
  CriticalPathStage,
} from '@patchplane/core/services/telemetry-service'
import type {
  Breadcrumb,
  ResolvedDataCollection,
  ErrorEvent,
  EventHint,
  SpanJSON,
  TransactionEvent,
} from '@sentry/core'
import { HashSet, Option, RegExp as EffectRegExp, Schema } from 'effect'

export const FILTERED = '[Filtered]'
export const MAX_STRING_LENGTH = 512
export const MAX_COLLECTION_ENTRIES = 64
export const MAX_STACK_INPUT_LENGTH = 32_768

export function makeSentryDataCollection(): ResolvedDataCollection {
  return {
    userInfo: false,
    cookies: false,
    httpHeaders: { request: false, response: false },
    httpBodies: [],
    urlQueryParams: false,
    graphQL: { document: false, variables: false },
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
    queues: false,
    stackFrameVariables: false,
    frameContextLines: 0,
  }
}

export const sentryMaxBreadcrumbs = 64

export const credentialPattern = new EffectRegExp.RegExp(
  String.raw`(?:bearer\s+[a-z0-9._~+/-]+=*|gh[pousr]_[a-z0-9_]{20,}|github_pat_[a-z0-9_]{20,}|(?:eyJ[a-z0-9_-]+\.){2}[a-z0-9_-]+|(?:api[_-]?key|password|secret|token)\s*[:=]\s*[^\s,;]+|(?:api[_-]?key|password|secret|token)_[a-z0-9_-]{12,})`,
  'gi',
)
export const queryOrFragmentPattern = new EffectRegExp.RegExp('[?#]')
export const httpDescriptionPattern = new EffectRegExp.RegExp(
  '^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\\s+(.+)$',
  'i',
)
export const stackLocationPattern = new EffectRegExp.RegExp(
  ':(\\d+):(\\d+)\\)?$',
)
const TelemetryName = Schema.String.check(
  Schema.isMaxLength(160),
  Schema.isPattern(
    new EffectRegExp.RegExp('^[a-z][a-z0-9@]*(?:[._:/-][a-z0-9@]+)*$', 'i'),
  ),
).pipe(Schema.brand('SentryTelemetryName'))
const TelemetryTraceId = Schema.String.check(
  Schema.isPattern(
    new EffectRegExp.RegExp(
      '^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$',
      'i',
    ),
  ),
).pipe(Schema.brand('SentryTelemetryTraceId'))
const TelemetryRecordId = Schema.String.check(
  Schema.isPattern(new EffectRegExp.RegExp('^[a-z][a-z0-9]{31}$')),
).pipe(Schema.brand('SentryTelemetryRecordId'))
const TelemetryRelease = Schema.String.check(
  Schema.isMaxLength(128),
  Schema.isPattern(
    new EffectRegExp.RegExp(
      '^(?:[0-9a-f]{7,64}|v?\\d+\\.\\d+\\.\\d+(?:[-+][a-z0-9.-]+)?)$',
      'i',
    ),
  ),
).pipe(Schema.brand('SentryTelemetryRelease'))
const SentryEventId = Schema.String.check(
  Schema.isPattern(new EffectRegExp.RegExp('^[0-9a-f]{32}$', 'i')),
)
const SentryTraceId = Schema.String.check(
  Schema.isPattern(new EffectRegExp.RegExp('^[0-9a-f]{32}$', 'i')),
)
const SentrySpanId = Schema.String.check(
  Schema.isPattern(new EffectRegExp.RegExp('^[0-9a-f]{16}$', 'i')),
)
const TelemetryMethod = Schema.Literals([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
])
const TelemetryPlatform = Schema.Literals([
  'browser',
  'cloudflare',
  'linux',
  'macos',
  'windows',
  'unknown',
])
const TelemetryArchitecture = Schema.Literals([
  'arm64',
  'x64',
  'x86_64',
  'unknown',
])
const TelemetryPluginName = Schema.Literals([
  'artifacts',
  'cloudflare-r2-artifacts',
  'convex',
  'daytona',
  'github',
  'sentry',
  'workos',
])
const TelemetryProvider = Schema.Literals([
  'cloudflare',
  'convex',
  'daytona',
  'github',
  'openai',
  'anthropic',
  'google',
  'workos',
])
const TelemetryEnvironment = Schema.Literals([
  'development',
  'preview',
  'production',
  'staging',
  'test',
])
const SentryLevel = Schema.Literals([
  'fatal',
  'error',
  'warning',
  'log',
  'info',
  'debug',
])
const SentryMetricType = Schema.Literals(['counter', 'gauge', 'distribution'])
const SentryLogLevel = Schema.Literals([
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
])
const SentryExceptionType = Schema.Literals([
  'Error',
  'ArtifactsError',
  'AuthError',
  'GitHubError',
  'PatchReportAssemblyError',
  'SandboxError',
  'SourceControlError',
  'StorageError',
  'TelemetryError',
  'ValidationError',
  'WorkflowStateError',
])
const StackLineNumber = Schema.Int.check(
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(10_000_000),
)
const StackColumnNumber = Schema.Int.check(
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(100_000),
)
const SentryMetricName = Schema.Literals([
  'patchplane.operation.count',
  'patchplane.operation.duration',
])
export const decodeTelemetryName = Schema.decodeUnknownOption(TelemetryName)
export const decodeCriticalPathStage =
  Schema.decodeUnknownOption(CriticalPathStage)
export const decodeCriticalPathBreadcrumbStatus = Schema.decodeUnknownOption(
  CriticalPathBreadcrumbStatus,
)
export const decodeTelemetryTraceId =
  Schema.decodeUnknownOption(TelemetryTraceId)
export const decodeTelemetryRecordId =
  Schema.decodeUnknownOption(TelemetryRecordId)
export const decodeTelemetryRelease =
  Schema.decodeUnknownOption(TelemetryRelease)
export const decodeSentryEventId = Schema.decodeUnknownOption(SentryEventId)
export const decodeSentryTraceId = Schema.decodeUnknownOption(SentryTraceId)
export const decodeSentrySpanId = Schema.decodeUnknownOption(SentrySpanId)
export const decodeTelemetryMethod = Schema.decodeUnknownOption(TelemetryMethod)
export const decodeTelemetryPlatform =
  Schema.decodeUnknownOption(TelemetryPlatform)
export const decodeTelemetryArchitecture = Schema.decodeUnknownOption(
  TelemetryArchitecture,
)
export const decodeTelemetryPluginName =
  Schema.decodeUnknownOption(TelemetryPluginName)
export const decodeTelemetryProvider =
  Schema.decodeUnknownOption(TelemetryProvider)
export const decodeTelemetryEnvironment =
  Schema.decodeUnknownOption(TelemetryEnvironment)
export const decodeSentryLevel = Schema.decodeUnknownOption(SentryLevel)
export const decodeSentryMetricType =
  Schema.decodeUnknownOption(SentryMetricType)
export const decodeSentryLogLevel = Schema.decodeUnknownOption(SentryLogLevel)
export const decodeSentryMetricName =
  Schema.decodeUnknownOption(SentryMetricName)
export const decodeSentryExceptionType =
  Schema.decodeUnknownOption(SentryExceptionType)
export const decodeStackLineNumber = Schema.decodeUnknownOption(StackLineNumber)
export const decodeStackColumnNumber =
  Schema.decodeUnknownOption(StackColumnNumber)
export const decodeFiniteNumber = Schema.decodeUnknownOption(Schema.Finite)
export const decodeInstructionAddress = Schema.decodeUnknownOption(
  Schema.String.check(
    Schema.isPattern(new EffectRegExp.RegExp('^(?:0x)?[0-9a-f]{1,32}$', 'i')),
  ),
)
export const decodeDebugId = Schema.decodeUnknownOption(
  Schema.String.check(
    Schema.isPattern(
      new EffectRegExp.RegExp(
        '^(?:[0-9a-f]{32}|[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})$',
        'i',
      ),
    ),
  ),
)
export const parseTelemetryUrl = Option.liftThrowable(
  (value: string) => new URL(value, 'https://patchplane.invalid'),
)

export const idAttributeNames = HashSet.make(
  'workflowRunId',
  'rootWorkflowRunId',
  'runtimeSessionId',
  'sandboxExecutionId',
  'candidatePatchSetId',
  'verificationRequirementId',
  'reviewRunId',
  'policyDecisionId',
  'humanDecisionId',
  'publicationId',
)
export const nameAttributeNames = HashSet.make(
  'publicationKind',
  'criticalPathStage',
  'stage',
  'status',
)
export const numberAttributeNames = HashSet.make(
  'count',
  'durationMs',
  'status_code',
  'statusCode',
)
export const urlAttributeNames = HashSet.make('url', 'from', 'to')
export const allowedAttributeNames = [
  'traceId',
  'workflowRunId',
  'rootWorkflowRunId',
  'runtimeSessionId',
  'sandboxExecutionId',
  'candidatePatchSetId',
  'verificationRequirementId',
  'reviewRunId',
  'policyDecisionId',
  'humanDecisionId',
  'publicationId',
  'publicationKind',
  'pluginName',
  'operation',
  'criticalPathStage',
  'stage',
  'status',
  'provider',
  'errorCode',
  'errorCategory',
  'count',
  'durationMs',
  'status_code',
  'statusCode',
  'url',
  'from',
  'to',
  'method',
  'platform',
  'architecture',
  'environment',
  'release',
  'telemetryPolicy',
] as const
export const readTelemetryAttribute = Option.liftThrowable(
  (record: { readonly [key: PropertyKey]: unknown }, key: string) =>
    record[key],
)
export const discardSentryAttachments = Option.liftThrowable(
  (hint: EventHint) => {
    hint.attachments = []
  },
)

export const sentryTelemetryPolicyMarker = 'allowlisted-v1'

export type SafeAttribute = string | number | boolean | null

export function makeSafeErrorEvent(): ErrorEvent {
  return {
    type: undefined,
    message: 'Captured PatchPlane operation event',
    tags: {},
  }
}

export function makeSafeTransactionEvent(): TransactionEvent {
  return {
    type: 'transaction',
    transaction: 'patchplane.operation',
    tags: {},
  }
}

export function makeSafeBreadcrumb(): Breadcrumb {
  return {
    category: 'sentry.automatic',
    message: FILTERED,
    data: {},
  }
}

export function makeSafeSpan(): SpanJSON {
  return {
    span_id: '0000000000000000',
    trace_id: '00000000000000000000000000000000',
    start_timestamp: 0,
    status: 'unknown',
    description: 'patchplane.operation',
    data: {},
  }
}
