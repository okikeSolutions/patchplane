export type PatchPlaneRuntimeSurface = 'app' | 'githubWebhook'

export interface PatchPlanePluginEnvVar {
  readonly name: string
  readonly required: boolean
  readonly secret?: boolean | undefined
  readonly defaultValue?: string | undefined
  readonly description: string
}

export interface PatchPlanePluginMetadata {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly layerExport: string
  readonly provides: readonly string[]
  readonly dependsOn?: readonly string[] | undefined
  readonly conflictsWith?: readonly string[] | undefined
  readonly surfaces: readonly PatchPlaneRuntimeSurface[]
  readonly env: readonly PatchPlanePluginEnvVar[]
}

export const patchPlanePlugins = {
  convex: {
    id: 'convex',
    name: 'Convex storage',
    description: 'Persists workflow starts, sandbox executions, and runtime events in Convex.',
    layerExport: '@patchplane/plugins/convex/storage-plugin#ConvexStoragePlugin.layer',
    provides: ['StorageService'],
    surfaces: ['app', 'githubWebhook'],
    env: [
      {
        name: 'CONVEX_URL',
        required: true,
        description: 'Convex deployment URL for server-side calls. VITE_CONVEX_URL is accepted as fallback by the plugin.',
      },
      {
        name: 'VITE_CONVEX_URL',
        required: true,
        description: 'Convex deployment URL exposed to the browser client.',
      },
      {
        name: 'PATCHPLANE_SYSTEM_INGESTION_SECRET',
        required: true,
        secret: true,
        description: 'Shared secret required for external workflow ingestion and server-to-Convex system writes.',
      },
    ],
  },
  workos: {
    id: 'workos',
    name: 'WorkOS auth',
    description: 'Authenticates users and maps WorkOS users/organizations into PatchPlane actors/workspaces.',
    layerExport: '@patchplane/plugins/workos/auth-plugin#WorkOSAuthPlugin.layer',
    provides: ['AuthService'],
    surfaces: ['app'],
    env: [
      {
        name: 'WORKOS_API_KEY',
        required: true,
        secret: true,
        description: 'WorkOS server API key.',
      },
      {
        name: 'WORKOS_CLIENT_ID',
        required: true,
        description: 'WorkOS/AuthKit client id. Also used by Convex auth.config.ts.',
      },
      {
        name: 'WORKOS_COOKIE_PASSWORD',
        required: true,
        secret: true,
        description: 'AuthKit cookie encryption password. Must be at least 32 characters.',
      },
      {
        name: 'WORKOS_REDIRECT_URI',
        required: true,
        description: 'AuthKit OAuth callback URL, for example http://localhost:3000/api/auth/callback.',
      },
      {
        name: 'WORKOS_API_HOSTNAME',
        required: false,
        description: 'Optional WorkOS API hostname override.',
      },
      {
        name: 'PATCHPLANE_WORKOS_ORGANIZATION_ID',
        required: false,
        description: 'Optional organization id used as a current alpha workspace routing fallback.',
      },
    ],
  },
  github: {
    id: 'github',
    name: 'GitHub provider',
    description: 'Verifies GitHub webhooks and performs source-control operations through a GitHub App.',
    layerExport: '@patchplane/plugins/github/provider-plugin#GitHubProviderPlugin.layer',
    provides: ['SourceControlService', 'GitHubWebhookService'],
    dependsOn: ['convex'],
    surfaces: ['githubWebhook'],
    env: [
      {
        name: 'GITHUB_APP_ID',
        required: true,
        description: 'GitHub App id.',
      },
      {
        name: 'GITHUB_PRIVATE_KEY',
        required: true,
        secret: true,
        description: 'GitHub App private key. Literal \\n sequences are accepted and normalized by the plugin.',
      },
      {
        name: 'GITHUB_WEBHOOK_SECRET',
        required: true,
        secret: true,
        description: 'GitHub webhook secret used to verify x-hub-signature-256.',
      },
      {
        name: 'GITHUB_BASE_URL',
        required: false,
        description: 'Optional GitHub Enterprise REST API base URL.',
      },
      {
        name: 'PATCHPLANE_GITHUB_ALLOWED_REPOSITORIES',
        required: true,
        description: 'Comma-separated alpha allowlist, e.g. owner/repo,another/repo.',
      },
      {
        name: 'PATCHPLANE_GITHUB_WORKSPACE_ID',
        required: false,
        description: 'Optional PatchPlane workspace id for GitHub webhook intake. Alternative: PATCHPLANE_WORKOS_ORGANIZATION_ID.',
      },
    ],
  },
  daytona: {
    id: 'daytona',
    name: 'Daytona sandbox',
    description: 'Runs repository commands or Pi coding-agent runs inside Daytona sandboxes.',
    layerExport: '@patchplane/plugins/daytona/sandbox-plugin#DaytonaSandboxPlugin.layer',
    provides: ['SandboxService'],
    surfaces: ['githubWebhook'],
    env: [
      {
        name: 'DAYTONA_API_KEY',
        required: true,
        secret: true,
        description: 'Daytona API key.',
      },
      {
        name: 'DAYTONA_API_URL',
        required: false,
        description: 'Optional Daytona API URL override.',
      },
      {
        name: 'DAYTONA_TARGET',
        required: false,
        description: 'Optional Daytona target/region.',
      },
    ],
  },
  pi: {
    id: 'pi',
    name: 'Pi coding-agent runtime',
    description: 'Runs the Pi coding-agent SDK as an in-process runtime service.',
    layerExport: '@patchplane/plugins/pi/runtime-plugin#PiAgentRuntimePlugin.layer',
    provides: ['RuntimeService'],
    surfaces: ['githubWebhook'],
    env: [
      {
        name: 'OPENAI_API_KEY',
        required: false,
        secret: true,
        description: 'Provider API key when using the default openai provider. Other providers use their own vendor env names.',
      },
    ],
  },
} as const satisfies Record<string, PatchPlanePluginMetadata>

export type PatchPlanePluginId = keyof typeof patchPlanePlugins

export const patchPlaneDefaultSurfaces = {
  app: ['convex', 'workos'],
  githubWebhook: ['github', 'convex', 'daytona'],
} as const satisfies Record<PatchPlaneRuntimeSurface, readonly PatchPlanePluginId[]>

export function getPatchPlanePluginsForSurface(surface: PatchPlaneRuntimeSurface) {
  return patchPlaneDefaultSurfaces[surface].map((id) => patchPlanePlugins[id])
}

export function getPatchPlanePlugin(id: string): PatchPlanePluginMetadata | undefined {
  return (Object.values(patchPlanePlugins) as readonly PatchPlanePluginMetadata[])
    .find((plugin) => plugin.id === id)
}

export function getPatchPlaneEnvVars(pluginIds: readonly string[]): PatchPlanePluginEnvVar[] {
  const env = new Map<string, PatchPlanePluginEnvVar>()

  for (const id of pluginIds) {
    const plugin = getPatchPlanePlugin(id)
    if (plugin === undefined) {
      continue
    }

    for (const variable of plugin.env) {
      const existing = env.get(variable.name)
      if (existing === undefined) {
        env.set(variable.name, variable)
        continue
      }

      env.set(variable.name, {
        ...existing,
        required: existing.required || variable.required,
        secret: existing.secret || variable.secret,
        defaultValue: existing.defaultValue ?? variable.defaultValue,
        description: existing.description === variable.description
          ? existing.description
          : `${existing.description} ${variable.description}`,
      })
    }
  }

  const sorted: PatchPlanePluginEnvVar[] = []
  for (const variable of env.values()) {
    const index = sorted.findIndex((item) => variable.name.localeCompare(item.name) < 0)
    if (index === -1) {
      sorted.push(variable)
    } else {
      sorted.splice(index, 0, variable)
    }
  }
  return sorted
}
