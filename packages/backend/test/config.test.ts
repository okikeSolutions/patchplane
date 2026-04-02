import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import { BackendConfig, BackendConfigLive } from '../src/config/schema'
import { BackendConfigFailure } from '../src/errors'

const backendEnvKeys = [
  'GITHUB_APP_ID',
  'GITHUB_APP_PRIVATE_KEY',
  'GITHUB_WEBHOOK_SECRET',
  'PATCHPLANE_GITHUB_EXECUTION_TARGET_ID',
  'PATCHPLANE_GITHUB_POLICY_BUNDLE_ID',
  'GITHUB_API_BASE_URL',
  'PATCHPLANE_PI_COMMAND',
  'PATCHPLANE_RUNTIME_ENV_FORWARD_KEYS',
  'PATCHPLANE_SANDBOX_TIMEOUT_MS',
  'DAYTONA_API_KEY',
  'DAYTONA_API_URL',
  'DAYTONA_TARGET',
  'PATCHPLANE_DAYTONA_AUTO_STOP_MINUTES',
  'PATCHPLANE_DAYTONA_EPHEMERAL',
  'PATCHPLANE_REQUIRED_REVIEWERS',
  'PATCHPLANE_MINIMUM_REVIEW_SCORE',
] as const

let envSnapshot = new Map<string, string | undefined>()

function restoreEnv() {
  for (const envKey of backendEnvKeys) {
    const value = envSnapshot.get(envKey)

    if (value === undefined) {
      delete process.env[envKey]
    } else {
      process.env[envKey] = value
    }
  }
}

function configureValidEnv(overrides: Partial<Record<(typeof backendEnvKeys)[number], string>> = {}) {
  process.env.GITHUB_APP_ID = '1'
  process.env.GITHUB_APP_PRIVATE_KEY = 'test-private-key'
  process.env.GITHUB_WEBHOOK_SECRET = 'test-webhook-secret'
  process.env.PATCHPLANE_GITHUB_EXECUTION_TARGET_ID = 'github.issue_comment'
  process.env.PATCHPLANE_GITHUB_POLICY_BUNDLE_ID = 'default'
  process.env.PATCHPLANE_PI_COMMAND = 'pi-coding-agent'
  process.env.PATCHPLANE_RUNTIME_ENV_FORWARD_KEYS = 'OPENAI_API_KEY'
  process.env.PATCHPLANE_SANDBOX_TIMEOUT_MS = '300000'
  process.env.PATCHPLANE_DAYTONA_AUTO_STOP_MINUTES = '15'
  process.env.PATCHPLANE_DAYTONA_EPHEMERAL = 'true'
  process.env.PATCHPLANE_REQUIRED_REVIEWERS = 'quality'
  process.env.PATCHPLANE_MINIMUM_REVIEW_SCORE = '0.8'

  for (const [envKey, value] of Object.entries(overrides)) {
    process.env[envKey] = value
  }
}

async function loadBackendConfig() {
  return Effect.runPromise(
    Effect.gen(function* () {
      return yield* BackendConfig
    }).pipe(Effect.provide(BackendConfigLive)),
  )
}

describe('BackendConfigLive', () => {
  beforeEach(() => {
    envSnapshot = new Map(backendEnvKeys.map((envKey) => [envKey, process.env[envKey]]))
  })

  afterEach(() => {
    restoreEnv()
  })

  test('fails with a typed config error instead of a defect', async () => {
    configureValidEnv({ GITHUB_APP_ID: 'not-a-number' })

    const result = await Effect.runPromise(
      Effect.either(
        Effect.gen(function* () {
          return yield* BackendConfig
        }).pipe(Effect.provide(BackendConfigLive)),
      ),
    )

    expect(result._tag).toBe('Left')
    if (result._tag !== 'Left') {
      throw new Error('Expected config loading to fail.')
    }

    expect(result.left).toBeInstanceOf(BackendConfigFailure)
    expect(result.left.issues.length).toBeGreaterThan(0)
  })

  test('reads environment values each time the layer is provided', async () => {
    configureValidEnv({ GITHUB_APP_ID: '7' })
    const first = await loadBackendConfig()

    configureValidEnv({ GITHUB_APP_ID: '42' })
    const second = await loadBackendConfig()

    expect(first.github.appId).toBe(7)
    expect(second.github.appId).toBe(42)
  })
})
