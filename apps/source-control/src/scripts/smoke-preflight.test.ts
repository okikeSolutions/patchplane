import { describe, expect, it } from 'vitest'
import {
  formatSmokePreflightSummary,
  inspectSmokePreflight,
} from './smoke-preflight'
import { runSmokePreflightCli } from './smoke-preflight-cli'

const trustLoopEnvironment = {
  CONVEX_URL: 'https://example.convex.cloud',
  PATCHPLANE_SYSTEM_INGESTION_SECRET: 'system-secret-value',
  GITHUB_APP_ID: '1234',
  GITHUB_PRIVATE_KEY: 'private-key-value',
  GITHUB_WEBHOOK_SECRET: 'webhook-secret-value',
  PATCHPLANE_SMOKE_REPOSITORY_FULL_NAME: 'patchplane/example',
  PATCHPLANE_TRUST_LOOP_WEBHOOK_URL:
    'https://patchplane.example/api/github/webhook',
}

describe('smoke startup preflight', () => {
  it('accepts a fresh trust loop with a configured webhook URL', () => {
    const summary = inspectSmokePreflight('trust-loop', trustLoopEnvironment)

    expect(summary.ok).toBe(true)
    expect(summary.mode).toBe('fresh')
    expect(summary.webhookResolution).toBe('configured')
    expect(summary.checks.map(({ id }) => id)).not.toContain(
      'cloudflare-api-token',
    )
  })

  it('requires Cloudflare lookup inputs only when the webhook URL is absent', () => {
    const { PATCHPLANE_TRUST_LOOP_WEBHOOK_URL: _, ...withoutWebhook } =
      trustLoopEnvironment
    const missing = inspectSmokePreflight('trust-loop', withoutWebhook)

    expect(missing.ok).toBe(false)
    expect(missing.webhookResolution).toBe('cloudflare-lookup')
    expect(missing.missingVariables).toEqual([
      'CLOUDFLARE_ACCOUNT_ID',
      'CLOUDFLARE_API_TOKEN',
    ])

    const complete = inspectSmokePreflight('trust-loop', {
      ...withoutWebhook,
      CLOUDFLARE_ACCOUNT_ID: 'account-id',
      CLOUDFLARE_API_TOKEN: 'cloudflare-secret-value',
    })
    expect(complete.ok).toBe(true)
  })

  it('uses the minimal read-only requirements in post-decision mode', () => {
    const summary = inspectSmokePreflight('trust-loop', {
      VITE_CONVEX_URL: 'https://example.convex.cloud',
      PATCHPLANE_SYSTEM_INGESTION_SECRET: 'system-secret-value',
      PATCHPLANE_SMOKE_WORKFLOW_RUN_ID: 'workflow-123',
      GITHUB_APP_ID: '1234',
      GITHUB_PRIVATE_KEY: 'private-key-value',
      GITHUB_WEBHOOK_SECRET: 'webhook-secret-value',
    })

    expect(summary.ok).toBe(true)
    expect(summary.mode).toBe('post-decision')
    expect(summary.webhookResolution).toBe('not-applicable')
    expect(summary.checks.map(({ id }) => id)).toEqual([
      'convex-url',
      'system-ingestion-secret',
      'github-app-id',
      'github-private-key',
      'github-webhook-secret',
      'workflow-run',
    ])
  })

  it('rejects credential-bearing or insecure non-loopback webhook URLs', () => {
    for (const webhookUrl of [
      'https://user:password@patchplane.example/api/github/webhook',
      'https://patchplane.example/api/github/webhook?token=value',
      'http://patchplane.example/api/github/webhook',
    ]) {
      const summary = inspectSmokePreflight('trust-loop', {
        ...trustLoopEnvironment,
        PATCHPLANE_TRUST_LOOP_WEBHOOK_URL: webhookUrl,
      })
      expect(summary.ok).toBe(false)
      expect(summary.invalidVariables).toContain(
        'PATCHPLANE_TRUST_LOOP_WEBHOOK_URL',
      )
    }

    expect(
      inspectSmokePreflight('trust-loop', {
        ...trustLoopEnvironment,
        PATCHPLANE_TRUST_LOOP_WEBHOOK_URL:
          'http://127.0.0.1:8787/api/github/webhook',
      }).ok,
    ).toBe(true)
  })

  it('validates values locally and reports variable names without values', () => {
    const summary = inspectSmokePreflight('trust-loop', {
      ...trustLoopEnvironment,
      CONVEX_URL: 'not-a-url',
      PATCHPLANE_SMOKE_REPOSITORY_FULL_NAME: 'not-a-repository',
      PATCHPLANE_SMOKE_PULL_REQUEST_NUMBER: 'zero',
    })
    const output = formatSmokePreflightSummary(summary)

    expect(summary.ok).toBe(false)
    expect(summary.invalidVariables).toEqual([
      'CONVEX_URL',
      'PATCHPLANE_SMOKE_REPOSITORY_FULL_NAME',
      'PATCHPLANE_SMOKE_PULL_REQUEST_NUMBER',
    ])
    for (const secret of [
      'system-secret-value',
      'private-key-value',
      'webhook-secret-value',
    ]) {
      expect(output).not.toContain(secret)
    }
  })

  it('validates the deployed Convex and sandbox path without local provider credentials', () => {
    const summary = inspectSmokePreflight('convex-sandbox', {
      ...trustLoopEnvironment,
      DAYTONA_API_KEY: undefined,
      OPENAI_API_KEY: undefined,
    })

    expect(summary.ok).toBe(true)
    expect(summary.mode).toBe('fresh')
    expect(summary.webhookResolution).toBe('configured')
    expect(summary.checks.map(({ id }) => id)).not.toContain('provider-api-key')
    expect(summary.checks.map(({ id }) => id)).not.toContain('daytona-api-key')
  })

  it('rejects stale post-decision controls for the Convex sandbox smoke', () => {
    const summary = inspectSmokePreflight('convex-sandbox', {
      ...trustLoopEnvironment,
      PATCHPLANE_SMOKE_WORKFLOW_RUN_ID: 'old-workflow',
      PATCHPLANE_SMOKE_REPLAY_PUBLICATION: 'true',
      PATCHPLANE_SMOKE_REQUIRE_HUMAN_DECISION: 'false',
    })

    expect(summary.ok).toBe(false)
    expect(summary.invalidVariables).toEqual([
      'PATCHPLANE_SMOKE_WORKFLOW_RUN_ID',
      'PATCHPLANE_SMOKE_REPLAY_PUBLICATION',
      'PATCHPLANE_SMOKE_REQUIRE_HUMAN_DECISION',
    ])
  })

  it('requires the production intake inputs for the Convex sandbox smoke', () => {
    const summary = inspectSmokePreflight('convex-sandbox', {
      CONVEX_URL: 'https://example.convex.cloud',
      PATCHPLANE_SYSTEM_INGESTION_SECRET: 'system-secret-value',
    })

    expect(summary.ok).toBe(false)
    expect(summary.missingVariables).toContain('GITHUB_APP_ID')
    expect(summary.missingVariables).toContain(
      'PATCHPLANE_SMOKE_REPOSITORY_FULL_NAME',
    )
  })

  it('returns a machine-readable CLI summary and failure status', () => {
    const result = runSmokePreflightCli(['trust-loop'], {})
    const output: unknown = JSON.parse(result.output)

    expect(result.exitCode).toBe(1)
    expect(output).toMatchObject({
      type: 'smoke_preflight_summary',
      target: 'trust-loop',
      ok: false,
    })
  })

  it('rejects unknown CLI targets without inspecting the environment', () => {
    const result = runSmokePreflightCli(['unknown'], {
      SECRET: 'must-not-appear',
    })

    expect(result.exitCode).toBe(2)
    expect(result.output).not.toContain('must-not-appear')
    expect(JSON.parse(result.output)).toMatchObject({
      type: 'smoke_preflight_usage_error',
      ok: false,
    })
  })
})
