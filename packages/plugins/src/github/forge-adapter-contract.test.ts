import { describe, expect, it } from '@effect/vitest'
import { Clock, Duration, Effect, Fiber, Layer } from 'effect'
import type * as CryptoError from 'effect/crypto/CryptoError'
import * as Mac from 'effect/crypto/Mac'
import * as SecureRandom from 'effect/crypto/SecureRandom'
import * as Redacted from 'effect/Redacted'
import * as TestClock from 'effect/testing/TestClock'
import { ForgeAdapter } from '@patchplane/core'
import {
  canApproveWithRepositoryPermission,
  ChangeRequestId,
  DeliveryId,
  type ForgeAdapterError,
  ForgeInstallationId,
  ForgeInstanceId,
  ForgeProviderId,
  ForgeUserLogin,
  ForgeWebhookVerificationError,
  GitCommitSha,
  RepositoryId,
  type RepositoryPermissionLevel,
  sanitizeErrorMessage,
} from '@patchplane/domain'
import {
  DEFAULT_GITHUB_INSTANCE_ID,
  GITHUB_FORGE_PROVIDER_ID,
  makeGitHubAppForgeAdapterLayer,
} from './github-app-forge-adapter'

const bytesToHex = (bytes: Uint8Array): string =>
  [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')

const MacLayer = Mac.layerWebCrypto.pipe(
  Layer.provide(SecureRandom.layerWebCrypto),
)

const REPO_ID = RepositoryId.make('okikeSolutions/patchplane')
const NESTED_REPO_ID = RepositoryId.make('group/subgroup/service')
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
    readonly layer: Layer.Layer<ForgeAdapter, ForgeAdapterError>
    readonly signWebhook: (
      rawBody: Uint8Array,
    ) => Effect.Effect<string, CryptoError.CryptoError, Mac.Mac>
  },
) {
  describe(`Provider-neutral ForgeAdapter contract (${suiteName})`, () => {
    it.effect(
      'declares instance & capabilities, verifies HMAC webhooks, mints Redacted installation tokens, checks repo authority, and fetches PR candidates',
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

            // 1) Explicit instance & capability declaration
            expect(forge.instanceId.length).toBeGreaterThan(0)
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

            // 3) Installation token wrapped in Redacted (never leaks in JSON)
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
              expect(auth.instanceId).toBe(forge.instanceId)
            }
            for (const login of ['triager', 'reader', 'outsider']) {
              const auth = yield* forge.checkRepositoryAuthority({
                repositoryId: REPO_ID,
                forgeUserLogin: ForgeUserLogin.make(login),
              })
              expect(auth.canApprove).toBe(false)
            }

            // 5) PR candidate includes instanceId, headSha, and fork identity
            const candidate = yield* forge.getPullRequestCandidate({
              repositoryId: NESTED_REPO_ID,
              pullNumber: 42,
            })
            expect(candidate.instanceId).toBe(forge.instanceId)
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
      )
      const tag = yield* mac.sign(key, rawBody)
      return `sha256=${bytesToHex(tag)}`
    }),
}))

// Synthetic non-GitHub forge proving provider-neutrality without shipping a live GitLab adapter
const GITEA_PROVIDER_ID = ForgeProviderId.make('gitea-contract-stub')
const GITEA_INSTANCE_ID = ForgeInstanceId.make('git.internal.example')
runForgeAdapterContractSuite('SyntheticNonGitHubForgeStub', (permissions) => ({
  layer: Layer.succeed(
    ForgeAdapter,
    ForgeAdapter.of({
      provider: GITEA_PROVIDER_ID,
      instanceId: GITEA_INSTANCE_ID,
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
          instanceId: GITEA_INSTANCE_ID,
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
          instanceId: GITEA_INSTANCE_ID,
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
    'fails cleanly on empty webhookSecret, never leaks ghs_ token on decode failure, accepts explicit forkRepositoryId: undefined, and enforces timeouts',
    () =>
      Effect.gen(function* () {
        // 1) Empty webhookSecret fails with typed ForgeAdapterError (no defect)
        const emptySecretLayer = makeGitHubAppForgeAdapterLayer({
          webhookSecret: Redacted.make(''),
          createInstallationToken: () => Effect.fail('unused'),
          getCollaboratorPermission: () => Effect.fail('unused'),
          getPullRequest: () => Effect.fail('unused'),
        }).pipe(Layer.provide(MacLayer))

        const secretErr = yield* Effect.flip(
          ForgeAdapter.pipe(Effect.provide(emptySecretLayer)),
        )
        expect(secretErr._tag).toBe('ForgeAdapterError')

        // 2) Live ghs_ token never leaks in ForgeAdapterError when schema decode fails
        const leakedSecret = 'ghs_LIVE_SECRET_SHOULD_NEVER_LEAK_999999'
        expect(sanitizeErrorMessage(`failed: ${leakedSecret}`)).not.toContain(
          leakedSecret,
        )

        const badTokenLayer = makeGitHubAppForgeAdapterLayer({
          webhookSecret: WEBHOOK_SECRET,
          timeoutMs: 2_000,
          createInstallationToken: () =>
            Effect.succeed({
              installationId: 'invalid/with/slash',
              token: leakedSecret,
              expiresAtMs: 999_999,
            }),
          getCollaboratorPermission: () => Effect.never,
          getPullRequest: () =>
            Effect.succeed({
              headSha: HEAD_SHA,
              isFork: false,
              forkRepositoryId: undefined,
            }),
        }).pipe(Layer.provide(MacLayer))

        yield* Effect.gen(function* () {
          const forge = yield* ForgeAdapter
          expect(forge.provider).toBe(GITHUB_FORGE_PROVIDER_ID)
          expect(forge.instanceId).toBe(DEFAULT_GITHUB_INSTANCE_ID)

          const badTokenErr = yield* Effect.flip(
            forge.getInstallationToken({ repositoryId: REPO_ID }),
          )
          expect(badTokenErr._tag).toBe('ForgeAdapterError')
          expect(badTokenErr.message).not.toContain(leakedSecret)

          // Explicit `forkRepositoryId: undefined` decodes cleanly
          const pr = yield* forge.getPullRequestCandidate({
            repositoryId: REPO_ID,
            pullNumber: 7,
          })
          expect(pr.isFork).toBe(false)
          expect(pr.forkRepositoryId).toBeUndefined()

          const badPrefix = yield* Effect.flip(
            forge.verifyWebhookSignature({
              rawBody: new Uint8Array([1, 2, 3]),
              signatureHeader: 'sha1=deadbeef',
              deliveryId: DELIVERY_ID,
            }),
          )
          expect(badPrefix._tag).toBe('ForgeWebhookVerificationError')

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
        }).pipe(Effect.provide(badTokenLayer))
      }),
  )
})
