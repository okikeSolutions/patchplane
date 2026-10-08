import { Config, Option, Schema } from 'effect'
import type * as LogLevel from 'effect/LogLevel'

export type SentryEnvironment = 'development' | 'production'

export const SENTRY_DEFAULT_ENVIRONMENT: SentryEnvironment = 'development'
export const SENTRY_DEFAULT_ENABLE_LOGS = false
export const SENTRY_DEFAULT_ENABLE_TRACING = true
export const SENTRY_DEFAULT_LOG_LEVEL: LogLevel.LogLevel = 'Debug'
export const SENTRY_DEFAULT_TRACES_SAMPLE_RATE = 1.0

const TracesSampleRate = Schema.Finite.check(
  Schema.isBetween({ minimum: 0, maximum: 1 }),
)

/** Optional Sentry operational telemetry configuration. */
export const SentryConfig = Config.all({
  enabled: Config.Boolean('SENTRY_ENABLED').pipe(Config.withDefault(true)),
  dsn: Config.option(Config.Redacted('SENTRY_DSN')),
  environment: Config.Literals(
    ['development', 'production'],
    'SENTRY_ENVIRONMENT',
  ).pipe(Config.withDefault(SENTRY_DEFAULT_ENVIRONMENT)),
  logLevel: Config.option(Config.LogLevel('SENTRY_LOG_LEVEL')),
  tracesSampleRate: Config.option(
    Config.schema(TracesSampleRate, 'SENTRY_TRACES_SAMPLE_RATE'),
  ),
  enableLogs: Config.Boolean('SENTRY_ENABLE_LOGS').pipe(
    Config.withDefault(SENTRY_DEFAULT_ENABLE_LOGS),
  ),
  enableTracing: Config.Boolean('SENTRY_ENABLE_TRACING').pipe(
    Config.withDefault(SENTRY_DEFAULT_ENABLE_TRACING),
  ),
}).pipe(
  Config.map((config) => ({
    ...config,
    logLevel: Option.getOrElse(config.logLevel, () =>
      config.environment === 'production' ? 'Warn' : SENTRY_DEFAULT_LOG_LEVEL,
    ),
    tracesSampleRate: Option.getOrElse(config.tracesSampleRate, () =>
      config.environment === 'production'
        ? 0.2
        : SENTRY_DEFAULT_TRACES_SAMPLE_RATE,
    ),
  })),
)

export type SentryConfig =
  typeof SentryConfig extends Config.Config<infer A> ? A : never
