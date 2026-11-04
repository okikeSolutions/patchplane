import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { it as effectIt } from '@effect/vitest'
import { Deferred, Effect, Fiber, type Scope } from 'effect'
import { TestClock } from 'effect/testing'
import { App } from 'octokit'
import nock from 'nock'
import MockDate from 'mockdate'
import { makeGitCommitSha } from '@patchplane/domain/refinements'
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
  effect: Effect.Effect<
    A,
    E,
    SourceControlService | GitHubWebhookService | Scope.Scope
  >,
) {
  return Effect.runPromise(
    effect.pipe(Effect.provide(GitHubProviderPlugin.layer), Effect.scoped),
  )
}

function mockPublicationToken(
  permission: 'issues' | 'checks' | 'pull_requests',
) {
  const token = `${permission}-publication-token`
  nock('https://api.github.com')
    .post('/app/installations/123/access_tokens', {
      repositories: ['octokit.js'],
      permissions: { [permission]: 'write' },
    })
    .reply(201, {
      token,
      expires_at: '2026-01-01T01:00:00.000Z',
      permissions: { metadata: 'read', [permission]: 'write' },
      repository_selection: 'selected',
      repositories: [{ id: 456, name: 'octokit.js' }],
    })
  nock('https://api.github.com')
    .delete('/installation/token')
    .matchHeader('authorization', `Bearer ${token}`)
    .reply(204)
}

function mockInventoryToken() {
  nock('https://api.github.com')
    .post('/app/installations/123/access_tokens', {
      permissions: { metadata: 'read' },
    })
    .reply(201, {
      token: 'inventory-token',
      expires_at: '2026-01-01T01:00:00.000Z',
      permissions: { metadata: 'read' },
      repository_selection: 'all',
    })
  nock('https://api.github.com')
    .delete('/installation/token')
    .matchHeader('authorization', 'Bearer inventory-token')
    .reply(204)
}

function mockComparisonResponse(response: Response) {
  const realFetch = globalThis.fetch.bind(globalThis)
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = input instanceof Request ? input.url : String(input)
    return url.includes('/access_tokens') || url.endsWith('/installation/token')
      ? realFetch(input, init)
      : Promise.resolve(response)
  })
}

function mockComparisonToken() {
  nock('https://api.github.com')
    .post('/app/installations/123/access_tokens', {
      repositories: ['octokit.js'],
      permissions: { contents: 'read' },
    })
    .reply(201, {
      token: 'comparison-token',
      expires_at: '2026-01-01T01:00:00.000Z',
      permissions: { contents: 'read', metadata: 'read' },
      repository_selection: 'selected',
      repositories: [{ id: 456, name: 'octokit.js' }],
    })
  nock('https://api.github.com')
    .delete('/installation/token')
    .matchHeader('authorization', 'Bearer comparison-token')
    .reply(204)
}

function mockScopedInstallationToken() {
  nock('https://api.github.com')
    .post('/app/installations/123/access_tokens', {
      repository_ids: [456],
      permissions: { contents: 'read' },
    })
    .reply(201, {
      token: 'scoped-installation-token',
      expires_at: '2026-01-01T01:00:00.000Z',
      permissions: { contents: 'read', metadata: 'read' },
      repository_selection: 'selected',
      repositories: [{ id: 456, name: 'octokit.js' }],
    })
  nock('https://api.github.com')
    .delete('/installation/token')
    .matchHeader('authorization', 'Bearer scoped-installation-token')
    .reply(204)
}

beforeEach(() => {
  MockDate.set('2026-01-01T00:00:00.000Z')
  nock.cleanAll()
  process.env.GITHUB_APP_ID = '1'
  process.env.GITHUB_CLIENT_ID = 'Iv1.client'
  process.env.GITHUB_CLIENT_SECRET = 'client-secret'
  process.env.PATCHPLANE_GITHUB_OAUTH_CALLBACK_URL =
    'https://patchplane.test/api/github/install/callback'
  process.env.GITHUB_PRIVATE_KEY = privateKey
  process.env.GITHUB_WEBHOOK_SECRET = webhookSecret
  delete process.env.GITHUB_BASE_URL
})

afterEach(() => {
  MockDate.reset()
  nock.cleanAll()
  vi.restoreAllMocks()
  delete process.env.GITHUB_APP_ID
  delete process.env.GITHUB_CLIENT_ID
  delete process.env.GITHUB_CLIENT_SECRET
  delete process.env.PATCHPLANE_GITHUB_OAUTH_CALLBACK_URL
  delete process.env.GITHUB_PRIVATE_KEY
  delete process.env.GITHUB_WEBHOOK_SECRET
  delete process.env.GITHUB_BASE_URL
})

describe('GitHubProviderPlugin', { concurrent: false }, () => {
  test('verifies repository access through an installation client', async () => {
    process.env.GITHUB_BASE_URL = 'https://api.github.com/'
    nock('https://api.github.com')
      .post('/app/installations/123/access_tokens', {
        repositories: ['octokit.js'],
        permissions: { metadata: 'read' },
      })
      .reply(201, {
        token: 'repository-verification-token',
        expires_at: '2026-01-01T01:00:00.000Z',
        permissions: { metadata: 'read' },
        repository_selection: 'selected',
        repositories: [{ id: 456, name: 'octokit.js' }],
      })
    nock('https://api.github.com')
      .delete('/installation/token')
      .matchHeader('authorization', 'Bearer repository-verification-token')
      .reply(204)
    nock('https://api.github.com')
      .get('/installation/repositories')
      .query({ per_page: 100, page: 1 })
      .reply(200, {
        total_count: 1,
        repositories: [
          {
            id: 456,
            name: 'octokit.js',
            full_name: 'octokit/octokit.js',
            private: false,
            owner: { login: 'octokit' },
          },
        ],
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
      repositoryExternalId: '456',
      private: false,
    })
    expect(nock.isDone()).toBe(true)
  })

  test('revokes repository verification credentials when capability decoding fails', async () => {
    nock('https://api.github.com')
      .post('/app/installations/123/access_tokens', {
        repositories: ['octokit.js'],
        permissions: { metadata: 'read' },
      })
      .reply(201, {
        token: 'invalid-repository-verification-token',
        expires_at: '2026-01-01T01:00:00.000Z',
        permissions: { metadata: 'read', issues: 'write' },
        repository_selection: 'selected',
        repositories: [{ id: 456, name: 'octokit.js' }],
      })
    nock('https://api.github.com')
      .delete('/installation/token')
      .matchHeader(
        'authorization',
        'Bearer invalid-repository-verification-token',
      )
      .reply(204)

    await expect(
      withGitHubProvider(
        Effect.gen(function* () {
          const github = yield* SourceControlService
          return yield* github.verifyRepositoryAccess({
            provider: 'github',
            installationId: '123',
            owner: 'octokit',
            name: 'octokit.js',
          })
        }),
      ),
    ).rejects.toThrow()

    expect(nock.isDone()).toBe(true)
  })

  test('fetches exact immutable comparison diff bytes by explicit SHAs', async () => {
    mockComparisonToken()
    const baseSha = makeGitCommitSha('a'.repeat(40))
    const headSha = makeGitCommitSha('b'.repeat(40))
    const diff =
      'diff --git a/a.txt b/a.txt\nindex 7898192..6178079 100644\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-a\n+b\n'
    const fetchMock = mockComparisonResponse(
      new Response(diff, {
        status: 200,
        headers: { 'content-type': 'application/vnd.github.v3.diff' },
      }),
    )

    const comparison = await withGitHubProvider(
      Effect.gen(function* () {
        const github = yield* SourceControlService
        return yield* github.fetchImmutableComparison({
          provider: 'github',
          installationId: '123',
          owner: 'octokit',
          name: 'octokit.js',
          baseSha,
          headSha,
          maxBytes: 1024,
        })
      }),
    )

    expect(new TextDecoder().decode(comparison.bytes)).toBe(diff)
    expect(comparison).toMatchObject({
      provider: 'github',
      baseSha,
      headSha,
      contentType: 'application/vnd.github.v3.diff',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.github.com/repos/octokit/octokit.js/compare/${baseSha}...${headSha}`,
      expect.objectContaining({
        headers: expect.objectContaining({
          accept: 'application/vnd.github.v3.diff',
        }),
        redirect: 'manual',
      }),
    )
    expect(nock.isDone()).toBe(true)
  })

  test.each([
    {
      name: 'HTTP 406',
      status: 406,
      body: 'diff unavailable',
      contentType: 'text/plain',
      message: 'unavailable or truncated',
    },
    {
      name: 'missing commit',
      status: 404,
      body: 'missing',
      contentType: 'text/plain',
      message: 'missing commit',
    },
    {
      name: 'unexpected content type',
      status: 200,
      body: '{}',
      contentType: 'application/json',
      message: 'unexpected content type',
    },
    {
      name: 'binary comparison',
      status: 200,
      body: 'diff --git a/image.png b/image.png\nBinary files a/image.png and b/image.png differ\n',
      contentType: 'application/vnd.github.v3.diff',
      message: 'binary changes',
    },
    {
      name: 'git binary patch',
      status: 200,
      body: 'diff --git a/image.png b/image.png\nGIT binary patch\nliteral 1\n',
      contentType: 'application/vnd.github.v3.diff',
      message: 'binary changes',
    },
    {
      name: 'invalid UTF-8',
      status: 200,
      body: new Uint8Array([0xff, 0xfe]),
      contentType: 'application/vnd.github.v3.diff',
      message: 'valid UTF-8',
    },
    {
      name: 'oversized comparison',
      status: 200,
      body: '12345',
      contentType: 'application/vnd.github.v3.diff',
      message: 'byte limit',
      maxBytes: 4,
    },
  ])(
    'fails closed for $name',
    async ({ status, body, contentType, message, maxBytes }) => {
      mockComparisonToken()
      const baseSha = makeGitCommitSha('a'.repeat(40))
      const headSha = makeGitCommitSha('b'.repeat(40))
      mockComparisonResponse(
        new Response(body, {
          status,
          headers: { 'content-type': contentType },
        }),
      )

      await expect(
        withGitHubProvider(
          Effect.gen(function* () {
            const github = yield* SourceControlService
            return yield* github.fetchImmutableComparison({
              provider: 'github',
              installationId: '123',
              owner: 'octokit',
              name: 'octokit.js',
              baseSha,
              headSha,
              maxBytes: maxBytes ?? 1024,
            })
          }),
        ),
      ).rejects.toThrow(message)
      expect(nock.isDone()).toBe(true)
    },
    15_000,
  )

  test('fails closed when comparison transfer is truncated', async () => {
    mockComparisonToken()
    const baseSha = makeGitCommitSha('a'.repeat(40))
    const headSha = makeGitCommitSha('b'.repeat(40))
    mockComparisonResponse(
      new Response('abc', {
        status: 200,
        headers: {
          'content-type': 'application/vnd.github.v3.diff',
          'content-length': '10',
        },
      }),
    )

    await expect(
      withGitHubProvider(
        Effect.gen(function* () {
          const github = yield* SourceControlService
          return yield* github.fetchImmutableComparison({
            provider: 'github',
            installationId: '123',
            owner: 'octokit',
            name: 'octokit.js',
            baseSha,
            headSha,
            maxBytes: 1024,
          })
        }),
      ),
    ).rejects.toThrow()
    expect(nock.isDone()).toBe(true)
  }, 15_000)

  test('aborts a stalled comparison body at the configured deadline', async () => {
    mockComparisonToken()
    const baseSha = makeGitCommitSha('a'.repeat(40))
    const headSha = makeGitCommitSha('b'.repeat(40))
    const realFetch = globalThis.fetch.bind(globalThis)
    let comparisonSignal: AbortSignal | undefined
    let bodyAbortObserved = false
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url.includes('/access_tokens') || url.endsWith('/installation/token'))
        return realFetch(input, init)
      comparisonSignal = init?.signal ?? undefined
      return Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              comparisonSignal?.addEventListener('abort', () => {
                bodyAbortObserved = true
                controller.error(new Error('aborted comparison body'))
              })
            },
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/vnd.github.v3.diff',
            },
          },
        ),
      )
    })

    await expect(
      withGitHubProvider(
        Effect.gen(function* () {
          const github = yield* SourceControlService
          return yield* github.fetchImmutableComparison({
            provider: 'github',
            installationId: '123',
            owner: 'octokit',
            name: 'octokit.js',
            baseSha,
            headSha,
            maxBytes: 1024,
            timeoutMilliseconds: 500,
          })
        }),
      ),
    ).rejects.toThrow('GitHub comparison exceeded the configured deadline')
    expect(comparisonSignal?.aborted).toBe(true)
    expect(bodyAbortObserved).toBe(true)
    expect(nock.isDone()).toBe(true)
  })

  test('propagates Effect interruption to a stalled comparison body', async () => {
    mockComparisonToken()
    const baseSha = makeGitCommitSha('a'.repeat(40))
    const headSha = makeGitCommitSha('b'.repeat(40))
    const realFetch = globalThis.fetch.bind(globalThis)
    let comparisonSignal: AbortSignal | undefined
    let comparisonBody: ReadableStream<Uint8Array> | undefined
    let notifyComparisonStarted: (() => void) | undefined
    const comparisonStarted = new Promise<void>((resolve) => {
      notifyComparisonStarted = resolve
    })
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url.includes('/access_tokens') || url.endsWith('/installation/token'))
        return realFetch(input, init)
      comparisonSignal = init?.signal ?? undefined
      notifyComparisonStarted?.()
      comparisonBody = new ReadableStream<Uint8Array>({
        start(controller) {
          comparisonSignal?.addEventListener('abort', () =>
            controller.error(new Error('interrupted comparison body')),
          )
        },
      })
      return Promise.resolve(
        new Response(comparisonBody, {
          status: 200,
          headers: {
            'content-type': 'application/vnd.github.v3.diff',
          },
        }),
      )
    })

    const runtimeAbort = new AbortController()
    const result = Effect.runPromise(
      Effect.gen(function* () {
        const github = yield* SourceControlService
        return yield* github.fetchImmutableComparison({
          provider: 'github',
          installationId: '123',
          owner: 'octokit',
          name: 'octokit.js',
          baseSha,
          headSha,
          maxBytes: 1024,
        })
      }).pipe(Effect.provide(GitHubProviderPlugin.layer)),
      { signal: runtimeAbort.signal },
    )
    await comparisonStarted
    runtimeAbort.abort()

    await expect(result).rejects.toThrow('interrupted')
    expect(comparisonSignal?.aborted).toBe(true)
    await vi.waitFor(() => expect(comparisonBody?.locked).toBe(false))
    expect(nock.isDone()).toBe(true)
  })

  test('revokes a comparison token returned during cancellation', async () => {
    nock('https://api.github.com')
      .delete('/installation/token')
      .matchHeader('authorization', 'Bearer cancelled-comparison-token')
      .reply(204)
    const realFetch = globalThis.fetch.bind(globalThis)
    let tokenSignal: AbortSignal | undefined
    let resolveToken: ((response: Response) => void) | undefined
    let notifyTokenStarted: (() => void) | undefined
    const tokenStarted = new Promise<void>((resolve) => {
      notifyTokenStarted = resolve
    })
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      if (!url.includes('/app/installations/125/access_tokens')) {
        return realFetch(input, init)
      }
      tokenSignal =
        input instanceof Request ? input.signal : (init?.signal ?? undefined)
      notifyTokenStarted?.()
      return new Promise<Response>((resolve) => {
        resolveToken = resolve
      })
    })

    const runtimeAbort = new AbortController()
    const result = Effect.runPromise(
      Effect.gen(function* () {
        const github = yield* SourceControlService
        return yield* github.fetchImmutableComparison({
          provider: 'github',
          installationId: '125',
          owner: 'octokit',
          name: 'octokit.js',
          baseSha: makeGitCommitSha('a'.repeat(40)),
          headSha: makeGitCommitSha('b'.repeat(40)),
          maxBytes: 1_024,
        })
      }).pipe(Effect.provide(GitHubProviderPlugin.layer)),
      { signal: runtimeAbort.signal },
    )
    await tokenStarted
    runtimeAbort.abort()
    expect(tokenSignal?.aborted).toBe(false)
    resolveToken?.(
      new Response(
        JSON.stringify({
          token: 'cancelled-comparison-token',
          expires_at: '2026-01-01T01:00:00.000Z',
          permissions: { contents: 'read', metadata: 'read' },
          repository_selection: 'selected',
          repositories: [{ id: 456, name: 'octokit.js' }],
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      ),
    )

    await expect(result).rejects.toThrow('interrupted')
    expect(nock.isDone()).toBe(true)
  })

  test('cleans up the comparison request after an early fetch rejection', async () => {
    mockComparisonToken()
    const baseSha = makeGitCommitSha('a'.repeat(40))
    const headSha = makeGitCommitSha('b'.repeat(40))
    const realFetch = globalThis.fetch.bind(globalThis)
    let comparisonSignal: AbortSignal | undefined
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url.includes('/access_tokens') || url.endsWith('/installation/token'))
        return realFetch(input, init)
      comparisonSignal = init?.signal ?? undefined
      return Promise.reject(new Error('early comparison fetch rejection'))
    })

    await expect(
      withGitHubProvider(
        Effect.gen(function* () {
          const github = yield* SourceControlService
          return yield* github.fetchImmutableComparison({
            provider: 'github',
            installationId: '123',
            owner: 'octokit',
            name: 'octokit.js',
            baseSha,
            headSha,
            maxBytes: 1024,
          })
        }),
      ),
    ).rejects.toThrow('failed to fetch the immutable comparison diff')
    expect(comparisonSignal?.aborted).toBe(true)
    expect(nock.isDone()).toBe(true)
  })

  effectIt.effect(
    'bounds a stalled installation-token request before comparison fetch',
    () =>
      Effect.gen(function* () {
        const baseSha = makeGitCommitSha('a'.repeat(40))
        const headSha = makeGitCommitSha('b'.repeat(40))
        const authenticationStarted = yield* Deferred.make<void>()
        let authenticationSignal: AbortSignal | undefined
        let comparisonFetchCalled = false
        vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
          const url = input instanceof Request ? input.url : String(input)
          if (url.includes('/access_tokens')) {
            authenticationSignal =
              input instanceof Request
                ? input.signal
                : (init?.signal ?? undefined)
            Deferred.doneUnsafe(authenticationStarted, Effect.void)
            return new Promise<Response>((_resolve, reject) => {
              authenticationSignal?.addEventListener('abort', () =>
                reject(authenticationSignal?.reason),
              )
            })
          }
          comparisonFetchCalled = true
          return Promise.reject(new Error('comparison fetch must not run'))
        })

        const fiber = yield* Effect.gen(function* () {
          const github = yield* SourceControlService
          return yield* github.fetchImmutableComparison({
            provider: 'github',
            installationId: '123',
            owner: 'octokit',
            name: 'octokit.js',
            baseSha,
            headSha,
            maxBytes: 1024,
            timeoutMilliseconds: 25,
          })
        }).pipe(Effect.provide(GitHubProviderPlugin.layer), Effect.forkScoped)

        yield* Deferred.await(authenticationStarted)
        yield* TestClock.adjust(25)
        const failure = yield* Fiber.join(fiber).pipe(Effect.flip)
        expect(failure).toMatchObject({
          message: 'GitHub comparison exceeded the configured deadline',
        })
        expect(comparisonFetchCalled).toBe(false)
        expect(authenticationSignal?.aborted).toBe(true)
      }),
  )

  test('gets GitHub App installation account metadata', async () => {
    nock('https://api.github.com')
      .get('/app/installations/123')
      .reply(200, {
        id: 123,
        account: {
          id: 999,
          login: 'octokit',
          type: 'Organization',
        },
      })

    const account = await withGitHubProvider(
      Effect.gen(function* () {
        const github = yield* SourceControlService
        return yield* github.getInstallationAccount({
          provider: 'github',
          installationId: '123',
        })
      }),
    )

    expect(account).toEqual({
      provider: 'github',
      installationId: '123',
      accountExternalId: '999',
      accountLogin: 'octokit',
      accountType: 'Organization',
    })
    expect(nock.isDone()).toBe(true)
  })

  test('rejects malformed installation account identity', async () => {
    nock('https://api.github.com')
      .get('/app/installations/123')
      .reply(200, { id: 123, account: { type: 'Organization' } })

    await expect(
      withGitHubProvider(
        Effect.gen(function* () {
          const github = yield* SourceControlService
          return yield* github.getInstallationAccount({
            provider: 'github',
            installationId: '123',
          })
        }),
      ),
    ).rejects.toMatchObject({
      _tag: 'SourceControlError',
      operation: 'getInstallationAccount.decode',
    })
  })

  test('verifies organization installation ownership and revokes the temporary user token', async () => {
    nock('https://github.com')
      .post('/login/oauth/access_token', {
        client_id: 'Iv1.client',
        client_secret: 'client-secret',
        code: 'authorization-code',
        code_verifier: 'v'.repeat(64),
        redirect_uri: 'https://patchplane.test/api/github/install/callback',
      })
      .reply(200, {
        access_token: 'temporary-user-token',
        token_type: 'bearer',
        expires_in: 28_800,
        refresh_token: 'refresh-token',
        refresh_token_expires_in: 15_811_200,
      })
    nock('https://api.github.com').get('/user').reply(200, {
      id: 321,
      login: 'installer',
      type: 'User',
    })
    nock('https://api.github.com')
      .get('/user/installations')
      .query({ per_page: '100', page: '1' })
      .reply(200, {
        total_count: 1,
        installations: [
          {
            id: 123,
            account: { id: 999, login: 'octokit', type: 'Organization' },
          },
        ],
      })
    nock('https://api.github.com')
      .get('/user/memberships/orgs/octokit')
      .reply(200, { state: 'active', role: 'admin' })
    nock('https://api.github.com')
      .delete('/applications/Iv1.client/token', {
        access_token: 'temporary-user-token',
      })
      .reply(204)

    await withGitHubProvider(
      Effect.gen(function* () {
        const github = yield* SourceControlService
        yield* github.verifyGitHubInstallationOwnership({
          provider: 'github',
          installationId: '123',
          authorizationCode: 'authorization-code',
          pkceVerifier: 'v'.repeat(64),
        })
      }),
    )

    expect(nock.isDone()).toBe(true)
  })

  test('rejects a spoofed installation id and still revokes the temporary user token', async () => {
    nock('https://github.com')
      .post('/login/oauth/access_token', {
        client_id: 'Iv1.client',
        client_secret: 'client-secret',
        code: 'spoofed-code',
        code_verifier: 'v'.repeat(64),
        redirect_uri: 'https://patchplane.test/api/github/install/callback',
      })
      .reply(200, {
        access_token: 'temporary-user-token',
        expires_in: 28_800,
        refresh_token: 'refresh-token',
        refresh_token_expires_in: 15_811_200,
      })
    nock('https://api.github.com').get('/user').reply(200, {
      id: 321,
      login: 'collaborator',
      type: 'User',
    })
    nock('https://api.github.com')
      .get('/user/installations')
      .query({ per_page: '100', page: '1' })
      .reply(200, { total_count: 0, installations: [] })
    nock('https://api.github.com')
      .delete('/applications/Iv1.client/token', {
        access_token: 'temporary-user-token',
      })
      .reply(204)

    await expect(
      withGitHubProvider(
        Effect.gen(function* () {
          const github = yield* SourceControlService
          yield* github.verifyGitHubInstallationOwnership({
            provider: 'github',
            installationId: '123',
            authorizationCode: 'spoofed-code',
            pkceVerifier: 'v'.repeat(64),
          })
        }),
      ),
    ).rejects.toMatchObject({
      _tag: 'SourceControlError',
      operation: 'verifyGitHubInstallationOwnership.verify',
    })
    expect(nock.isDone()).toBe(true)
  })

  test('rejects an OAuth error returned with HTTP 200 without exposing a token', async () => {
    nock('https://github.com')
      .post('/login/oauth/access_token', {
        client_id: 'Iv1.client',
        client_secret: 'client-secret',
        code: 'expired-code',
        code_verifier: 'v'.repeat(64),
        redirect_uri: 'https://patchplane.test/api/github/install/callback',
      })
      .reply(200, {
        error: 'bad_verification_code',
        error_description: 'The code passed is incorrect or expired.',
      })

    await expect(
      withGitHubProvider(
        Effect.gen(function* () {
          const github = yield* SourceControlService
          yield* github.verifyGitHubInstallationOwnership({
            provider: 'github',
            installationId: '123',
            authorizationCode: 'expired-code',
            pkceVerifier: 'v'.repeat(64),
          })
        }),
      ),
    ).rejects.toMatchObject({
      _tag: 'SourceControlError',
      operation: 'verifyGitHubInstallationOwnership.exchange',
    })
    expect(nock.isDone()).toBe(true)
  })

  test('rejects an organization member without administrator ownership', async () => {
    nock('https://github.com')
      .post('/login/oauth/access_token', {
        client_id: 'Iv1.client',
        client_secret: 'client-secret',
        code: 'member-code',
        code_verifier: 'v'.repeat(64),
        redirect_uri: 'https://patchplane.test/api/github/install/callback',
      })
      .reply(200, {
        access_token: 'temporary-user-token',
        expires_in: 28_800,
        refresh_token: 'refresh-token',
        refresh_token_expires_in: 15_811_200,
      })
    nock('https://api.github.com').get('/user').reply(200, {
      id: 321,
      login: 'member',
      type: 'User',
    })
    nock('https://api.github.com')
      .get('/user/installations')
      .query({ per_page: '100', page: '1' })
      .reply(200, {
        total_count: 1,
        installations: [
          {
            id: 123,
            account: { id: 999, login: 'octokit', type: 'Organization' },
          },
        ],
      })
    nock('https://api.github.com')
      .get('/user/memberships/orgs/octokit')
      .reply(200, { state: 'active', role: 'member' })
    nock('https://api.github.com')
      .delete('/applications/Iv1.client/token', {
        access_token: 'temporary-user-token',
      })
      .reply(204)

    await expect(
      withGitHubProvider(
        Effect.gen(function* () {
          const github = yield* SourceControlService
          yield* github.verifyGitHubInstallationOwnership({
            provider: 'github',
            installationId: '123',
            authorizationCode: 'member-code',
            pkceVerifier: 'v'.repeat(64),
          })
        }),
      ),
    ).rejects.toMatchObject({
      _tag: 'SourceControlError',
      operation: 'verifyGitHubInstallationOwnership.verify',
    })
    expect(nock.isDone()).toBe(true)
  })

  test('revokes a token returned concurrently with cancellation', async () => {
    nock('https://api.github.com')
      .delete('/applications/Iv1.client/token', {
        access_token: 'cancelled-user-token',
      })
      .reply(204)
    const realFetch = globalThis.fetch.bind(globalThis)
    let exchangeSignal: AbortSignal | undefined
    let resolveExchange: ((response: Response) => void) | undefined
    let notifyExchangeStarted: (() => void) | undefined
    const exchangeStarted = new Promise<void>((resolve) => {
      notifyExchangeStarted = resolve
    })
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      const isCancelledExchange =
        url.includes('/login/oauth/access_token') &&
        init?.body instanceof URLSearchParams &&
        init.body.get('code') === 'cancelled-code'
      if (!isCancelledExchange) {
        return realFetch(input, init)
      }
      exchangeSignal =
        input instanceof Request ? input.signal : (init?.signal ?? undefined)
      notifyExchangeStarted?.()
      return new Promise<Response>((resolve) => {
        resolveExchange = resolve
      })
    })

    const runtimeAbort = new AbortController()
    const result = Effect.runPromise(
      Effect.gen(function* () {
        const github = yield* SourceControlService
        yield* github.verifyGitHubInstallationOwnership({
          provider: 'github',
          installationId: '123',
          authorizationCode: 'cancelled-code',
          pkceVerifier: 'v'.repeat(64),
        })
      }).pipe(Effect.provide(GitHubProviderPlugin.layer)),
      { signal: runtimeAbort.signal },
    )
    await exchangeStarted
    runtimeAbort.abort()
    expect(exchangeSignal?.aborted).toBe(false)
    resolveExchange?.(
      new Response(
        JSON.stringify({
          access_token: 'cancelled-user-token',
          expires_in: 28_800,
          refresh_token: 'cancelled-refresh-token',
          refresh_token_expires_in: 15_811_200,
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    )

    await expect(result).rejects.toThrow('interrupted')
    expect(nock.isDone()).toBe(true)
  })

  test('revokes the temporary user token when ownership verification is interrupted', async () => {
    nock('https://github.com')
      .post('/login/oauth/access_token', {
        client_id: 'Iv1.client',
        client_secret: 'client-secret',
        code: 'interrupt-verification-code',
        code_verifier: 'v'.repeat(64),
        redirect_uri: 'https://patchplane.test/api/github/install/callback',
      })
      .reply(200, {
        access_token: 'interrupted-user-token',
        expires_in: 28_800,
        refresh_token: 'interrupted-refresh-token',
        refresh_token_expires_in: 15_811_200,
      })
    nock('https://api.github.com')
      .delete('/applications/Iv1.client/token', {
        access_token: 'interrupted-user-token',
      })
      .reply(204)
    const realFetch = globalThis.fetch.bind(globalThis)
    let userSignal: AbortSignal | undefined
    let notifyUserRequestStarted: (() => void) | undefined
    const userRequestStarted = new Promise<void>((resolve) => {
      notifyUserRequestStarted = resolve
    })
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const requestUrl = input instanceof Request ? input.url : String(input)
      const authorization =
        input instanceof Request
          ? input.headers.get('authorization')
          : new Headers(init?.headers).get('authorization')
      if (
        new URL(requestUrl).pathname !== '/user' ||
        authorization?.includes('interrupted-user-token') !== true
      ) {
        return realFetch(input, init)
      }
      userSignal =
        input instanceof Request ? input.signal : (init?.signal ?? undefined)
      notifyUserRequestStarted?.()
      return new Promise<Response>((_resolve, reject) => {
        userSignal?.addEventListener('abort', () => reject(userSignal?.reason))
      })
    })

    const runtimeAbort = new AbortController()
    const result = Effect.runPromise(
      Effect.gen(function* () {
        const github = yield* SourceControlService
        yield* github.verifyGitHubInstallationOwnership({
          provider: 'github',
          installationId: '123',
          authorizationCode: 'interrupt-verification-code',
          pkceVerifier: 'v'.repeat(64),
        })
      }).pipe(Effect.provide(GitHubProviderPlugin.layer)),
      { signal: runtimeAbort.signal },
    )
    await userRequestStarted
    runtimeAbort.abort()

    await expect(result).rejects.toThrow('interrupted')
    expect(userSignal?.aborted).toBe(true)
    expect(nock.isDone()).toBe(true)
  })

  test('lists repositories accessible to an installation', async () => {
    mockInventoryToken()
    nock('https://api.github.com')
      .get('/installation/repositories')
      .query({ per_page: '100', page: '1' })
      .reply(200, {
        total_count: 1,
        repositories: [
          {
            id: 456,
            name: 'octokit.js',
            full_name: 'octokit/octokit.js',
            private: true,
            owner: { login: 'octokit' },
          },
        ],
      })

    const repositories = await withGitHubProvider(
      Effect.gen(function* () {
        const github = yield* SourceControlService
        return yield* github.listInstallationRepositories({
          provider: 'github',
          installationId: '123',
        })
      }),
    )

    expect(repositories).toEqual([
      {
        provider: 'github',
        installationId: '123',
        owner: 'octokit',
        name: 'octokit.js',
        fullName: 'octokit/octokit.js',
        repositoryExternalId: '456',
        private: true,
      },
    ])
    expect(nock.isDone()).toBe(true)
  })

  test('revokes an installation token returned during cancellation', async () => {
    nock('https://api.github.com')
      .delete('/installation/token')
      .matchHeader('authorization', 'Bearer cancelled-installation-token')
      .reply(204)
    const realFetch = globalThis.fetch.bind(globalThis)
    let tokenSignal: AbortSignal | undefined
    let resolveToken: ((response: Response) => void) | undefined
    let notifyTokenStarted: (() => void) | undefined
    const tokenStarted = new Promise<void>((resolve) => {
      notifyTokenStarted = resolve
    })
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      if (!url.includes('/app/installations/124/access_tokens')) {
        return realFetch(input, init)
      }
      tokenSignal =
        input instanceof Request ? input.signal : (init?.signal ?? undefined)
      notifyTokenStarted?.()
      return new Promise<Response>((resolve) => {
        resolveToken = resolve
      })
    })

    const runtimeAbort = new AbortController()
    const result = Effect.runPromise(
      Effect.gen(function* () {
        const github = yield* SourceControlService
        return yield* github.listInstallationRepositories({
          provider: 'github',
          installationId: '124',
        })
      }).pipe(Effect.provide(GitHubProviderPlugin.layer)),
      { signal: runtimeAbort.signal },
    )
    await tokenStarted
    runtimeAbort.abort()
    expect(tokenSignal?.aborted).toBe(false)
    resolveToken?.(
      new Response(
        JSON.stringify({
          token: 'cancelled-installation-token',
          expires_at: '2026-01-01T01:00:00.000Z',
          permissions: { metadata: 'read' },
          repository_selection: 'all',
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      ),
    )

    await expect(result).rejects.toThrow('interrupted')
    expect(nock.isDone()).toBe(true)
  })

  test('rejects repository inventories above the configured bound', async () => {
    mockInventoryToken()
    nock('https://api.github.com')
      .get('/installation/repositories')
      .query({ per_page: '100', page: '1' })
      .reply(200, {
        total_count: 1_001,
        repositories: Array.from({ length: 1_001 }, (_, index) => ({
          id: index + 1,
          name: `repo-${index + 1}`,
          full_name: `octokit/repo-${index + 1}`,
          private: true,
          owner: { login: 'octokit' },
        })),
      })

    await expect(
      withGitHubProvider(
        Effect.gen(function* () {
          const github = yield* SourceControlService
          return yield* github.listInstallationRepositories({
            provider: 'github',
            installationId: '123',
          })
        }),
      ),
    ).rejects.toMatchObject({
      _tag: 'SourceControlError',
      operation: 'listInstallationRepositories.github',
    })
  })

  test('wraps installation repository listing API failures as SourceControlError', async () => {
    mockInventoryToken()
    nock('https://api.github.com')
      .get('/installation/repositories')
      .query({ per_page: '100', page: '1' })
      .reply(403, { message: 'Resource not accessible by integration' })

    await expect(
      withGitHubProvider(
        Effect.gen(function* () {
          const github = yield* SourceControlService
          return yield* github.listInstallationRepositories({
            provider: 'github',
            installationId: '123',
          })
        }),
      ),
    ).rejects.toMatchObject({
      _tag: 'SourceControlError',
      operation: 'listInstallationRepositories.github',
    })
  })

  test('rejects invalid installation repository metadata from GitHub', async () => {
    mockInventoryToken()
    nock('https://api.github.com')
      .get('/installation/repositories')
      .query({ per_page: '100', page: '1' })
      .reply(200, {
        total_count: 1,
        repositories: [
          {
            id: 456,
            name: 'octokit.js',
            private: true,
            owner: {},
          },
        ],
      })

    await expect(
      withGitHubProvider(
        Effect.gen(function* () {
          const github = yield* SourceControlService
          return yield* github.listInstallationRepositories({
            provider: 'github',
            installationId: '123',
          })
        }),
      ),
    ).rejects.toMatchObject({
      _tag: 'SourceControlError',
      operation: 'listInstallationRepositories.decode',
    })
  })

  test('creates an issue comment through a scoped installation client', async () => {
    mockPublicationToken('issues')
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

  test('uses pull-request permission for a pull-request comment', async () => {
    mockPublicationToken('pull_requests')
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
          subjectKind: 'pull-request',
          body: 'Hello from PatchPlane',
        })
      }),
    )

    expect(nock.isDone()).toBe(true)
  })

  test('settles a stalled publication-token acquisition at its owned deadline', async () => {
    const deadline = new AbortController()
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
    const realFetch = globalThis.fetch.bind(globalThis)
    let notifyStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve
    })
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      if (!url.includes('/app/installations/123/access_tokens')) {
        return realFetch(input, init)
      }
      const signal =
        input instanceof Request ? input.signal : (init?.signal ?? undefined)
      notifyStarted?.()
      if (signal?.aborted) return Promise.reject(signal.reason)
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        })
      })
    })
    const result = withGitHubProvider(
      Effect.gen(function* () {
        const github = yield* SourceControlService
        return yield* github.createIssueComment({
          provider: 'github',
          installationId: '123',
          owner: 'octokit',
          name: 'octokit.js',
          issueNumber: 1,
          body: 'Hello from PatchPlane',
        })
      }),
    )

    await started
    deadline.abort('publication token deadline exceeded')

    await expect(result).rejects.toMatchObject({
      _tag: 'SourceControlError',
      operation: 'publicationToken.acquire',
    })
  })

  test('rejects an over-privileged publication token', async () => {
    nock('https://api.github.com')
      .post('/app/installations/123/access_tokens', {
        repositories: ['octokit.js'],
        permissions: { issues: 'write' },
      })
      .reply(201, {
        token: 'over-privileged-token',
        expires_at: '2026-01-01T01:00:00.000Z',
        permissions: {
          metadata: 'read',
          issues: 'write',
          checks: 'write',
        },
        repository_selection: 'selected',
        repositories: [{ id: 456, name: 'octokit.js' }],
      })
    nock('https://api.github.com')
      .delete('/installation/token')
      .matchHeader('authorization', 'Bearer over-privileged-token')
      .reply(204)

    await expect(
      withGitHubProvider(
        Effect.gen(function* () {
          const github = yield* SourceControlService
          return yield* github.createIssueComment({
            provider: 'github',
            installationId: '123',
            owner: 'octokit',
            name: 'octokit.js',
            issueNumber: 1,
            body: 'Hello from PatchPlane',
          })
        }),
      ),
    ).rejects.toMatchObject({
      _tag: 'SourceControlError',
      operation: 'publicationToken.acquire',
    })
  })

  test('updates the canonical issue comment with the same publication marker', async () => {
    mockPublicationToken('issues')
    nock('https://api.github.com')
      .get('/repos/octokit/octokit.js/issues/1/comments')
      .query({ per_page: '100', page: '1' })
      .reply(200, [
        {
          id: 41,
          performed_via_github_app: { id: 2 },
          body: 'Hostile collision\n\n<!-- patchplane-publication:decision-1%3Aissue-comment -->',
          html_url: 'https://github.test/comment/41',
        },
        {
          id: 42,
          performed_via_github_app: { id: 1 },
          body: 'Existing result\n\n<!-- patchplane-publication:decision-1%3Aissue-comment -->',
          html_url: 'https://github.test/comment/42',
        },
      ])
    nock('https://api.github.com')
      .patch('/repos/octokit/octokit.js/issues/comments/42', {
        body: 'Hello from PatchPlane\n\n<!-- patchplane-publication:decision-1%3Aissue-comment -->',
      })
      .reply(200, {
        id: 42,
        html_url: 'https://github.test/comment/42',
      })

    const result = await withGitHubProvider(
      Effect.gen(function* () {
        const github = yield* SourceControlService
        return yield* github.createIssueComment({
          provider: 'github',
          installationId: '123',
          owner: 'octokit',
          name: 'octokit.js',
          issueNumber: 1,
          body: 'Hello from PatchPlane',
          idempotencyKey: 'decision-1:issue-comment',
        })
      }),
    )

    expect(result).toEqual({
      externalId: '42',
      url: 'https://github.test/comment/42',
    })
    expect(nock.isDone()).toBe(true)
  })

  test('aborts issue-comment reconciliation when publication is interrupted', async () => {
    mockPublicationToken('issues')
    const realFetch = globalThis.fetch.bind(globalThis)
    let publicationSignal: AbortSignal | undefined
    let notifyStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve
    })
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      if (!url.includes('/repos/octokit/octokit.js/issues/1/comments')) {
        return realFetch(input, init)
      }
      publicationSignal =
        input instanceof Request ? input.signal : (init?.signal ?? undefined)
      notifyStarted?.()
      return new Promise<Response>(() => undefined)
    })
    const controller = new AbortController()
    const result = Effect.runPromise(
      Effect.gen(function* () {
        const github = yield* SourceControlService
        return yield* github.createIssueComment({
          provider: 'github',
          installationId: '123',
          owner: 'octokit',
          name: 'octokit.js',
          issueNumber: 1,
          body: 'Hello from PatchPlane',
          idempotencyKey: 'decision-1:issue-comment',
        })
      }).pipe(Effect.provide(GitHubProviderPlugin.layer)),
      { signal: controller.signal },
    )
    await started
    controller.abort()

    await expect(result).rejects.toThrow('interrupted')
    expect(publicationSignal?.aborted).toBe(true)
    expect(nock.isDone()).toBe(true)
  })

  test('adopts a check run with a legacy external publication id', async () => {
    mockPublicationToken('checks')
    nock('https://api.github.com')
      .get('/repos/octokit/octokit.js/commits/abc123/check-runs')
      .query({
        check_name: 'PatchPlane Review',
        filter: 'all',
        per_page: '100',
        page: '1',
      })
      .reply(200, {
        total_count: 2,
        check_runs: [
          {
            id: 83,
            app: { id: 2 },
            external_id: 'candidate-1:patch-report-check',
            html_url: 'https://github.test/check/83',
          },
          {
            id: 84,
            app: { id: 1 },
            external_id: 'candidate-1:patch-report-check',
            html_url: 'https://github.test/check/84',
          },
        ],
      })
    nock('https://api.github.com')
      .patch('/repos/octokit/octokit.js/check-runs/84', {
        name: 'PatchPlane Review',
        external_id: 'decision-1:check-run',
        status: 'completed',
        conclusion: 'success',
        output: {
          title: 'Approved',
          summary: 'Approved by PatchPlane',
        },
      })
      .reply(200, {
        id: 84,
        html_url: 'https://github.test/check/84',
      })

    const result = await withGitHubProvider(
      Effect.gen(function* () {
        const github = yield* SourceControlService
        return yield* github.createCheckRun({
          provider: 'github',
          installationId: '123',
          owner: 'octokit',
          name: 'octokit.js',
          headSha: 'abc123',
          checkName: 'PatchPlane Review',
          status: 'completed',
          conclusion: 'success',
          title: 'Approved',
          summary: 'Approved by PatchPlane',
          idempotencyKey: 'decision-1:check-run',
          legacyIdempotencyKeys: ['candidate-1:patch-report-check'],
        })
      }),
    )

    expect(result).toEqual({
      externalId: '84',
      url: 'https://github.test/check/84',
    })
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

  test.each([
    {
      name: 'additional write permission',
      permissions: { contents: 'read', metadata: 'read', issues: 'write' },
      repositories: [{ id: 456, name: 'octokit.js' }],
    },
    {
      name: 'different repository scope',
      permissions: { contents: 'read', metadata: 'read' },
      repositories: [{ id: 999, name: 'other-repo' }],
    },
  ])(
    'rejects clone credentials with $name',
    async ({ permissions, repositories }) => {
      nock('https://api.github.com')
        .post('/app/installations/123/access_tokens', {
          repository_ids: [456],
          permissions: { contents: 'read' },
        })
        .reply(201, {
          token: 'unsafe-token',
          expires_at: '2026-01-01T01:00:00.000Z',
          permissions,
          repository_selection: 'selected',
          repositories,
        })
      nock('https://api.github.com')
        .delete('/installation/token')
        .matchHeader('authorization', 'Bearer unsafe-token')
        .reply(204)

      await expect(
        withGitHubProvider(
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
        ),
      ).rejects.toMatchObject({
        _tag: 'SourceControlError',
        operation: 'createRepositoryCloneCredentials.github',
      })
    },
  )

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
