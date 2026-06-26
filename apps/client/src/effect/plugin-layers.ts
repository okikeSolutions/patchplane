import { ConvexStoragePlugin } from '@patchplane/plugins/convex/storage-plugin'
import { DaytonaSandboxPlugin } from '@patchplane/plugins/daytona/sandbox-plugin'
import { GitHubProviderPlugin } from '@patchplane/plugins/github/provider-plugin'
import { LocalObservabilityPlugin } from '@patchplane/plugins/observability/local-plugin'
import { PiAgentRuntimePlugin } from '@patchplane/plugins/pi/runtime-plugin'
import { SentryTelemetryPlugin } from '@patchplane/plugins/sentry/telemetry-plugin'
import { WorkOSAuthPlugin } from '@patchplane/plugins/workos/auth-plugin'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Effect, Layer } from 'effect'
import type { PatchPlanePluginId, PatchPlaneRuntimeSurface } from '@patchplane/plugins/registry'
import { getSurfacePluginIds } from './patchplane-config'

function requirePlugin(
  surface: PatchPlaneRuntimeSurface,
  pluginIds: ReadonlySet<PatchPlanePluginId>,
  pluginId: PatchPlanePluginId,
) {
  if (!pluginIds.has(pluginId)) {
    throw new Error(`PatchPlane surface ${surface} requires plugin ${pluginId}`)
  }
}

function configuredPluginIds() {
  return Effect.gen(function* () {
    const appPluginIds = yield* getSurfacePluginIds('app')
    const githubWebhookPluginIds = yield* getSurfacePluginIds('githubWebhook')

    const appSet = new Set(appPluginIds)
    requirePlugin('app', appSet, 'convex')
    requirePlugin('app', appSet, 'workos')

    const githubWebhookSet = new Set(githubWebhookPluginIds)
    requirePlugin('githubWebhook', githubWebhookSet, 'github')
    requirePlugin('githubWebhook', githubWebhookSet, 'convex')
    requirePlugin('githubWebhook', githubWebhookSet, 'daytona')

    return new Set<PatchPlanePluginId>([
      ...appPluginIds,
      ...githubWebhookPluginIds,
    ])
  }).pipe(Effect.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)))
}

export function makePatchPlaneLayer() {
  return Layer.unwrap(
    Effect.map(configuredPluginIds(), (pluginIds) => {
      const baseLayer = Layer.mergeAll(
        ConvexStoragePlugin.layer,
        WorkOSAuthPlugin.layer,
        GitHubProviderPlugin.layer,
        DaytonaSandboxPlugin.layer,
        LocalObservabilityPlugin.layer,
        SentryTelemetryPlugin.layer,
      )

      return pluginIds.has('pi')
        ? Layer.merge(baseLayer, PiAgentRuntimePlugin.layer)
        : baseLayer
    }),
  )
}
