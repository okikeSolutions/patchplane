import { describe, expect, it } from '@effect/vitest'
import { Effect, Exit, Layer } from 'effect'
import { SourceControlService } from '@patchplane/core/services/source-control-service'
import { syncGitHubInstallation } from './syncGitHubInstallation'

process.env.PATCHPLANE_SYSTEM_INGESTION_SECRET = 'system_test'

const sourceControlService = SourceControlService.of({
  verifyRepositoryAccess: () => Effect.die('unused'),
  getInstallationAccount: (input) =>
    Effect.succeed({
      provider: 'github',
      installationId: input.installationId ?? 'missing',
      accountExternalId: 'account-1',
      accountLogin: 'patchplane',
      accountType: 'Organization',
    }),
  verifyGitHubInstallationOwnership: () => Effect.void,
  listInstallationRepositories: (input) =>
    Effect.succeed([
      {
        provider: 'github',
        installationId: input.installationId ?? 'missing',
        owner: 'patchplane',
        name: 'repo',
        fullName: 'patchplane/repo',
        repositoryExternalId: 'repository-1',
        private: true,
      },
    ]),
  createIssueComment: () => Effect.die('unused'),
  createCheckRun: () => Effect.die('unused'),
  createDraftPullRequest: () => Effect.die('unused'),
  createRepositoryCloneCredentials: () => Effect.die('unused'),
  fetchImmutableComparison: () => Effect.die('unused'),
})

const SourceControlTestLayer = Layer.succeed(
  SourceControlService,
  sourceControlService,
)

describe('syncGitHubInstallation', () => {
  it.effect('runs the complete installation projection as one Effect', () =>
    Effect.gen(function* () {
      const request = new Request('https://source-control.test/install/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          installationId: '123',
          workspaceId: 'system:workspace-1',
          authorizationCode: 'code_123',
          pkceVerifier: 'v'.repeat(64),
        }),
      })

      const response = yield* syncGitHubInstallation(request).pipe(
        Effect.provide(SourceControlTestLayer),
      )
      const body = yield* Effect.tryPromise(() => response.json()).pipe(
        Effect.orDie,
      )

      expect(response.status).toBe(200)
      expect(body).toMatchObject({
        account: {
          provider: 'github',
          installationId: '123',
          accountExternalId: 'account-1',
          accountLogin: 'patchplane',
          accountType: 'Organization',
        },
        repositories: [
          {
            provider: 'github',
            installationId: '123',
            repositoryExternalId: 'repository-1',
            repositoryOwner: 'patchplane',
            repositoryName: 'repo',
            repositoryFullName: 'patchplane/repo',
            private: true,
            selected: true,
          },
        ],
      })
      expect(body.proof.issuedAt).toEqual(expect.any(Number))
      expect(body.proof.signature).toMatch(/^[0-9a-f]{64}$/)
    }),
  )

  it.effect('fails closed on incomplete repository identity metadata', () => {
    const invalidLayer = Layer.succeed(
      SourceControlService,
      SourceControlService.of({
        ...sourceControlService,
        listInstallationRepositories: () =>
          Effect.succeed([
            {
              provider: 'github',
              installationId: '123',
              owner: 'patchplane',
              name: 'repo',
              fullName: 'patchplane/repo',
            },
          ]),
      }),
    )
    const request = new Request('https://source-control.test/install/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        installationId: '123',
        workspaceId: 'system:workspace-1',
        authorizationCode: 'code_123',
        pkceVerifier: 'v'.repeat(64),
      }),
    })

    return syncGitHubInstallation(request).pipe(
      Effect.provide(invalidLayer),
      Effect.exit,
      Effect.map((exit) => expect(Exit.isFailure(exit)).toBe(true)),
    )
  })
})
