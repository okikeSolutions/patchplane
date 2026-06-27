import { Config } from 'effect'
import type * as LogLevel from 'effect/LogLevel'

export type SentryEnvironment = 'development' | 'production'

export const SENTRY_DEFAULT_ENVIRONMENT: SentryEnvironment = normalizeEnvironment(
  process.env.SENTRY_ENVIRONMENT ?? 'development',
)
export const SENTRY_DEFAULT_ENABLE_LOGS = false
export const SENTRY_DEFAULT_ENABLE_TRACING = true
export const SENTRY_DEFAULT_ENABLE_METRICS = SENTRY_DEFAULT_ENVIRONMENT === 'production'
export const SENTRY_DEFAULT_LOG_LEVEL: LogLevel.LogLevel =
  SENTRY_DEFAULT_ENVIRONMENT === 'production' ? 'Warn' : 'Debug'
export const SENTRY_DEFAULT_TRACES_SAMPLE_RATE =
  SENTRY_DEFAULT_ENVIRONMENT === 'production' ? 0.2 : 1.0

function normalizeEnvironment(value: string): SentryEnvironment {
  return value === 'production' ? 'production' : 'development'
}

/** Optional Sentry operational telemetry configuration. */
export const SentryConfig = Config.all({
  enabled: Config.boolean('SENTRY_ENABLED').pipe(Config.withDefault(true)),
  dsn: Config.option(Config.redacted('SENTRY_DSN')),
  environment: Config.string('SENTRY_ENVIRONMENT').pipe(
    Config.map(normalizeEnvironment),
    Config.withDefault(SENTRY_DEFAULT_ENVIRONMENT),
  ),
  logLevel: Config.logLevel('SENTRY_LOG_LEVEL').pipe(
    Config.withDefault(SENTRY_DEFAULT_LOG_LEVEL),
  ),
  tracesSampleRate: Config.number('SENTRY_TRACES_SAMPLE_RATE').pipe(
    Config.withDefault(SENTRY_DEFAULT_TRACES_SAMPLE_RATE),
  ),
  enableLogs: Config.boolean('SENTRY_ENABLE_LOGS').pipe(
    Config.withDefault(SENTRY_DEFAULT_ENABLE_LOGS),
  ),
  enableTracing: Config.boolean('SENTRY_ENABLE_TRACING').pipe(
    Config.withDefault(SENTRY_DEFAULT_ENABLE_TRACING),
  ),
  enableMetrics: Config.boolean('SENTRY_ENABLE_METRICS').pipe(
    Config.withDefault(SENTRY_DEFAULT_ENABLE_METRICS),
  ),
})

export type SentryConfig = typeof SentryConfig extends Config.Config<infer A>
  ? A
  : never
