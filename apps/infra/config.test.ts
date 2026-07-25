import { Config, ConfigProvider, Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { clientAssetConfig, sourceControlRuntimeEnv } from './config'

const loadGitHubWorkspaceId = (env: Record<string, string>) =>
  Effect.runPromise(
    Config.all({
      workspaceId: sourceControlRuntimeEnv.PATCHPLANE_GITHUB_WORKSPACE_ID,
    }).pipe(
      Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
    ),
  )

describe('clientAssetConfig', () => {
  it('serves static assets directly while routing API requests through the Worker', () => {
    expect(clientAssetConfig.runWorkerFirst).toEqual(['/api/*'])
  })
})

describe('sourceControlRuntimeEnv', () => {
  it('allows the WorkOS organization fallback when no explicit GitHub workspace override exists', async () => {
    await expect(loadGitHubWorkspaceId({})).resolves.toEqual({ workspaceId: '' })
  })

  it('preserves an explicit Patchplane workspace override', async () => {
    await expect(loadGitHubWorkspaceId({
      PATCHPLANE_GITHUB_WORKSPACE_ID: 'system:self-hosted',
    })).resolves.toEqual({ workspaceId: 'system:self-hosted' })
  })
})
