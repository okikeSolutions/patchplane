import { Config, ConfigProvider, Effect, Layer, Option, Redacted, Schema } from 'effect'

export type WorkerEnv = Record<string, unknown>

export const PATCHPLANE_DEFAULT_AGENT_PROVIDER = 'openai'
export const PATCHPLANE_DEFAULT_AGENT_MODEL = 'gpt-5.5'
export const PATCHPLANE_DEFAULT_AGENT_THINKING = 'low'

const SourceControlRouteConfigEnvironment = Config.all({
  convexUrl: Config.all({
    canonical: Config.option(Config.url('CONVEX_URL')),
    legacy: Config.option(Config.url('VITE_CONVEX_URL')),
  }),
  systemIngestionSecret: Config.redacted('PATCHPLANE_SYSTEM_INGESTION_SECRET').pipe(
    Config.withDefault(Redacted.make('')),
  ),
  repositoryAllowlist: Config.string('PATCHPLANE_GITHUB_ALLOWED_REPOSITORIES'),
  githubWorkspaceId: Config.string('PATCHPLANE_GITHUB_WORKSPACE_ID').pipe(Config.withDefault('')),
  workosOrganizationId: Config.string('PATCHPLANE_WORKOS_ORGANIZATION_ID').pipe(Config.withDefault('')),
  piProvider: Config.string('PATCHPLANE_PI_PROVIDER').pipe(Config.withDefault('')),
  piModel: Config.schema(Schema.NonEmptyString, 'PATCHPLANE_PI_MODEL').pipe(
    Config.withDefault(PATCHPLANE_DEFAULT_AGENT_MODEL),
  ),
  piThinking: Config.schema(Schema.NonEmptyString, 'PATCHPLANE_PI_THINKING').pipe(
    Config.withDefault(PATCHPLANE_DEFAULT_AGENT_THINKING),
  ),
  piMode: Config.literals(['json', 'rpc'], 'PATCHPLANE_PI_MODE').pipe(Config.withDefault('json')),
  webhookExecution: Config.literals(
    ['daytona-command', 'daytona-pi'],
    'PATCHPLANE_GITHUB_WEBHOOK_EXECUTION',
  ).pipe(Config.withDefault('daytona-pi')),
  evidenceTestReportCommand: Config.string('PATCHPLANE_EVIDENCE_TEST_REPORT_COMMAND').pipe(Config.withDefault('')),
  evidenceTestPlatform: Config.literals(['linux', 'macos', 'windows'], 'PATCHPLANE_EVIDENCE_TEST_PLATFORM').pipe(
    Config.withDefault('linux'),
  ),
  evidenceBrowserScreenshotCommand: Config.string('PATCHPLANE_EVIDENCE_BROWSER_SCREENSHOT_COMMAND').pipe(Config.withDefault('')),
  cloudflareApiKey: Config.option(Config.redacted('CLOUDFLARE_API_KEY')),
  cloudflareAccountId: Config.string('CLOUDFLARE_ACCOUNT_ID').pipe(Config.withDefault('')),
  cloudflareGatewayId: Config.string('CLOUDFLARE_GATEWAY_ID').pipe(
    Config.orElse(() => Config.string('PATCHPLANE_AI_GATEWAY_ID')),
    Config.withDefault(''),
  ),
})

class SourceControlConfigError extends Schema.ErrorClass<SourceControlConfigError>(
  'SourceControlConfigError',
)({ message: Schema.String }) {}

function configEnv(env: WorkerEnv) {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}

export function sourceControlConfigLayer(env: WorkerEnv) {
  return ConfigProvider.layer(ConfigProvider.fromEnv({ env: configEnv(env) }))
}

export function provideSourceControlConfig<R, E, A>(env: WorkerEnv) {
  return (effect: Effect.Effect<A, E, R>) => effect.pipe(Effect.provide(sourceControlConfigLayer(env)))
}

export function provideSourceControlConfigLayer<R, E, A>(env: WorkerEnv) {
  return (layer: Layer.Layer<A, E, R>) => layer.pipe(Layer.provide(sourceControlConfigLayer(env)))
}

export const loadSourceControlRouteConfig = Effect.fnUntraced(function*(
  env: WorkerEnv,
) {
  const config = yield* SourceControlRouteConfigEnvironment.pipe(
    provideSourceControlConfig(env),
  )
  const convexUrl = config.convexUrl.canonical.pipe(
    Option.orElse(() => config.convexUrl.legacy),
  )
  if (Option.isNone(convexUrl)) {
    return yield* new SourceControlConfigError({
      message: 'CONVEX_URL or VITE_CONVEX_URL is required',
    })
  }
  return {
    ...config,
    convexUrl: convexUrl.value.toString(),
  }
})

export type SourceControlRouteConfig = ReturnType<
  typeof loadSourceControlRouteConfig
> extends Effect.Effect<infer A, any, any> ? A : never
