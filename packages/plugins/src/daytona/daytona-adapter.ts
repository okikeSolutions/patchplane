import { Option, Redacted } from 'effect'
import {
  DAYTONA_DEFAULT_AUTO_ARCHIVE_MINUTES,
  DAYTONA_DEFAULT_AUTO_STOP_MINUTES,
  type DaytonaConfig,
} from './DaytonaConfig'

export function toDaytonaClientConfig(config: DaytonaConfig) {
  return {
    apiKey: Redacted.value(config.apiKey),
    ...(Option.isSome(config.apiUrl) ? { apiUrl: config.apiUrl.value } : {}),
    ...(Option.isSome(config.target) ? { target: config.target.value } : {}),
  }
}

export function toDaytonaCreateSandboxParams(_config: DaytonaConfig, input: {
  readonly traceId: string
  readonly repositoryFullName: string
}) {
  return {
    language: 'typescript',
    ephemeral: true,
    autoStopInterval: DAYTONA_DEFAULT_AUTO_STOP_MINUTES,
    autoArchiveInterval: DAYTONA_DEFAULT_AUTO_ARCHIVE_MINUTES,
    labels: {
      app: 'patchplane',
      traceId: input.traceId,
      repository: input.repositoryFullName,
    },
  }
}
