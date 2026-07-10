// @vitest-environment jsdom

import { describe, expect, test, vi } from 'vitest'
import { githubWebhookGoneResponse, isPatchPlaneResultComment, resolveGitHubWebhookWorkspace } from './webhook'

describe('GitHub webhook route', () => {
  test('keeps client API route closed because hosted webhooks use GitHubWebhookWorker', async () => {
    const response = githubWebhookGoneResponse()
    const body = await response.json()

    expect(response.status).toBe(410)
    expect(body).toEqual({
      ok: false,
      error: 'GitHub webhooks are handled by the dedicated GitHubWebhookWorker in hosted Cloudflare deployments',
    })
  })
})

describe('GitHub webhook route workspace resolution', () => {
  test('routes a known connected repository to the stored workspace', async () => {
    const lookupConnectedRepository = vi.fn().mockResolvedValue({
      workspaceId: 'workos:org_connected',
    })

    const result = await resolveGitHubWebhookWorkspace({
      installationId: 123,
      repositoryId: 456,
      repositoryFullName: 'patchplane/demo',
      fallbackWorkspaceId: 'workos:org_fallback',
      repositoryAllowlist: new Set(),
      lookupConnectedRepository,
    })

    expect(result).toEqual({
      workspaceId: 'workos:org_connected',
      ignoredReason: undefined,
    })
    expect(lookupConnectedRepository).toHaveBeenCalledOnce()
  })

  test('ignores unknown and unallowlisted repositories', async () => {
    const result = await resolveGitHubWebhookWorkspace({
      installationId: 123,
      repositoryId: 456,
      repositoryFullName: 'patchplane/demo',
      fallbackWorkspaceId: 'workos:org_fallback',
      repositoryAllowlist: new Set(),
      lookupConnectedRepository: vi.fn().mockResolvedValue(null),
    })

    expect(result).toEqual({
      workspaceId: undefined,
      ignoredReason: 'unconnected_repository',
    })
  })

  test('keeps env allowlist fallback for local self-hosted routing', async () => {
    const result = await resolveGitHubWebhookWorkspace({
      installationId: 123,
      repositoryId: 456,
      repositoryFullName: 'PatchPlane/Demo',
      fallbackWorkspaceId: 'workos:org_fallback',
      repositoryAllowlist: new Set(['patchplane/demo']),
      lookupConnectedRepository: vi.fn().mockResolvedValue(null),
    })

    expect(result).toEqual({
      workspaceId: 'workos:org_fallback',
      ignoredReason: undefined,
    })
  })
})

describe('GitHub webhook result-comment loop guard', () => {
  test('ignores PatchPlane issue and pull request result comments', () => {
    expect(isPatchPlaneResultComment({
      eventKind: 'github.issue_comment.created',
      prompt: 'PatchPlane sandbox run failed.\n\n- Workflow run: run_123',
    })).toBe(true)

    expect(isPatchPlaneResultComment({
      eventKind: 'github.pull_request_comment.created',
      prompt: 'PatchPlane sandbox run passed.\n\n- Workflow run: run_123',
    })).toBe(true)

    expect(isPatchPlaneResultComment({
      eventKind: 'github.issue_comment.created',
      prompt: '## PatchPlane Patch Report\n\n**Status:** verification passed',
    })).toBe(true)

    expect(isPatchPlaneResultComment({
      eventKind: 'github.pull_request_comment.created',
      prompt: '## PatchPlane Decision Update\n\n**Decision:** approved',
    })).toBe(true)
  })

  test('keeps non-PatchPlane comments eligible for workflow intake', () => {
    expect(isPatchPlaneResultComment({
      eventKind: 'github.pull_request_comment.created',
      prompt: 'Please review this change.',
    })).toBe(false)

    expect(isPatchPlaneResultComment({
      eventKind: 'github.pull_request.synchronize',
      prompt: 'PatchPlane sandbox run failed.',
    })).toBe(false)
  })
})
