import { describe, expect, it } from '@effect/vitest'
import { Clock, Duration, Effect, Fiber, Layer } from 'effect'
import * as Mac from 'effect/crypto/Mac'
import * as SecureRandom from 'effect/crypto/SecureRandom'
import * as Redacted from 'effect/Redacted'
import * as TestClock from 'effect/testing/TestClock'
import { ForgeAdapter } from '@patchplane/core'
import {
  canApproveWithRepositoryPermission,
  ChangeRequestId,
  DeliveryId,
  ForgeInstallationId,
  ForgeProviderId,
  ForgeUserLogin,
  ForgeWebhookVerificationError,
  GitCommitSha,
  RepositoryId,
  type RepositoryPermissionLevel,
} from '@patchplane/domain'
import {
  GITHUB_FORGE_PROVIDER_ID,
  makeGitHubAppForgeAdapterLayer,
} from './github-app-forge-adapter'

const bytesToHex = (bytes: Uint8Array): string =>
  [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')

const MacLayer = Mac.layerWebCrypto.pipe(
  Layer.provide(SecureRandom.layerWebCrypto),
)

const REPO_ID = RepositoryId.make('okikeSolutions/patchplane')
const FORK_REPO_ID = RepositoryId.make('externalContributor/patchplane')
const HEAD_SHA = GitCommitSha.make('a'.repeat(40))
const DELIVERY_ID = DeliveryId.make('delivery-forge-contract-1')

/**
 * Provider-neutral ForgeAdapter contract harness. Runs identical assertions
 * against the real GitHub App adapter and a non-GitHub stub adapter to prove
 * core authority and candidate logic has zero GitHub lock-in.
 */
function runForgeAdapterContractSuite(
  suiteName: string,
  buildFixture: (
    permissions: Readonly<Record<string, RepositoryPermissionLevel>>,
  ) => {
    readonly layer: Layer.Layer<ForgeAdapter>
    readonly signWebhook: (
      rawBody: Uint8Array,
    ) => Effect.Effect<string, never, Mac.Mac>
  },
) {
  describe(`Provider-neutral ForgeAdapter contract (${suiteName})`, () => {
    it.effect(
      'declares explicit capabilities, verifies HMAC webhooks, mints Redacted installation tokens, checks repo authority, and fetches PR candidates',
      () =>
        Effect.gen(function* () {
          const fixture = buildFixture({
            maintainer: 'maintain',
            writer: 'write',
            admin: 'admin',
            reader: 'read',
            triager: 'triage',
            outsider: 'none',
          })

          const body = new TextEncoder().encode(
            JSON.stringify({ action: 'synchronize', number: 42 }),
          )
          const validSig = yield* fixture.signWebhook(body)

          yield* Effect.gen(function* () {
            const forge = yield* ForgeAdapter

            // 1) Explicit capability declaration
            expect(forge.capabilities.supportsPullRequests).toBe(true)
            expect(forge.capabilities.supportsWebhooks).toBe(true)
            expect(forge.capabilities.supportsInstallationTokens).toBe(true)
            expect(forge.capabilities.supportsRepositoryPermissions).toBe(true)

            // 2) Webhook signature verification passes valid tag & rejects tampered body
            yield* forge.verifyWebhookSignature({
              rawBody: body,
              signatureHeader: validSig,
              deliveryId: DELIVERY_ID,
            })

            const tamperedErr = yield* Effect.flip(
              forge.verifyWebhookSignature({
                rawBody: new TextEncoder().encode('{"tampered":true}'),
                signatureHeader: validSig,
                deliveryId: DELIVERY_ID,
              }),
            )
            expect(tamperedErr._tag).toBe('ForgeWebhookVerificationError')

            // 3) Installation token wrapped in Redacted (never leaks in string form)
            const token = yield* forge.getInstallationToken({
              repositoryId: REPO_ID,
            })
            expect(JSON.stringify(token.token)).toBe('"<redacted>"')
            expect(Redacted.value(token.token).length).toBeGreaterThan(0)

            // 4) Repository authority strictly maps write/maintain/admin -> canApprove=true
            for (const login of ['admin', 'maintainer', 'writer']) {
              const auth = yield* forge.checkRepositoryAuthority({
                repositoryId: REPO_ID,
                forgeUserLogin: ForgeUserLogin.make(login),
              })
              expect(auth.canApprove).toBe(true)
            }
            for (const login of ['triage', 'reader', 'outsider']) {
              const mappedLogin = login === 'triage' ? 'triager' : login
              const auth = yield* forge.checkRepositoryAuthority({
                repositoryId: REPO_ID,
                forgeUserLogin: ForgeUserLogin.make(mappedLogin),
              })
              expect(auth.canApprove).toBe(false)
            }

            // 5) PR candidate includes headSha and fork identity
            const candidate = yield* forge.getPullRequestCandidate({
              repositoryId: REPO_ID,
              pullNumber: 42,
            })
            expect(candidate.headSha).toBe(HEAD_SHA)
            expect(candidate.isFork).toBe(true)
            expect(candidate.forkRepositoryId).toBe(FORK_REPO_ID)
          }).pipe(Effect.provide(fixture.layer))
        }).pipe(Effect.provide(MacLayer)),
    )
  })
}

const WEBHOOK_SECRET = Redacted.make('whsec_test_github_app_secret_0123456789')

runForgeAdapterContractSuite('GitHubAppForgeAdapter', (permissions) => ({
  layer: makeGitHubAppForgeAdapterLayer({
    webhookSecret: WEBHOOK_SECRET,
    createInstallationToken: () =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        return {
          installationId: 'gh-inst-9001',
          token: 'ghs_ephemeral_installation_token',
          expiresAtMs: now + 10 * 60 * 1000,
        }
      }),
    getCollaboratorPermission: ({ username }) =>
      Effect.succeed({
        installationId: 'gh-inst-9001',
        permission: permissions[username] ?? 'none',
      }),
    getPullRequest: () =>
      Effect.succeed({
        headSha: HEAD_SHA,
        isFork: true,
        forkRepositoryId: FORK_REPO_ID,
      }),
  }).pipe(Layer.provide(MacLayer)),
  signWebhook: (rawBody) =>
    Effect.gen(function* () {
      const mac = yield* Mac.Mac
      const key = yield* Mac.key(
        Mac.hmacSha256,
        new TextEncoder().encode(Redacted.value(WEBHOOK_SECRET)),
      ).pipe(Effect.orDie)
      const tag = yield* mac.sign(key, rawBody).pipe(Effect.orDie)
      return `sha256=${bytesToHex(tag)}`
    }),
}))

// Synthetic non-GitHub forge proving provider-neutrality without shipping a live GitLab adapter
const GITEA_PROVIDER_ID = ForgeProviderId.make('gitea-contract-stub')
runForgeAdapterContractSuite('SyntheticNonGitHubForgeStub', (permissions) => ({
  layer: Layer.succeed(
    ForgeAdapter,
    ForgeAdapter.of({
      provider: GITEA_PROVIDER_ID,
      capabilities: {
        supportsPullRequests: true,
        supportsWebhooks: true,
        supportsInstallationTokens: true,
        supportsRepositoryPermissions: true,
        supportsStatusChecks: false,
      },
      verifyWebhookSignature: ({ rawBody, signatureHeader }) =>
        signatureHeader === `stub:${rawBody.byteLength}`
          ? Effect.void
          : Effect.fail(
              new ForgeWebhookVerificationError({
                provider: GITEA_PROVIDER_ID,
                reason: 'Stub signature mismatch',
              }),
            ),
      getInstallationToken: () =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          return {
            installationId: ForgeInstallationId.make('gitea-inst-1'),
            token: Redacted.make('gitea_scoped_token'),
            expiresAtMs: now + 10 * 60 * 1000,
          }
        }),
      checkRepositoryAuthority: ({ repositoryId, forgeUserLogin }) => {
        const permission = permissions[forgeUserLogin] ?? 'none'
        return Effect.succeed({
          provider: GITEA_PROVIDER_ID,
          repositoryId,
          installationId: ForgeInstallationId.make('gitea-inst-1'),
          forgeUserLogin,
          permission,
          canApprove: canApproveWithRepositoryPermission(permission),
        })
      },
      getPullRequestCandidate: ({ repositoryId, pullNumber }) =>
        Effect.succeed({
          provider: GITEA_PROVIDER_ID,
          changeRequestId: ChangeRequestId.make(
            `gitea:${repositoryId}#${pullNumber}`,
          ),
          repositoryId,
          pullNumber,
          headSha: HEAD_SHA,
          isFork: true,
          forkRepositoryId: FORK_REPO_ID,
        }),
    }),
  ),
  signWebhook: (rawBody) => Effect.succeed(`stub:${rawBody.byteLength}`),
}))

describe('GitHubAppForgeAdapter negative edge cases', () => {
  it.effect(
    'rejects expired installation tokens, malformed signature headers, and port timeouts',
    () =>
      Effect.gen(function* () {
        const layer = makeGitHubAppForgeAdapterLayer({
          webhookSecret: WEBHOOK_SECRET,
          timeoutMs: 2_000,
          createInstallationToken: () =>
            Effect.succeed({
              installationId: 'gh-inst-9001',
              token: 'ghs_expired',
              expiresAtMs: 1,
            }),
          getCollaboratorPermission: () => Effect.never,
          getPullRequest: () => Effect.fail('unused'),
        }).pipe(Layer.provide(MacLayer))

        yield* Effect.gen(function* () {
          const forge = yield* ForgeAdapter
          expect(forge.provider).toBe(GITHUB_FORGE_PROVIDER_ID)

          const badPrefix = yield* Effect.flip(
            forge.verifyWebhookSignature({
              rawBody: new Uint8Array([1, 2, 3]),
              signatureHeader: 'sha1=deadbeef',
              deliveryId: DELIVERY_ID,
            }),
          )
          expect(badPrefix._tag).toBe('ForgeWebhookVerificationError')

          // Advance TestClock past 1ms so token is expired
          yield* TestClock.adjust(Duration.millis(100))
          const expiredToken = yield* Effect.flip(
            forge.getInstallationToken({ repositoryId: REPO_ID }),
          )
          expect(expiredToken._tag).toBe('ForgeAdapterError')

          const fiber = yield* Effect.forkChild(
            Effect.flip(
              forge.checkRepositoryAuthority({
                repositoryId: REPO_ID,
                forgeUserLogin: ForgeUserLogin.make('maintainer'),
              }),
            ),
          )
          yield* TestClock.adjust(Duration.millis(2_001))
          const timeoutErr = yield* Fiber.join(fiber)
          expect(timeoutErr._tag).toBe('ForgeAdapterError')
        }).pipe(Effect.provide(layer))
      }),
  )
})
