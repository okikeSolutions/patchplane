import { Effect, FileSystem, Path } from 'effect'
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

function findConfigPath(file: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path

    if (path.isAbsolute(file)) {
      return (yield* fs.exists(file)) ? file : undefined
    }

    const candidates = [process.cwd(), process.env.INIT_CWD]
      .filter((candidate): candidate is string => candidate !== undefined && candidate.length > 0)
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
}

export function loadPatchPlaneConfig(file = 'patchplane.config.json') {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const configPath = yield* findConfigPath(file)
    if (configPath !== undefined) {
      return parseConfigJson(JSON.parse(yield* fs.readFileString(configPath)))
    }

    const legacyPath = yield* findConfigPath('.patchplane/config.json')
    if (file === 'patchplane.config.json' && legacyPath !== undefined) {
      console.warn('Using legacy .patchplane/config.json. Move this file to patchplane.config.json; .patchplane is reserved for generated local state.')
      return parseConfigJson(JSON.parse(yield* fs.readFileString(legacyPath)))
    }

    return defaultConfig
  })
}

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

function parseGitHubWorkspaceId() {
  const workspaceId = process.env.PATCHPLANE_GITHUB_WORKSPACE_ID?.trim()
  if (workspaceId) {
    return makeWorkspaceId(workspaceId)
  }

  const organizationId = process.env.PATCHPLANE_WORKOS_ORGANIZATION_ID?.trim()
  if (organizationId) {
    return makeWorkOSWorkspaceId(organizationId)
  }

  throw new Error(
    'PATCHPLANE_GITHUB_WORKSPACE_ID or PATCHPLANE_WORKOS_ORGANIZATION_ID is required for GitHub workflow ingestion',
  )
}

function resolvePiExecutionConfig() {
  const provider = process.env.PATCHPLANE_PI_PROVIDER ?? (
    process.env.CLOUDFLARE_API_KEY !== undefined &&
      process.env.CLOUDFLARE_ACCOUNT_ID !== undefined &&
      (process.env.CLOUDFLARE_GATEWAY_ID ?? process.env.PATCHPLANE_AI_GATEWAY_ID) !== undefined
      ? 'cloudflare-ai-gateway'
      : PATCHPLANE_DEFAULT_AGENT_PROVIDER
  )

  return {
    provider,
    model: process.env.PATCHPLANE_PI_MODEL ?? PATCHPLANE_DEFAULT_AGENT_MODEL,
    thinking: process.env.PATCHPLANE_PI_THINKING ?? PATCHPLANE_DEFAULT_AGENT_THINKING,
    piMode: process.env.PATCHPLANE_PI_MODE === 'rpc' ? 'rpc' : 'json',
    timeoutSeconds: DAYTONA_DEFAULT_COMMAND_TIMEOUT_SECONDS,
  } as const
}

export function loadGitHubWebhookRouteConfig() {
  return Effect.gen(function* () {
    const config = yield* loadPatchPlaneConfig()
    const mode = config.runtime.githubWebhookExecution

    if (mode === 'daytona-pi') {
      return {
        workspaceId: parseGitHubWorkspaceId(),
        repositoryAllowlist: parseRepositoryAllowlist(process.env.PATCHPLANE_GITHUB_ALLOWED_REPOSITORIES),
        execution: {
          mode,
          ...resolvePiExecutionConfig(),
        },
      } satisfies GitHubWebhookRouteConfig
    }

    return {
      workspaceId: parseGitHubWorkspaceId(),
      repositoryAllowlist: parseRepositoryAllowlist(process.env.PATCHPLANE_GITHUB_ALLOWED_REPOSITORIES),
      execution: {
        mode,
        command: DAYTONA_DEFAULT_COMMAND,
        timeoutSeconds: DAYTONA_DEFAULT_COMMAND_TIMEOUT_SECONDS,
      },
    } satisfies GitHubWebhookRouteConfig
  })
}
