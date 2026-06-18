import { Config } from 'effect'

export const DAYTONA_DEFAULT_COMMAND = 'bun run typecheck'
export const DAYTONA_DEFAULT_COMMAND_TIMEOUT_SECONDS = 120
export const DAYTONA_DEFAULT_AUTO_STOP_MINUTES = 5
export const DAYTONA_DEFAULT_AUTO_ARCHIVE_MINUTES = 0
export const DAYTONA_DEFAULT_DELETE_TIMEOUT_SECONDS = 120
export const DAYTONA_DEFAULT_DELETE_RETRY_ATTEMPTS = 2
export const DAYTONA_DEFAULT_PI_CLI_VERSION = '0.79.6'

export const DaytonaConfig = Config.all({
  apiKey: Config.redacted('DAYTONA_API_KEY'),
  apiUrl: Config.option(Config.string('DAYTONA_API_URL')),
  target: Config.option(Config.string('DAYTONA_TARGET')),
})

export type DaytonaConfig = typeof DaytonaConfig extends Config.Config<infer A>
  ? A
  : never
