import { Context, Effect, Layer, Schema } from 'effect'

export const BackendConfigSchema = Schema.Struct({
  github: Schema.Struct({
    appId: Schema.Number,
    privateKey: Schema.String,
    webhookSecret: Schema.String,
    defaultExecutionTargetId: Schema.String,
    defaultPolicyBundleId: Schema.String,
    baseUrl: Schema.optional(Schema.String),
  }),
  runtime: Schema.Struct({
    provider: Schema.Literal('pi-mono'),
  }),
  sandbox: Schema.Struct({
    provider: Schema.Literal('daytona'),
    timeoutMs: Schema.Number,
  }),
  policy: Schema.Struct({
    requiredReviewers: Schema.Array(Schema.String),
    minimumScore: Schema.Number,
  }),
})

export type BackendConfigShape = Schema.Schema.Type<typeof BackendConfigSchema>

export class BackendConfig extends Context.Tag(
  '@patchplane/backend/BackendConfig',
)<BackendConfig, BackendConfigShape>() {}

const decodeBackendConfig = Schema.decodeUnknownSync(BackendConfigSchema)

const rawConfig = {
  github: {
    appId: Number(process.env.GITHUB_APP_ID ?? 0),
    privateKey: (process.env.GITHUB_APP_PRIVATE_KEY ?? '').replace(
      /\\n/g,
      '\n',
    ),
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET ?? '',
    defaultExecutionTargetId:
      process.env.PATCHPLANE_GITHUB_EXECUTION_TARGET_ID ??
      'github.issue_comment',
    defaultPolicyBundleId:
      process.env.PATCHPLANE_GITHUB_POLICY_BUNDLE_ID ?? 'default',
    ...(process.env.GITHUB_API_BASE_URL
      ? { baseUrl: process.env.GITHUB_API_BASE_URL }
      : {}),
  },
  runtime: {
    provider: 'pi-mono' as const,
  },
  sandbox: {
    provider: 'daytona' as const,
    timeoutMs: Number(
      process.env.PATCHPLANE_SANDBOX_TIMEOUT_MS ?? 5 * 60 * 1000,
    ),
  },
  policy: {
    requiredReviewers: (process.env.PATCHPLANE_REQUIRED_REVIEWERS ?? 'quality')
      .split(',')
      .map((reviewer) => reviewer.trim())
      .filter(Boolean),
    minimumScore: Number(process.env.PATCHPLANE_MINIMUM_REVIEW_SCORE ?? 0.8),
  },
}

export const BackendConfigLive = Layer.effect(
  BackendConfig,
  Effect.sync(() => decodeBackendConfig(rawConfig)),
)
