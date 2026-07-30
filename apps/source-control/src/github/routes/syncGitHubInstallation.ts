import { Effect, Exit, Schema } from 'effect'
import { SourceControlService } from '@patchplane/core/services/source-control-service'
import {
  type SourceControlRuntime,
  SourceControlWorkerRequestError,
  syncInstallationRequestSchema,
  jsonResponse,
} from './support'

export async function syncGitHubInstallation(
  request: Request,
  runtime: SourceControlRuntime,
) {
  const inputExit = await runtime.runPromiseExit(
    Effect.tryPromise({
      try: () => request.json(),
      catch: (cause) =>
        new SourceControlWorkerRequestError({
          message: `Invalid JSON body: ${String(cause)}`,
        }),
    }).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(syncInstallationRequestSchema)),
    ),
  )
  if (Exit.isFailure(inputExit)) {
    return jsonResponse(
      { ok: false, error: 'Invalid installation sync request' },
      { status: 400 },
    )
  }
  const input = inputExit.value

  const result = await runtime.runPromise(
    Effect.gen(function* () {
      const sourceControl = yield* SourceControlService
      const account = yield* sourceControl.getInstallationAccount({
        provider: 'github',
        installationId: input.installationId,
      })
      const repositories = yield* sourceControl.listInstallationRepositories({
        provider: 'github',
        installationId: input.installationId,
      })
      return { account, repositories }
    }),
  )

  return jsonResponse({
    account: {
      provider: 'github',
      installationId: result.account.installationId,
      accountExternalId: result.account.accountExternalId,
      accountLogin: result.account.accountLogin,
      ...(result.account.accountType === undefined
        ? {}
        : { accountType: result.account.accountType }),
    },
    repositories: result.repositories.map((repository) => ({
      provider: 'github' as const,
      installationId: repository.installationId,
      repositoryExternalId:
        repository.repositoryExternalId ?? repository.fullName,
      repositoryOwner: repository.owner,
      repositoryName: repository.name,
      repositoryFullName: repository.fullName,
      private: repository.private ?? false,
      selected: true,
    })),
  })
}
