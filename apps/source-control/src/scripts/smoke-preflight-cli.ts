#!/usr/bin/env bun
import {
  formatSmokePreflightSummary,
  inspectSmokePreflight,
  type SmokePreflightTarget,
} from './smoke-preflight'

export interface SmokePreflightCliResult {
  readonly exitCode: number
  readonly output: string
}

function isTarget(value: string | undefined): value is SmokePreflightTarget {
  return value === 'trust-loop' || value === 'convex-sandbox'
}

/** Run the preflight CLI without writing output or mutating process state. */
export function runSmokePreflightCli(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): SmokePreflightCliResult {
  const target = argv[0]
  if (!isTarget(target) || argv.length !== 1) {
    return {
      exitCode: 2,
      output: JSON.stringify({
        type: 'smoke_preflight_usage_error',
        ok: false,
        acceptedTargets: ['trust-loop', 'convex-sandbox'],
      }),
    }
  }

  const summary = inspectSmokePreflight(target, env)
  return {
    exitCode: summary.ok ? 0 : 1,
    output: formatSmokePreflightSummary(summary),
  }
}

if (import.meta.main) {
  const result = runSmokePreflightCli(process.argv.slice(2), process.env)
  console.log(result.output)
  process.exitCode = result.exitCode
}
