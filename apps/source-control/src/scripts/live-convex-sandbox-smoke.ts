#!/usr/bin/env bun
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import {
  formatSmokePreflightSummary,
  inspectSmokePreflight,
} from './smoke-preflight'

export function convexSandboxChildEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
) {
  const childEnvironment = { ...environment }
  delete childEnvironment.PATCHPLANE_SMOKE_WORKFLOW_RUN_ID
  delete childEnvironment.PATCHPLANE_SMOKE_REPLAY_PUBLICATION
  delete childEnvironment.PATCHPLANE_SMOKE_REQUIRE_HUMAN_DECISION
  return childEnvironment
}

function main() {
  const summary = inspectSmokePreflight('convex-sandbox', process.env)
  console.log(formatSmokePreflightSummary(summary))

  if (!summary.ok) {
    console.log(
      JSON.stringify({
        type: 'convex_sandbox_smoke_summary',
        ok: false,
        phase: 'preflight',
      }),
    )
    return 1
  }

  console.log(
    JSON.stringify({
      type: 'convex_sandbox_smoke_started',
      path: 'github-webhook-to-convex-to-daytona-pi',
    }),
  )

  const result = spawnSync(
    process.execPath,
    [
      resolve(import.meta.dirname, 'live-trust-loop-smoke.ts'),
      '--review-ready-only',
    ],
    {
      env: convexSandboxChildEnvironment(process.env),
      stdio: 'inherit',
    },
  )
  const exitCode = result.status ?? 1

  console.log(
    JSON.stringify({
      type: 'convex_sandbox_smoke_summary',
      ok: exitCode === 0,
      phase: exitCode === 0 ? 'review-ready' : 'execution',
    }),
  )
  return exitCode
}

if (import.meta.main) {
  process.exitCode = main()
}
