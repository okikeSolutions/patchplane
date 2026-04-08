import { Context, Effect, Layer, ParseResult, Schema } from 'effect'
import { BackendConfigFailure } from '../errors'

const PositiveFiniteNumber = Schema.Finite.pipe(
  Schema.greaterThan(0, {
    identifier: 'PositiveFiniteNumber',
    description: 'a positive finite number',
  }),
)

const NonEmptyString = Schema.String.pipe(
  Schema.minLength(1, {
    identifier: 'NonEmptyString',
    description: 'a non-empty string',
  }),
)

export const BackendConfigSchema = Schema.Struct({
  github: Schema.Struct({
    appId: PositiveFiniteNumber,
    privateKey: NonEmptyString,
    webhookSecret: NonEmptyString,
    defaultExecutionTargetKey: Schema.NonEmptyTrimmedString,
    defaultPolicyBundleKey: Schema.NonEmptyTrimmedString,
    baseUrl: Schema.optional(Schema.String),
  }),
  runtime: Schema.Struct({
    provider: Schema.Literal('pi-mono'),
    command: Schema.NonEmptyTrimmedString,
    envForwardKeys: Schema.Array(Schema.String),
  }),
  sandbox: Schema.Struct({
    provider: Schema.Literal('daytona'),
    timeoutMs: PositiveFiniteNumber,
    apiKey: Schema.optional(Schema.String),
    apiUrl: Schema.optional(Schema.String),
    target: Schema.optional(Schema.String),
    autoStopIntervalMinutes: PositiveFiniteNumber,
    ephemeral: Schema.Boolean,
  }),
  policy: Schema.Struct({
    requiredReviewers: Schema.Array(Schema.String),
    minimumScore: PositiveFiniteNumber,
  }),
})

export type BackendConfigShape = Schema.Schema.Type<typeof BackendConfigSchema>

export class BackendConfig extends Context.Tag(
  '@patchplane/backend/BackendConfig',
)<BackendConfig, BackendConfigShape>() {}

const decodeBackendConfig = Schema.decodeUnknown(BackendConfigSchema)
const decodeBackendConfigSync = Schema.decodeUnknownSync(BackendConfigSchema)

export function readRawBackendConfig() {
  return {
    github: {
      appId: Number(process.env.GITHUB_APP_ID ?? Number.NaN),
      privateKey: (process.env.GITHUB_APP_PRIVATE_KEY ?? '').replace(
        /\\n/g,
        '\n',
      ),
      webhookSecret: process.env.GITHUB_WEBHOOK_SECRET ?? '',
      defaultExecutionTargetKey:
        process.env.PATCHPLANE_GITHUB_EXECUTION_TARGET_ID ??
        'github.issue_comment',
      defaultPolicyBundleKey:
        process.env.PATCHPLANE_GITHUB_POLICY_BUNDLE_ID ?? 'default',
      ...(process.env.GITHUB_API_BASE_URL
        ? { baseUrl: process.env.GITHUB_API_BASE_URL }
        : {}),
    },
    runtime: {
      provider: 'pi-mono' as const,
      command:
        process.env.PATCHPLANE_PI_COMMAND ??
        'npx -y @mariozechner/pi-coding-agent',
      envForwardKeys: (
        process.env.PATCHPLANE_RUNTIME_ENV_FORWARD_KEYS ??
        'OPENAI_API_KEY,ANTHROPIC_API_KEY,GITHUB_TOKEN'
      )
        .split(',')
        .map((envKey) => envKey.trim())
        .filter(Boolean),
    },
    sandbox: {
      provider: 'daytona' as const,
      timeoutMs: Number(
        process.env.PATCHPLANE_SANDBOX_TIMEOUT_MS ?? 5 * 60 * 1000,
      ),
      ...(process.env.DAYTONA_API_KEY
        ? { apiKey: process.env.DAYTONA_API_KEY }
        : {}),
      ...(process.env.DAYTONA_API_URL
        ? { apiUrl: process.env.DAYTONA_API_URL }
        : {}),
      ...(process.env.DAYTONA_TARGET
        ? { target: process.env.DAYTONA_TARGET }
        : {}),
      autoStopIntervalMinutes: Number(
        process.env.PATCHPLANE_DAYTONA_AUTO_STOP_MINUTES ?? 15,
      ),
      ephemeral:
        (process.env.PATCHPLANE_DAYTONA_EPHEMERAL ?? 'true') === 'true',
    },
    policy: {
      requiredReviewers: (
        process.env.PATCHPLANE_REQUIRED_REVIEWERS ?? 'quality'
      )
        .split(',')
        .map((reviewer) => reviewer.trim())
        .filter(Boolean),
      minimumScore: Number(process.env.PATCHPLANE_MINIMUM_REVIEW_SCORE ?? 0.8),
    },
  }
}

function toBackendConfigFailure(cause: ParseResult.ParseError) {
  return new BackendConfigFailure({
    message: 'Invalid backend configuration.',
    issues: ParseResult.TreeFormatter.formatErrorSync(cause),
    cause,
  })
}

export function readBackendConfigSync(): BackendConfigShape {
  try {
    return decodeBackendConfigSync(readRawBackendConfig())
  } catch (error) {
    if (ParseResult.isParseError(error)) {
      throw toBackendConfigFailure(error)
    }

    throw error
  }
}

export const BackendConfigLive = Layer.effect(
  BackendConfig,
  Effect.suspend(() =>
    decodeBackendConfig(readRawBackendConfig()).pipe(
      Effect.mapError(toBackendConfigFailure),
    ),
  ),
)
