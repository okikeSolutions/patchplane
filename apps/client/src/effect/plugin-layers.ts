import { ConvexStoragePlugin } from '@patchplane/plugins/convex/storage-plugin'
import { DaytonaSandboxPlugin } from '@patchplane/plugins/daytona/sandbox-plugin'
import { GitHubProviderPlugin } from '@patchplane/plugins/github/provider-plugin'
import { PiAgentRuntimePlugin } from '@patchplane/plugins/pi/runtime-plugin'
import { WorkOSAuthPlugin } from '@patchplane/plugins/workos/auth-plugin'
import { Layer } from 'effect'
import type { PatchPlanePluginId, PatchPlaneRuntimeSurface } from '@patchplane/plugins/registry'
import { getSurfacePluginIds } from './patchplane-config'
import { ObservabilityLayer } from './observability'

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
  const appPluginIds = getSurfacePluginIds('app')
  const githubWebhookPluginIds = getSurfacePluginIds('githubWebhook')

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
}

export function makePatchPlaneLayer() {
  const pluginIds = configuredPluginIds()
  const baseLayer = Layer.mergeAll(
    ConvexStoragePlugin.layer,
    WorkOSAuthPlugin.layer,
    GitHubProviderPlugin.layer,
    DaytonaSandboxPlugin.layer,
    ObservabilityLayer,
  )

  return pluginIds.has('pi')
    ? Layer.merge(baseLayer, PiAgentRuntimePlugin.layer)
    : baseLayer
}
