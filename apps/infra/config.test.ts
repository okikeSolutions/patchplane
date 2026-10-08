import { Config, ConfigProvider, Effect } from 'effect'
import { describe, expect } from 'vitest'
import { it } from '@effect/vitest'
import { sourceControlRuntimeEnv } from './config'

const loadGitHubWorkspaceId = (env: Record<string, string>) =>
  Config.all({
    workspaceId: sourceControlRuntimeEnv.PATCHPLANE_GITHUB_WORKSPACE_ID,
  }).pipe(
    Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
  )

describe('sourceControlRuntimeEnv', () => {
  it.effect(
    'allows the WorkOS organization fallback when no explicit GitHub workspace override exists',
    () =>
      Effect.gen(function* () {
        expect(yield* loadGitHubWorkspaceId({})).toEqual({ workspaceId: '' })
      }),
  )

  it.effect('preserves an explicit Patchplane workspace override', () =>
    Effect.gen(function* () {
      expect(
        yield* loadGitHubWorkspaceId({
          PATCHPLANE_GITHUB_WORKSPACE_ID: 'system:self-hosted',
        }),
      ).toEqual({ workspaceId: 'system:self-hosted' })
    }),
  )
})
