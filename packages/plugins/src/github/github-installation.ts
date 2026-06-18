import { Effect } from 'effect'
import { SourceControlError } from '@patchplane/domain/errors'

export function parseGitHubInstallationId(input: {
  readonly provider: string
  readonly installationId?: string
}) {
  if (input.provider !== 'github') {
    return Effect.fail(
      new SourceControlError({
        operation: 'GitHubProviderPlugin.parseGitHubInstallationId',
        message: `Unsupported source-control provider: ${input.provider}`,
        cause: input,
      }),
    )
  }

  if (input.installationId === undefined) {
    return Effect.fail(
      new SourceControlError({
        operation: 'GitHubProviderPlugin.parseGitHubInstallationId',
        message: 'GitHub operations require an installation id',
        cause: input,
      }),
    )
  }

  const installationId = Number(input.installationId)
  if (!Number.isSafeInteger(installationId) || installationId <= 0) {
    return Effect.fail(
      new SourceControlError({
        operation: 'GitHubProviderPlugin.parseGitHubInstallationId',
        message: 'GitHub operation received an invalid installation id',
        cause: input,
      }),
    )
  }

  return Effect.succeed(installationId)
}
