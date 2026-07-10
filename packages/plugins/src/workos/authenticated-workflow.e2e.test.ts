import { describe, expect, it } from '@effect/vitest'
import { afterEach, beforeEach, vi } from 'vitest'
import type { User } from '@workos-inc/node'
import { ConfigProvider, Effect, Layer } from 'effect'
import type { AuthError } from '@patchplane/domain/errors'
import {
  makePromptRequestId,
  makeWorkflowRunId,
} from '@patchplane/domain/ids'
import { AuthRequestContext } from '@patchplane/core/services/auth-request-context'
import { AuthService } from '@patchplane/core/services/auth-service'
import { StorageService } from '@patchplane/core/services/storage-service'
import { StartAuthenticatedWorkflowFromPrompt } from '@patchplane/core/workflows/start-authenticated-workflow-from-prompt'
import { WorkOSAuthPlugin } from './WorkOSAuthPlugin'
import {
  mapWorkOSSessionToAuthRequest,
  type WorkOSAuthSession,
} from './session'

const workOSUser = {
  object: 'user',
  id: 'user_123',
  email: 'ada@example.com',
  emailVerified: true,
  profilePictureUrl: null,
  name: 'Ada Lovelace',
  firstName: 'Ada',
  lastName: 'Lovelace',
  lastSignInAt: null,
  locale: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  externalId: null,
  metadata: {},
} satisfies User

const TestStorageLayer = Layer.succeed(
  StorageService,
  StorageService.of({
    listRecentWorkflowStarts: () => Effect.succeed([]),
    recordSandboxExecution: () => Effect.die('unused'),
    recordRuntimeEvents: () => Effect.die('unused'),
    recordRuntimeSessionStarted: () => Effect.die('unused'),
    markRuntimeSessionStatus: () => Effect.die('unused'),
    getActiveRuntimeSession: () => Effect.die('unused'),
    recordEvidenceArtifact: () => Effect.die('unused'),
    getEvidenceArtifact: () => Effect.die('unused'),
    recordCandidatePatchSet: () => Effect.die('unused'),
    recordReviewRun: () => Effect.die('unused'),
    recordReviewFinding: () => Effect.die('unused'),
    recordPolicyDecision: () => Effect.die('unused'),
    recordPublicationResult: () => Effect.die('unused'),
    recordProvenanceEvent: () => Effect.die('unused'),
    createWorkflowFromIntake: (input) =>
      Effect.succeed({
        promptRequest: {
          id: makePromptRequestId('prompt-1'),
          workspaceId: input.workspaceId,
          actorId: input.actor.id,
          traceId: input.traceId,
          source: input.source,
          prompt: input.prompt,
          status: 'created',
          createdAt: 1,
        },
        workflowRun: {
          id: makeWorkflowRunId('workflow-1'),
          promptRequestId: makePromptRequestId('prompt-1'),
          workspaceId: input.workspaceId,
          traceId: input.traceId,
          status: 'queued',
          createdAt: 1,
        },
      }),
    createWorkflowFromPrompt: (input) =>
      Effect.succeed({
        promptRequest: {
          id: makePromptRequestId('prompt-1'),
          workspaceId: input.workspaceId,
          actorId: input.actor.id,
          traceId: input.traceId,
          source: input.source,
          prompt: input.prompt,
          status: 'created',
          createdAt: 1,
        },
        workflowRun: {
          id: makeWorkflowRunId('workflow-1'),
          promptRequestId: makePromptRequestId('prompt-1'),
          workspaceId: input.workspaceId,
          traceId: input.traceId,
          status: 'queued',
          createdAt: 1,
        },
      }),
  }),
)

const TestWorkOSConfigLayer = ConfigProvider.layer(
  ConfigProvider.fromEnv({
    env: {
      WORKOS_API_KEY: 'sk_test_123',
      WORKOS_CLIENT_ID: 'client_123',
      WORKOS_COOKIE_PASSWORD: 'test_cookie_password_at_least_32_chars',
    },
  }),
)

const TestLayer = Layer.mergeAll(
  TestStorageLayer,
  WorkOSAuthPlugin.layer.pipe(Layer.provide(TestWorkOSConfigLayer)),
)

interface TestFetchResponse {
  readonly ok: boolean
  readonly status: number
  readonly statusText: string
  readonly headers: {
    readonly 'content-type': string
    get: (name: string) => string | null
  }
  json: () => Promise<unknown>
  text: () => Promise<string>
}

function getPathname(input: unknown) {
  const rawUrl =
    typeof input === 'object' && input !== null && 'url' in input
      ? String(input.url)
      : String(input)
  return rawUrl.replace(/^https?:\/\/[^/]+/, '').split('?')[0] ?? '/'
}

let testMembershipRole = 'operator'
let testMembershipStatus: 'active' | 'inactive' | 'pending' = 'active'
let failOrganizationLookup = false
let failMembershipLookup = false

function jsonResponse(body: unknown): TestFetchResponse {
  const text = JSON.stringify(body)
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: {
      'content-type': 'application/json',
      get: (name) =>
        name.toLowerCase() === 'content-type' ? 'application/json' : null,
    },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(text),
  }
}

beforeEach(() => {
  testMembershipRole = 'operator'
  testMembershipStatus = 'active'
  failOrganizationLookup = false
  failMembershipLookup = false

  vi.stubGlobal('fetch', (input: unknown) => {
    const pathname = getPathname(input)

    if (pathname === '/organizations/org_123') {
      if (failOrganizationLookup) {
        return Promise.reject(new Error('WorkOS organization lookup failed'))
      }

      return Promise.resolve(
        jsonResponse({
          object: 'organization',
          id: 'org_123',
          name: 'Ada Labs',
          allow_profiles_outside_organization: false,
          domains: [],
          metadata: {},
        }),
      )
    }

    if (pathname === '/user_management/organization_memberships') {
      if (failMembershipLookup) {
        return Promise.reject(new Error('WorkOS membership lookup failed'))
      }

      return Promise.resolve(
        jsonResponse({
          object: 'list',
          data: [
            {
              object: 'organization_membership',
              id: 'om_123',
              user_id: 'user_123',
              organization_id: 'org_123',
              organization_name: 'Ada Labs',
              status: testMembershipStatus,
              role: { slug: testMembershipRole },
              directory_managed: false,
              custom_attributes: {},
              created_at: '2026-01-01T00:00:00.000Z',
              updated_at: '2026-01-01T00:00:00.000Z',
            },
          ],
          list_metadata: { before: null, after: null },
        }),
      )
    }

    return Promise.resolve(
      jsonResponse({
        message: `Unexpected WorkOS test request: ${pathname}`,
      }),
    )
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function expectAuthError(error: unknown, operation: string): asserts error is AuthError {
  expect(error).toMatchObject({ _tag: 'AuthError', operation })
}

function runWithSession(session: WorkOSAuthSession) {
  return StartAuthenticatedWorkflowFromPrompt({
    traceId: 'trace-1',
    prompt: 'Fix the bug',
  }).pipe(
    Effect.provideService(
      AuthRequestContext,
      mapWorkOSSessionToAuthRequest(session),
    ),
    Effect.provide(TestLayer),
  )
}

describe('WorkOSAuthPlugin authenticated workflow integration', () => {
  it.effect('does not grant workspace:view to an anonymous request', () =>
    Effect.gen(function* () {
      const auth = yield* AuthService
      const error = yield* auth.requirePermission('workspace:view').pipe(
        Effect.provideService(
          AuthRequestContext,
          mapWorkOSSessionToAuthRequest({ user: null }),
        ),
        Effect.flip,
      )

      expectAuthError(error, 'requirePermission')
    }).pipe(Effect.provide(TestLayer)),
  )

  it.effect('does not grant workspace:view without an active organization', () =>
    Effect.gen(function* () {
      const auth = yield* AuthService
      const error = yield* auth.requirePermission('workspace:view').pipe(
        Effect.provideService(
          AuthRequestContext,
          mapWorkOSSessionToAuthRequest({
            user: workOSUser,
            sessionId: 'session_123',
            role: 'viewer',
          }),
        ),
        Effect.flip,
      )

      expectAuthError(error, 'requirePermission')
    }).pipe(Effect.provide(TestLayer)),
  )

  it.effect('starts a workflow from a WorkOS-authenticated request', () =>
    Effect.gen(function* () {
      const result = yield* runWithSession({
        user: workOSUser,
        sessionId: 'session_123',
        organizationId: 'org_123',
        role: 'operator',
      })

      expect(result.promptRequest.actorId).toBe('workos:user_123')
      expect(result.promptRequest.workspaceId).toBe('workos:org_123')
      expect(result.promptRequest.source).toBe('app')
      expect(result.promptRequest.prompt).toBe('Fix the bug')
      expect(result.workflowRun.workspaceId).toBe('workos:org_123')
    }),
  )

  it.effect('resolves workspace and memberships through WorkOS Node APIs', () =>
    Effect.gen(function* () {
      const auth = yield* AuthService
      const workspace = yield* auth.getCurrentWorkspace
      const memberships = yield* auth.listMemberships

      expect(workspace.id).toBe('workos:org_123')
      expect(workspace.name).toBe('Ada Labs')
      expect(memberships[0]?.id).toBe('om_123')
      expect(memberships[0]?.workspaceId).toBe('workos:org_123')
    }).pipe(
      Effect.provideService(
        AuthRequestContext,
        mapWorkOSSessionToAuthRequest({
          user: workOSUser,
          sessionId: 'session_123',
          organizationId: 'org_123',
          role: 'viewer',
        }),
      ),
      Effect.provide(TestLayer),
    ),
  )

  it.effect('wraps WorkOS organization API failures as AuthError', () =>
    Effect.gen(function* () {
      failOrganizationLookup = true
      const auth = yield* AuthService
      const error = yield* auth.getCurrentWorkspace.pipe(Effect.flip)

      expectAuthError(error, 'getCurrentWorkspace')
    }).pipe(
      Effect.provideService(
        AuthRequestContext,
        mapWorkOSSessionToAuthRequest({
          user: workOSUser,
          sessionId: 'session_123',
          organizationId: 'org_123',
          role: 'viewer',
        }),
      ),
      Effect.provide(TestLayer),
    ),
  )

  it.effect('wraps WorkOS membership API failures as AuthError', () =>
    Effect.gen(function* () {
      failMembershipLookup = true

      const error = yield* runWithSession({
        user: workOSUser,
        sessionId: 'session_123',
        organizationId: 'org_123',
        role: 'operator',
      }).pipe(Effect.flip)

      expectAuthError(error, 'listMemberships')
    }),
  )

  it.effect('allows canonical WorkOS permission claims with an active custom-role membership', () =>
    Effect.gen(function* () {
      testMembershipRole = 'custom-role'

      const result = yield* runWithSession({
        user: workOSUser,
        sessionId: 'session_123',
        organizationId: 'org_123',
        role: 'custom-role',
        permissions: ['prompt:create'],
      })

      expect(result.promptRequest.actorId).toBe('workos:user_123')
      expect(result.promptRequest.workspaceId).toBe('workos:org_123')
    }),
  )

  it.effect('does not grant canonical permission claims without an active WorkOS membership', () =>
    Effect.gen(function* () {
      testMembershipRole = 'custom-role'
      testMembershipStatus = 'pending'

      const error = yield* runWithSession({
        user: workOSUser,
        sessionId: 'session_123',
        organizationId: 'org_123',
        role: 'custom-role',
        permissions: ['prompt:create'],
      }).pipe(Effect.flip)

      expectAuthError(error, 'requirePermission')
    }),
  )

  it.effect('fails when the WorkOS session lacks prompt:create', () =>
    Effect.gen(function* () {
      testMembershipRole = 'viewer'

      const error = yield* runWithSession({
        user: workOSUser,
        sessionId: 'session_123',
        organizationId: 'org_123',
        role: 'viewer',
      }).pipe(Effect.flip)

      expectAuthError(error, 'requirePermission')
    }),
  )

  it.effect('fails when the WorkOS session has no active organization', () =>
    Effect.gen(function* () {
      const error = yield* runWithSession({
        user: workOSUser,
        sessionId: 'session_123',
        role: 'operator',
      }).pipe(Effect.flip)

      expectAuthError(error, 'getCurrentWorkspace')
    }),
  )
})
