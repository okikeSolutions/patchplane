import { Context, Effect, Layer, Schema } from 'effect'

export const BackendConfigSchema = Schema.Struct({
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

export interface BackendConfigShape {
  readonly runtime: {
    readonly provider: 'pi-mono'
  }
  readonly sandbox: {
    readonly provider: 'daytona'
    readonly timeoutMs: number
  }
  readonly policy: {
    readonly requiredReviewers: ReadonlyArray<string>
    readonly minimumScore: number
  }
}

export class BackendConfig extends Context.Tag(
  '@patchplane/backend/BackendConfig',
)<BackendConfig, BackendConfigShape>() {}

const decodeBackendConfig = Schema.decodeUnknownSync(BackendConfigSchema)

const rawConfig = {
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
