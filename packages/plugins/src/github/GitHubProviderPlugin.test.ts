import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { Effect } from 'effect'
import { App } from 'octokit'
import nock from 'nock'
import MockDate from 'mockdate'
import { GitHubWebhookService } from '@patchplane/core/services/github-webhook-service'
import { SourceControlService } from '@patchplane/core/services/source-control-service'
import { GitHubProviderPlugin } from './GitHubProviderPlugin'

const privateKey = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA1c7+9z5Pad7OejecsQ0bu3aozN3tihPmljnnudb9G3HECdnH
lWu2/a1gB9JW5TBQ+AVpum9Okx7KfqkfBKL9mcHgSL0yWMdjMfNOqNtrQqKlN4kE
p6RD++7sGbzbfZ9arwrlD/HSDAWGdGGJTSOBM6pHehyLmSC3DJoR/CTu0vTGTWXQ
rO64Z8tyXQPtVPb/YXrcUhbBp8i72b9Xky0fD6PkEebOy0Ip58XVAn2UPNlNOSPS
ye+Qjtius0Md4Nie4+X8kwVI2Qjk3dSm0sw/720KJkdVDmrayeljtKBx6AtNQsSX
gzQbeMmiqFFkwrG1+zx6E7H7jqIQ9B6bvWKXGwIDAQABAoIBAD8kBBPL6PPhAqUB
K1r1/gycfDkUCQRP4DbZHt+458JlFHm8QL6VstKzkrp8mYDRhffY0WJnYJL98tr4
4tohsDbqFGwmw2mIaHjl24LuWXyyP4xpAGDpl9IcusjXBxLQLp2m4AKXbWpzb0OL
Ulrfc1ZooPck2uz7xlMIZOtLlOPjLz2DuejVe24JcwwHzrQWKOfA11R/9e50DVse
hnSH/w46Q763y4I0E3BIoUMsolEKzh2ydAAyzkgabGQBUuamZotNfvJoDXeCi1LD
8yNCWyTlYpJZJDDXooBU5EAsCvhN1sSRoaXWrlMSDB7r/E+aQyKua4KONqvmoJuC
21vSKeECgYEA7yW6wBkVoNhgXnk8XSZv3W+Q0xtdVpidJeNGBWnczlZrummt4xw3
xs6zV+rGUDy59yDkKwBKjMMa42Mni7T9Fx8+EKUuhVK3PVQyajoyQqFwT1GORJNz
c/eYQ6VYOCSC8OyZmsBM2p+0D4FF2/abwSPMmy0NgyFLCUFVc3OECpkCgYEA5OAm
I3wt5s+clg18qS7BKR2DuOFWrzNVcHYXhjx8vOSWV033Oy3yvdUBAhu9A1LUqpwy
Ma+unIgxmvmUMQEdyHQMcgBsVs10dR/g2xGjMLcwj6kn+xr3JVIZnbRT50YuPhf+
ns1ScdhP6upo9I0/sRsIuN96Gb65JJx94gQ4k9MCgYBO5V6gA2aMQvZAFLUicgzT
u/vGea+oYv7tQfaW0J8E/6PYwwaX93Y7Q3QNXCoCzJX5fsNnoFf36mIThGHGiHY6
y5bZPPWFDI3hUMa1Hu/35XS85kYOP6sGJjf4kTLyirEcNKJUWH7CXY+00cwvTkOC
S4Iz64Aas8AilIhRZ1m3eQKBgQCUW1s9azQRxgeZGFrzC3R340LL530aCeta/6FW
CQVOJ9nv84DLYohTVqvVowdNDTb+9Epw/JDxtDJ7Y0YU0cVtdxPOHcocJgdUGHrX
ZcJjRIt8w8g/s4X6MhKasBYm9s3owALzCuJjGzUKcDHiO2DKu1xXAb0SzRcTzUCn
7daCswKBgQDOYPZ2JGmhibqKjjLFm0qzpcQ6RPvPK1/7g0NInmjPMebP0K6eSPx0
9/49J6WTD++EajN7FhktUSYxukdWaCocAQJTDNYP0K88G4rtC2IYy5JFn9SWz5oh
x//0u+zd/R/QRUzLOw4N72/Hu+UG6MNt5iDZFCtapRaKt6OvSBwy8w==
-----END RSA PRIVATE KEY-----`

const webhookSecret = 'secret'

function withGitHubProvider<A, E>(
  effect: Effect.Effect<A, E, SourceControlService | GitHubWebhookService>,
) {
  return Effect.runPromise(effect.pipe(Effect.provide(GitHubProviderPlugin.layer)))
}

function mockInstallationToken() {
  nock('https://api.github.com')
    .post('/app/installations/123/access_tokens')
    .reply(200, {
      token: 'installation-token',
      expires_at: '2026-01-01T00:00:00.000Z',
      permissions: { metadata: 'read', issues: 'write' },
      repository_selection: 'all',
    })
}

function mockScopedInstallationToken() {
  nock('https://api.github.com')
    .post('/app/installations/123/access_tokens', {
      repository_ids: [456],
      permissions: { contents: 'read' },
    })
    .reply(201, {
      token: 'scoped-installation-token',
      expires_at: '2026-01-01T00:00:00.000Z',
      permissions: { contents: 'read' },
      repository_selection: 'selected',
    })
}

beforeEach(() => {
  MockDate.set('2026-01-01T00:00:00.000Z')
  nock.cleanAll()
  process.env.GITHUB_APP_ID = '1'
  process.env.GITHUB_PRIVATE_KEY = privateKey
  process.env.GITHUB_WEBHOOK_SECRET = webhookSecret
  delete process.env.GITHUB_BASE_URL
})

afterEach(() => {
  MockDate.reset()
  nock.cleanAll()
  delete process.env.GITHUB_APP_ID
  delete process.env.GITHUB_PRIVATE_KEY
  delete process.env.GITHUB_WEBHOOK_SECRET
  delete process.env.GITHUB_BASE_URL
})

describe('GitHubProviderPlugin', () => {
  test('verifies repository access through an installation client', async () => {
    mockInstallationToken()
    nock('https://api.github.com')
      .get('/repos/octokit/octokit.js')
      .reply(200, {
        name: 'octokit.js',
        full_name: 'octokit/octokit.js',
        owner: { login: 'octokit' },
      })

    const repository = await withGitHubProvider(
      Effect.gen(function* () {
        const github = yield* SourceControlService
        return yield* github.verifyRepositoryAccess({
          provider: 'github',
          installationId: '123',
          owner: 'octokit',
          name: 'octokit.js',
        })
      }),
    )

    expect(repository).toEqual({
      provider: 'github',
      installationId: '123',
      owner: 'octokit',
      name: 'octokit.js',
      fullName: 'octokit/octokit.js',
    })
    expect(nock.isDone()).toBe(true)
  })

  test('creates an issue comment through an installation client', async () => {
    mockInstallationToken()
    nock('https://api.github.com')
      .post('/repos/octokit/octokit.js/issues/1/comments', {
        body: 'Hello from PatchPlane',
      })
      .reply(201, { id: 1 })

    await withGitHubProvider(
      Effect.gen(function* () {
        const github = yield* SourceControlService
        yield* github.createIssueComment({
          provider: 'github',
          installationId: '123',
          owner: 'octokit',
          name: 'octokit.js',
          issueNumber: 1,
          body: 'Hello from PatchPlane',
        })
      }),
    )

    expect(nock.isDone()).toBe(true)
  })

  test('creates repository-scoped installation clone credentials for private repository clones', async () => {
    mockScopedInstallationToken()

    const credentials = await withGitHubProvider(
      Effect.gen(function* () {
        const github = yield* SourceControlService
        return yield* github.createRepositoryCloneCredentials({
          provider: 'github',
          installationId: '123',
          owner: 'octokit',
          name: 'octokit.js',
          repositoryExternalId: '456',
        })
      }),
    )

    expect(credentials).toEqual({
      username: 'x-access-token',
      password: 'scoped-installation-token',
    })
    expect(nock.isDone()).toBe(true)
  })

  test('rejects non-positive installation ids', async () => {
    await expect(
      withGitHubProvider(
        Effect.gen(function* () {
          const github = yield* SourceControlService
          return yield* github.verifyRepositoryAccess({
            provider: 'github',
            installationId: '0',
            owner: 'octokit',
            name: 'octokit.js',
          })
        }),
      ),
    ).rejects.toMatchObject({
      _tag: 'SourceControlError',
      operation: 'GitHubProviderPlugin.parseGitHubInstallationId',
    })
  })

  test('verifies a signed webhook event without dispatching handlers', async () => {
    const payload = JSON.stringify({
      action: 'opened',
      installation: { id: 123 },
      repository: { owner: { login: 'octokit' }, name: 'octokit.js' },
      issue: { number: 1 },
    })
    const app = new App({
      appId: 1,
      privateKey,
      webhooks: { secret: webhookSecret },
    })
    const signature = await app.webhooks.sign(payload)

    const event = await withGitHubProvider(
      Effect.gen(function* () {
        const github = yield* GitHubWebhookService
        return yield* github.verifyWebhook({
          deliveryId: 'delivery-1',
          eventName: 'issues',
          signature,
          payload,
        })
      }),
    )

    expect(event.deliveryId).toBe('delivery-1')
    expect(event.eventName).toBe('issues')
    expect(event.payload).toMatchObject({ action: 'opened' })
  })

  test('rejects invalid webhook signatures', async () => {
    await expect(
      withGitHubProvider(
        Effect.gen(function* () {
          const github = yield* GitHubWebhookService
          return yield* github.verifyWebhook({
            deliveryId: 'delivery-1',
            eventName: 'issues',
            signature: 'sha256=invalid',
            payload: JSON.stringify({ action: 'opened' }),
          })
        }),
      ),
    ).rejects.toMatchObject({
      _tag: 'GitHubError',
      operation: 'verifyGitHubWebhook',
    })
  })
})
