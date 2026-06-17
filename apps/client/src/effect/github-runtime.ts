import { ConvexStoragePlugin } from '@patchplane/plugins/convex/storage-plugin'
import { GitHubProviderPlugin } from '@patchplane/plugins/github/provider-plugin'
import { Layer, ManagedRuntime } from 'effect'
import { ObservabilityLayer } from './layers'

const githubRuntimeMemoMap = Layer.makeMemoMapUnsafe()

export const githubRuntime = ManagedRuntime.make(
  Layer.mergeAll(
    GitHubProviderPlugin.layer,
    ConvexStoragePlugin.layer,
    ObservabilityLayer,
  ),
  { memoMap: githubRuntimeMemoMap },
)

export function disposeGitHubRuntime() {
  return githubRuntime.dispose()
}
