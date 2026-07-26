import { Config, Data, Effect, FileSystem, Option, Path, Schema } from 'effect'
import {
  patchPlaneDefaultSurfaces,
  patchPlanePlugins,
  type PatchPlanePluginId,
  type PatchPlaneRuntimeSurface,
} from '@patchplane/plugins/registry'
import {
  DAYTONA_DEFAULT_COMMAND,
  DAYTONA_DEFAULT_COMMAND_TIMEOUT_SECONDS,
} from '@patchplane/plugins/daytona/config'
import { makeWorkspaceId, makeWorkOSWorkspaceId, type WorkspaceId } from '@patchplane/domain/ids'

export type GitHubWebhookExecutionMode = 'daytona-command' | 'daytona-pi'

const PATCHPLANE_DEFAULT_AGENT_PROVIDER = 'openai'
const PATCHPLANE_DEFAULT_AGENT_MODEL = 'gpt-5.5'
const PATCHPLANE_DEFAULT_AGENT_THINKING = 'low'

class PatchPlaneConfigError extends Data.TaggedError('PatchPlaneConfigError')<{
  readonly message: string
  readonly cause?: unknown
}> {}

const GitHubWebhookEnvironment = Config.all({
  repositoryAllowlist: Config.string('PATCHPLANE_GITHUB_ALLOWED_REPOSITORIES').pipe(Config.withDefault('')),
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
  cloudflareApiKey: Config.option(Config.redacted('CLOUDFLARE_API_KEY')),
  cloudflareAccountId: Config.string('CLOUDFLARE_ACCOUNT_ID').pipe(Config.withDefault('')),
  cloudflareGatewayId: Config.string('CLOUDFLARE_GATEWAY_ID').pipe(
    Config.orElse(() => Config.string('PATCHPLANE_AI_GATEWAY_ID')),
    Config.withDefault(''),
  ),
})

type GitHubWebhookEnvironment = typeof GitHubWebhookEnvironment extends Config.Config<infer A> ? A : never

export interface PatchPlaneConfig {
  readonly plugins: Partial<Record<PatchPlaneRuntimeSurface, readonly PatchPlanePluginId[]>>
  readonly runtime: {
    readonly githubWebhookExecution: GitHubWebhookExecutionMode
  }
}

export interface GitHubWebhookRouteConfig {
  readonly workspaceId: WorkspaceId
  readonly repositoryAllowlist: ReadonlySet<string>
  readonly execution:
    | {
      readonly mode: 'daytona-command'
      readonly command: string
      readonly timeoutSeconds?: number | undefined
    }
    | {
      readonly mode: 'daytona-pi'
      readonly provider: string
      readonly model: string
      readonly thinking?: string | undefined
      readonly piMode?: 'json' | 'rpc' | undefined
      readonly timeoutSeconds?: number | undefined
    }
}

const defaultConfig: PatchPlaneConfig = {
  plugins: patchPlaneDefaultSurfaces,
  runtime: {
    githubWebhookExecution: 'daytona-command',
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function formatConfigValue(value: unknown) {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function isPatchPlanePluginId(value: string): value is PatchPlanePluginId {
  return value in patchPlanePlugins
}

function parsePluginIds(value: unknown, surface: PatchPlaneRuntimeSurface) {
  if (!Array.isArray(value)) {
    return undefined
  }

  const ids: PatchPlanePluginId[] = []
  for (const item of value) {
    if (typeof item !== 'string' || !isPatchPlanePluginId(item)) {
      throw new Error(`PatchPlane config contains an unknown plugin for ${surface}: ${formatConfigValue(item)}`)
    }
    ids.push(item)
  }
  return ids
}

function parseExecutionMode(value: unknown): GitHubWebhookExecutionMode | undefined {
  if (value === undefined) {
    return undefined
  }
  if (value === 'daytona-command' || value === 'daytona-pi') {
    return value
  }
  throw new Error(`PatchPlane config contains an unsupported runtime.githubWebhookExecution: ${formatConfigValue(value)}`)
}

function parseConfigJson(value: unknown): PatchPlaneConfig {
  if (!isRecord(value)) {
    throw new Error('PatchPlane config must contain a JSON object')
  }

  const plugins = isRecord(value.plugins) ? value.plugins : {}
  const runtime = isRecord(value.runtime) ? value.runtime : {}

  return {
    plugins: {
      app: parsePluginIds(plugins.app, 'app') ?? defaultConfig.plugins.app,
      githubWebhook: parsePluginIds(plugins.githubWebhook, 'githubWebhook') ??
        defaultConfig.plugins.githubWebhook,
    },
    runtime: {
      githubWebhookExecution: parseExecutionMode(runtime.githubWebhookExecution) ??
        defaultConfig.runtime.githubWebhookExecution,
    },
  }
}

const findConfigPath = Effect.fnUntraced(function*(file: string) {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path

    if (path.isAbsolute(file)) {
      return (yield* fs.exists(file)) ? file : undefined
    }

    const initialCwd = yield* Config.string('INIT_CWD').pipe(Config.withDefault(''))
    const candidates = [process.cwd(), initialCwd]
      .filter((candidate) => candidate.length > 0)
      .map((candidate) => path.resolve(candidate))

    for (const start of candidates) {
      let current = start
      while (true) {
        const candidate = path.join(current, file)
        if (yield* fs.exists(candidate)) {
          return candidate
        }

        const parent = path.dirname(current)
        if (parent === current) {
          break
        }
        current = parent
      }
    }

    return undefined
  })

function decodeConfigJson(text: string, file: string) {
  return Effect.try({
    try: () => parseConfigJson(JSON.parse(text)),
    catch: (cause) => new PatchPlaneConfigError({
      message: `Unable to decode PatchPlane configuration at ${file}`,
      cause,
    }),
  })
}

export const loadPatchPlaneConfig = Effect.fnUntraced(function*(file = 'patchplane.config.json') {
    const fs = yield* FileSystem.FileSystem
    const configPath = yield* findConfigPath(file)
    if (configPath !== undefined) {
      return yield* decodeConfigJson(yield* fs.readFileString(configPath), configPath)
    }

    const legacyPath = yield* findConfigPath('.patchplane/config.json')
    if (file === 'patchplane.config.json' && legacyPath !== undefined) {
      yield* Effect.logWarning('Using legacy .patchplane/config.json. Move this file to patchplane.config.json; .patchplane is reserved for generated local state.')
      return yield* decodeConfigJson(yield* fs.readFileString(legacyPath), legacyPath)
    }

    return defaultConfig
  })

export function getSurfacePluginIds(surface: PatchPlaneRuntimeSurface) {
  return Effect.map(loadPatchPlaneConfig(), (config) => config.plugins[surface] ?? patchPlaneDefaultSurfaces[surface])
}

function parseRepositoryAllowlist(value: string | undefined) {
  if (value === undefined || value.trim().length === 0) {
    throw new Error('PATCHPLANE_GITHUB_ALLOWED_REPOSITORIES is required for GitHub workflow ingestion')
  }

  const repositories = value
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)

  if (repositories.length === 0) {
    throw new Error('PATCHPLANE_GITHUB_ALLOWED_REPOSITORIES must include at least one owner/repo entry')
  }

  return new Set(repositories)
}

function parseGitHubWorkspaceId(workspaceIdValue: string, organizationIdValue: string) {
  const workspaceId = workspaceIdValue.trim()
  if (workspaceId) {
    return makeWorkspaceId(workspaceId)
  }

  const organizationId = organizationIdValue.trim()
  if (organizationId) {
    return makeWorkOSWorkspaceId(organizationId)
  }

  throw new Error(
    'PATCHPLANE_GITHUB_WORKSPACE_ID or PATCHPLANE_WORKOS_ORGANIZATION_ID is required for GitHub workflow ingestion',
  )
}

function resolvePiExecutionConfig(environment: GitHubWebhookEnvironment) {
  const provider = environment.piProvider || (
    Option.isSome(environment.cloudflareApiKey) && environment.cloudflareAccountId && environment.cloudflareGatewayId
      ? 'cloudflare-ai-gateway'
      : PATCHPLANE_DEFAULT_AGENT_PROVIDER
  )

  return {
    provider,
    model: environment.piModel,
    thinking: environment.piThinking,
    piMode: environment.piMode === 'rpc' ? 'rpc' : 'json',
    timeoutSeconds: DAYTONA_DEFAULT_COMMAND_TIMEOUT_SECONDS,
  } as const
}

export const loadGitHubWebhookRouteConfig = Effect.gen(function* () {
  const config = yield* loadPatchPlaneConfig()
  const environment = yield* GitHubWebhookEnvironment
  const mode = config.runtime.githubWebhookExecution
  const { workspaceId, repositoryAllowlist } = yield* Effect.try({
    try: () => ({
      workspaceId: parseGitHubWorkspaceId(
        environment.githubWorkspaceId,
        environment.workosOrganizationId,
      ),
      repositoryAllowlist: parseRepositoryAllowlist(
        environment.repositoryAllowlist,
      ),
    }),
    catch: (cause) =>
      new PatchPlaneConfigError({
        message: 'GitHub webhook route configuration is invalid',
        cause,
      }),
  })

  if (mode === 'daytona-pi') {
    return {
      workspaceId,
      repositoryAllowlist,
      execution: {
        mode,
        ...resolvePiExecutionConfig(environment),
      },
    } satisfies GitHubWebhookRouteConfig
  }

  return {
    workspaceId,
    repositoryAllowlist,
    execution: {
      mode,
      command: DAYTONA_DEFAULT_COMMAND,
      timeoutSeconds: DAYTONA_DEFAULT_COMMAND_TIMEOUT_SECONDS,
    },
  } satisfies GitHubWebhookRouteConfig
})
