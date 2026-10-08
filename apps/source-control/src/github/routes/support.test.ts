import { describe, expect, it } from 'vitest'
import { makeWorkspaceId } from '@patchplane/domain/ids'
import {
  isPatchPlaneResultComment,
  resolveGitHubWebhookWorkspace,
} from './support'

describe('resolveGitHubWebhookWorkspace', () => {
  it('uses the workspace attached to a known connected repository', () => {
    expect(
      resolveGitHubWebhookWorkspace({
        repositoryFullName: 'patchplane/demo',
        fallbackWorkspaceId: makeWorkspaceId('workos:org_fallback'),
        repositoryAllowlist: new Set(),
        hostedRoute: {
          workspaceId: makeWorkspaceId('workos:org_connected'),
        },
      }),
    ).toEqual({
      workspaceId: 'workos:org_connected',
      ignoredReason: undefined,
    })
  })

  it('ignores repositories with no connection or allowlist entry', () => {
    expect(
      resolveGitHubWebhookWorkspace({
        repositoryFullName: 'patchplane/demo',
        fallbackWorkspaceId: makeWorkspaceId('workos:org_fallback'),
        repositoryAllowlist: new Set(),
        hostedRoute: null,
      }),
    ).toEqual({
      workspaceId: undefined,
      ignoredReason: 'unconnected_repository',
    })
  })

  it('uses the configured fallback for a case-insensitive self-hosted allowlist entry', () => {
    expect(
      resolveGitHubWebhookWorkspace({
        repositoryFullName: 'PatchPlane/Demo',
        fallbackWorkspaceId: makeWorkspaceId('workos:org_fallback'),
        repositoryAllowlist: new Set(['patchplane/demo']),
        hostedRoute: null,
      }),
    ).toEqual({
      workspaceId: 'workos:org_fallback',
      ignoredReason: undefined,
    })
  })
})

describe('isPatchPlaneResultComment', () => {
  it('recognizes each published result comment shape', () => {
    const publishedComments = [
      ['github.issue_comment.created', 'PatchPlane sandbox run failed.'],
      ['github.pull_request_comment.created', 'PatchPlane sandbox run passed.'],
      ['github.issue_comment.created', '## PatchPlane Patch Report'],
      ['github.pull_request_comment.created', '## PatchPlane Decision Update'],
    ] as const

    for (const [eventKind, prompt] of publishedComments) {
      expect(isPatchPlaneResultComment({ eventKind, prompt })).toBe(true)
    }
  })

  it('does not hide ordinary comments or spoofed event kinds', () => {
    const unrelatedComments = [
      ['github.pull_request_comment.created', 'Please review this change.'],
      ['github.pull_request.synchronize', 'PatchPlane sandbox run failed.'],
      [undefined, 'PatchPlane sandbox run failed.'],
    ] as const

    for (const [eventKind, prompt] of unrelatedComments) {
      expect(isPatchPlaneResultComment({ eventKind, prompt })).toBe(false)
    }
  })
})
