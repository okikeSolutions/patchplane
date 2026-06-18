import type { EnvCheckResults } from '../services/env-file'

export function formatEnvCheckResults(results: EnvCheckResults) {
  return results.map((result) =>
    `${result.status.padEnd(7)} ${result.variable.name}${result.variable.defaultValue ? ` (default: ${result.variable.defaultValue})` : ''}`
  )
}
