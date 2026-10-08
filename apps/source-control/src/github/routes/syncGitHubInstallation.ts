import { Config, Effect, Exit, Redacted, Schema } from 'effect'
import { SourceControlService } from '@patchplane/core/services/source-control-service'
import { canonicalizeGitHubInstallationSyncProof } from '@patchplane/domain/github'
import {
  SourceControlWorkerRequestError,
  syncInstallationRequestSchema,
  jsonResponse,
  readBoundedJson,
} from './support'

export const syncGitHubInstallation = Effect.fnUntraced(function* (
  request: Request,
) {
  const inputExit = yield* readBoundedJson(request).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(syncInstallationRequestSchema)),
    Effect.exit,
  )
  if (Exit.isFailure(inputExit)) {
    return jsonResponse(
      { ok: false, error: 'Invalid installation sync request' },
      { status: 400 },
    )
  }
  const input = inputExit.value

  const sourceControl = yield* SourceControlService
  yield* sourceControl.verifyGitHubInstallationOwnership({
    provider: 'github',
    installationId: input.installationId,
    authorizationCode: input.authorizationCode,
    pkceVerifier: input.pkceVerifier,
  })
  const account = yield* sourceControl.getInstallationAccount({
    provider: 'github',
    installationId: input.installationId,
  })
  const repositories = yield* sourceControl.listInstallationRepositories({
    provider: 'github',
    installationId: input.installationId,
  })
  if (
    account.provider !== 'github' ||
    account.installationId !== input.installationId ||
    repositories.length > 1_000
  ) {
    return yield* new SourceControlWorkerRequestError({
      message: 'GitHub returned an invalid installation inventory',
    })
  }
  const projectedRepositories = yield* Effect.forEach(
    repositories,
    (repository) => {
      if (
        repository.provider !== 'github' ||
        repository.installationId !== input.installationId ||
        repository.repositoryExternalId === undefined ||
        repository.repositoryExternalId.length === 0 ||
        repository.private === undefined
      ) {
        return Effect.fail(
          new SourceControlWorkerRequestError({
            message: 'GitHub returned invalid repository identity metadata',
            cause: repository,
          }),
        )
      }
      return Effect.succeed({
        provider: 'github' as const,
        installationId: repository.installationId,
        repositoryExternalId: repository.repositoryExternalId,
        repositoryOwner: repository.owner,
        repositoryName: repository.name,
        repositoryFullName: repository.fullName,
        private: repository.private,
        selected: true,
      })
    },
  )

  const projectedAccount = {
    provider: 'github' as const,
    installationId: account.installationId,
    accountExternalId: account.accountExternalId,
    accountLogin: account.accountLogin,
    ...(account.accountType === undefined
      ? {}
      : { accountType: account.accountType }),
  }
  const issuedAt = yield* Effect.sync(Date.now)
  const systemSecret = yield* Config.Redacted(
    'PATCHPLANE_SYSTEM_INGESTION_SECRET',
  )
  const signature = yield* Effect.tryPromise({
    try: async () => {
      const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(Redacted.value(systemSecret)),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      )
      const bytes = await crypto.subtle.sign(
        'HMAC',
        key,
        new TextEncoder().encode(
          canonicalizeGitHubInstallationSyncProof({
            issuedAt,
            workspaceId: input.workspaceId,
            account: projectedAccount,
            repositories: projectedRepositories,
          }),
        ),
      )
      return Array.from(new Uint8Array(bytes), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('')
    },
    catch: (cause) =>
      new SourceControlWorkerRequestError({
        message: 'Failed to authenticate GitHub installation sync result',
        cause,
      }),
  })

  return jsonResponse({
    account: projectedAccount,
    repositories: projectedRepositories,
    proof: { issuedAt, signature },
  })
})
