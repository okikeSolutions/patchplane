export type PatchPlaneRuntimeSurface = 'app' | 'githubWebhook'

/** Environment variable metadata exposed by PatchPlane plugin discovery and CLI env commands. */
export interface PatchPlanePluginEnvVar {
  readonly name: string
  readonly required: boolean
  readonly secret?: boolean | undefined
  readonly defaultValue?: string | undefined
  readonly description: string
}

/**
 * Static description of a PatchPlane infrastructure plugin.
 *
 * @remarks
 * The registry is intentionally metadata-only: it may name required secrets,
 * but it must never contain secret values.
 */
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

/** Built-in plugin registry used by config generation, diagnostics, and docs. */
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
      {
        name: 'DAYTONA_NETWORK_BLOCK_ALL',
        required: false,
        description: 'Optional sandbox network posture. When true, blocks all outbound network access unless Daytona allow-list behavior permits exceptions.',
      },
      {
        name: 'DAYTONA_NETWORK_ALLOW_LIST',
        required: false,
        description: 'Optional comma-separated CIDR allow-list recorded in normalized sandbox policy metadata.',
      },
      {
        name: 'DAYTONA_RESOURCE_CPU',
        required: false,
        description: 'Optional requested sandbox CPU count recorded in normalized sandbox policy metadata.',
      },
      {
        name: 'DAYTONA_RESOURCE_MEMORY',
        required: false,
        description: 'Optional requested sandbox memory in GiB recorded in normalized sandbox policy metadata.',
      },
      {
        name: 'DAYTONA_RESOURCE_DISK',
        required: false,
        description: 'Optional requested sandbox disk in GiB recorded in normalized sandbox policy metadata.',
      },
      {
        name: 'DAYTONA_RETAIN_SANDBOXES',
        required: false,
        defaultValue: 'false',
        description: 'Set to true only for manual debugging. Alpha workflow sandboxes are ephemeral by default.',
      },
      {
        name: 'PATCHPLANE_PI_PROVIDER',
        required: false,
        defaultValue: 'openai',
        description: 'Optional Pi provider for Daytona Pi mode. Cloudflare AI Gateway is selected automatically when its required env vars are configured.',
      },
      {
        name: 'PATCHPLANE_PI_MODEL',
        required: false,
        defaultValue: 'gpt-5.5',
        description: 'Optional Pi model for Daytona Pi mode.',
      },
      {
        name: 'PATCHPLANE_PI_THINKING',
        required: false,
        defaultValue: 'low',
        description: 'Optional Pi thinking level for models that support it.',
      },
      {
        name: 'PATCHPLANE_AI_GATEWAY_ID',
        required: false,
        description: 'Optional Cloudflare AI Gateway id/slug. Mapped to CLOUDFLARE_GATEWAY_ID inside Pi sandboxes when Cloudflare AI Gateway is selected.',
      },
      {
        name: 'CLOUDFLARE_API_KEY',
        required: false,
        secret: true,
        description: 'Optional Cloudflare AI Gateway API key for Pi sandbox model access.',
      },
    ],
  },
  observability: {
    id: 'observability',
    name: 'Local Effect observability',
    description: 'Writes local Effect logs to the console and .patchplane JSONL log file.',
    layerExport: '@patchplane/plugins/observability/local-plugin#LocalObservabilityPlugin.layer',
    provides: ['LocalEffectLogs'],
    surfaces: ['app', 'githubWebhook'],
    env: [],
  },
  sentry: {
    id: 'sentry',
    name: 'Sentry telemetry',
    description: 'Captures operational errors, Effect logs, spans, and metrics in Sentry when configured.',
    layerExport: '@patchplane/plugins/sentry/telemetry-plugin#SentryTelemetryPlugin.layer',
    provides: ['TelemetryService'],
    surfaces: ['app', 'githubWebhook'],
    env: [
      {
        name: 'SENTRY_DSN',
        required: false,
        secret: true,
        description: 'Optional Sentry DSN. When omitted, the telemetry plugin runs as a no-op service.',
      },
      {
        name: 'SENTRY_ENABLED',
        required: false,
        defaultValue: 'true',
        description: 'Set to false to disable Sentry telemetry even when SENTRY_DSN is present.',
      },
      {
        name: 'SENTRY_ENVIRONMENT',
        required: false,
        defaultValue: 'development',
        description: 'Sentry environment name. PatchPlane currently supports development and production.',
      },
      {
        name: 'SENTRY_LOG_LEVEL',
        required: false,
        defaultValue: 'Debug in development, Warn in production',
        description: 'Minimum Effect log level for runtime observability. Accepted values include Debug, Info, Warn, Error, Fatal.',
      },
      {
        name: 'SENTRY_ENABLE_LOGS',
        required: false,
        defaultValue: 'false',
        description: 'Whether Effect logs are forwarded to Sentry logs. Defaults off to keep routine operational events local unless explicitly enabled.',
      },
      {
        name: 'SENTRY_ENABLE_TRACING',
        required: false,
        defaultValue: 'true',
        description: 'Whether Effect spans are registered with the Sentry Effect tracer.',
      },
      {
        name: 'SENTRY_ENABLE_METRICS',
        required: false,
        defaultValue: 'false in development, true in production',
        description: 'Whether Effect metrics are periodically flushed to Sentry. Defaults off in development to avoid noisy telemetry.',
      },
      {
        name: 'SENTRY_TRACES_SAMPLE_RATE',
        required: false,
        defaultValue: '1.0 in development, 0.2 in production',
        description: 'Sentry trace sample rate for Effect spans.',
      },
    ],
  },
} as const satisfies Record<string, PatchPlanePluginMetadata>

export type PatchPlanePluginId = keyof typeof patchPlanePlugins

export const patchPlaneDefaultSurfaces = {
  app: ['convex', 'workos', 'observability', 'sentry'],
  githubWebhook: ['github', 'convex', 'daytona', 'observability', 'sentry'],
} as const satisfies Record<PatchPlaneRuntimeSurface, readonly PatchPlanePluginId[]>

export function getPatchPlanePluginsForSurface(surface: PatchPlaneRuntimeSurface) {
  return patchPlaneDefaultSurfaces[surface].map((id) => patchPlanePlugins[id])
}

export function getPatchPlanePlugin(id: string): PatchPlanePluginMetadata | undefined {
  return (Object.values(patchPlanePlugins) as readonly PatchPlanePluginMetadata[])
    .find((plugin) => plugin.id === id)
}

/** Returns the de-duplicated environment variable requirements for plugin ids. */
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
