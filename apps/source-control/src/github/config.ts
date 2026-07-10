import { Config, ConfigProvider, Effect, Layer, Redacted } from 'effect'

export type WorkerEnv = Record<string, unknown>

export const PATCHPLANE_DEFAULT_AGENT_PROVIDER = 'openai'
export const PATCHPLANE_DEFAULT_AGENT_MODEL = 'gpt-5.5'
export const PATCHPLANE_DEFAULT_AGENT_THINKING = 'low'

export const SourceControlRouteConfig = Config.all({
  convexUrl: Config.string('CONVEX_URL').pipe(
    Config.orElse(() => Config.string('VITE_CONVEX_URL')),
  ),
  systemIngestionSecret: Config.redacted('PATCHPLANE_SYSTEM_INGESTION_SECRET').pipe(
    Config.withDefault(Redacted.make('')),
  ),
  repositoryAllowlist: Config.string('PATCHPLANE_GITHUB_ALLOWED_REPOSITORIES'),
  githubWorkspaceId: Config.string('PATCHPLANE_GITHUB_WORKSPACE_ID').pipe(Config.withDefault('')),
  workosOrganizationId: Config.string('PATCHPLANE_WORKOS_ORGANIZATION_ID').pipe(Config.withDefault('')),
  piProvider: Config.string('PATCHPLANE_PI_PROVIDER').pipe(Config.withDefault('')),
  piModel: Config.string('PATCHPLANE_PI_MODEL').pipe(Config.withDefault(PATCHPLANE_DEFAULT_AGENT_MODEL)),
  piThinking: Config.string('PATCHPLANE_PI_THINKING').pipe(Config.withDefault(PATCHPLANE_DEFAULT_AGENT_THINKING)),
  piMode: Config.string('PATCHPLANE_PI_MODE').pipe(Config.withDefault('json')),
  webhookExecution: Config.string('PATCHPLANE_GITHUB_WEBHOOK_EXECUTION').pipe(Config.withDefault('daytona-pi')),
  evidenceTestReportCommand: Config.string('PATCHPLANE_EVIDENCE_TEST_REPORT_COMMAND').pipe(Config.withDefault('')),
  evidenceBrowserScreenshotCommand: Config.string('PATCHPLANE_EVIDENCE_BROWSER_SCREENSHOT_COMMAND').pipe(Config.withDefault('')),
  cloudflareApiKey: Config.string('CLOUDFLARE_API_KEY').pipe(Config.withDefault('')),
  cloudflareAccountId: Config.string('CLOUDFLARE_ACCOUNT_ID').pipe(Config.withDefault('')),
  cloudflareGatewayId: Config.string('CLOUDFLARE_GATEWAY_ID').pipe(
    Config.orElse(() => Config.string('PATCHPLANE_AI_GATEWAY_ID')),
    Config.withDefault(''),
  ),
})

export type SourceControlRouteConfig = typeof SourceControlRouteConfig extends Config.Config<infer A> ? A : never

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

export function loadSourceControlRouteConfig(env: WorkerEnv) {
  return Effect.runSync(SourceControlRouteConfig.pipe(provideSourceControlConfig(env)))
}
