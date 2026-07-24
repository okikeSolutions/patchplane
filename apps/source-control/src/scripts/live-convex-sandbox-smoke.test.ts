import { describe, expect, it } from 'vitest'
import { convexSandboxChildEnvironment } from './live-convex-sandbox-smoke'

describe('Convex sandbox smoke isolation', () => {
  it('removes stale post-decision and partial-mode controls from the child', () => {
    expect(
      convexSandboxChildEnvironment({
        CONVEX_URL: 'https://example.convex.cloud',
        PATCHPLANE_SMOKE_WORKFLOW_RUN_ID: 'old-workflow',
        PATCHPLANE_SMOKE_REPLAY_PUBLICATION: 'true',
        PATCHPLANE_SMOKE_REQUIRE_HUMAN_DECISION: 'false',
      }),
    ).toEqual({ CONVEX_URL: 'https://example.convex.cloud' })
  })
})
