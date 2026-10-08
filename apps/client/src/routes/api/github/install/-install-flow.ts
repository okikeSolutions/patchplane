import { Effect, Exit } from 'effect'

export interface GitHubInstallAuthState {
  readonly hasUser: boolean
  readonly organizationId?: string | undefined
  readonly accessToken?: string | undefined
}

export interface GitHubInstallAuthenticatedAuthState {
  readonly hasUser: true
  readonly organizationId: string
  readonly accessToken: string
}

export interface GitHubConnectionIntent {
  readonly workspaceId: string
  readonly actorId: string
  readonly returnPathname?: string | undefined
  readonly installationId: string
  readonly pkceVerifier: string
}

export function sanitizeGitHubInstallReturnPathname(value: string | null) {
  if (!value) return '/app'

  try {
    const url = new URL(value, 'https://patchplane.local')
    return `/${url.pathname.replace(/^\/+/, '')}${url.search}${url.hash}`
  } catch {
    return '/app'
  }
}

function authenticatedAuthState(
  auth: GitHubInstallAuthState,
): GitHubInstallAuthenticatedAuthState | undefined {
  if (!auth.hasUser || !auth.organizationId || !auth.accessToken) {
    return undefined
  }
  return {
    hasUser: true,
    organizationId: auth.organizationId,
    accessToken: auth.accessToken,
  }
}

export function redirectResponse(location: string, status = 307) {
  return new Response(null, { status, headers: { Location: location } })
}

export function createGitHubInstallStartResponse<E, R>(input: {
  readonly auth: GitHubInstallAuthState
  readonly requestUrl: string
  readonly state: string
  readonly installUrl: string
  readonly createIntent: (
    auth: GitHubInstallAuthenticatedAuthState,
    intent: {
      readonly state: string
      readonly workspaceId: string
      readonly returnPathname: string
    },
  ) => Effect.Effect<unknown, E, R>
}): Effect.Effect<Response, E, R> {
  const auth = authenticatedAuthState(input.auth)
  if (auth === undefined) {
    return Effect.succeed(
      redirectResponse('/api/auth/sign-in?returnPathname=/app'),
    )
  }

  const searchParams = new URL(input.requestUrl).searchParams
  const returnPathname = sanitizeGitHubInstallReturnPathname(
    searchParams.get('returnPathname'),
  )
  const installUrl = new URL(input.installUrl)
  installUrl.searchParams.set('state', input.state)

  return input
    .createIntent(auth, {
      state: input.state,
      workspaceId: `workos:${auth.organizationId}`,
      returnPathname,
    })
    .pipe(Effect.as(redirectResponse(installUrl.toString())))
}

export function createGitHubInstallCallbackResponse<E, R>(input: {
  readonly auth: GitHubInstallAuthState
  readonly requestUrl: string
  readonly stageInstallation: (
    auth: GitHubInstallAuthenticatedAuthState,
    input: {
      readonly state: string
      readonly workspaceId: string
      readonly installationId: string
    },
  ) => Effect.Effect<{ readonly authorizationUrl: string }, E, R>
  readonly consumeIntent: (
    auth: GitHubInstallAuthenticatedAuthState,
    input: { readonly state: string; readonly workspaceId: string },
  ) => Effect.Effect<GitHubConnectionIntent, E, R>
  readonly syncInstallation: (
    auth: GitHubInstallAuthenticatedAuthState,
    input: {
      readonly installationId: string
      readonly workspaceId: string
      readonly authorizationCode: string
      readonly pkceVerifier: string
    },
  ) => Effect.Effect<unknown, E, R>
}): Effect.Effect<Response, never, R> {
  const url = new URL(input.requestUrl)
  const installationId = url.searchParams.get('installation_id')
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const setupAction = url.searchParams.get('setup_action')

  if (installationId !== null && code !== null) {
    return Effect.succeed(
      redirectResponse(
        '/app?github=failed&reason=ambiguous_github_installation_callback_params',
        303,
      ),
    )
  }
  if (!state || (installationId === null && code === null)) {
    return Effect.succeed(
      redirectResponse(
        '/app?github=failed&reason=missing_github_installation_callback_params',
        303,
      ),
    )
  }
  if (setupAction !== null && !['install', 'update'].includes(setupAction)) {
    return Effect.succeed(
      redirectResponse(
        '/app?github=failed&reason=unsupported_github_installation_action',
        303,
      ),
    )
  }
  const auth = authenticatedAuthState(input.auth)
  if (auth === undefined) {
    return Effect.succeed(
      redirectResponse('/api/auth/sign-in?returnPathname=/app'),
    )
  }

  const workspaceId = `workos:${auth.organizationId}`
  if (installationId !== null) {
    return input
      .stageInstallation(auth, { state, workspaceId, installationId })
      .pipe(
        Effect.map((staged) => redirectResponse(staged.authorizationUrl, 303)),
        Effect.orElseSucceed(() =>
          redirectResponse(
            '/app?github=failed&reason=invalid_github_connection_state',
            303,
          ),
        ),
      )
  }
  if (code === null) {
    return Effect.succeed(
      redirectResponse(
        '/app?github=failed&reason=missing_github_user_authorization_code',
        303,
      ),
    )
  }

  return Effect.gen(function* () {
    const intentExit = yield* input
      .consumeIntent(auth, { state, workspaceId })
      .pipe(Effect.exit)
    if (Exit.isFailure(intentExit)) {
      return redirectResponse(
        '/app?github=failed&reason=invalid_github_user_authorization',
        303,
      )
    }
    const intent = intentExit.value
    const syncExit = yield* input
      .syncInstallation(auth, {
        installationId: intent.installationId,
        workspaceId: intent.workspaceId,
        authorizationCode: code,
        pkceVerifier: intent.pkceVerifier,
      })
      .pipe(Effect.exit)
    if (Exit.isFailure(syncExit)) {
      return redirectResponse(
        '/app?github=failed&reason=github_repository_sync_failed',
        303,
      )
    }

    const returnPathname = intent.returnPathname ?? '/app'
    const redirectUrl = new URL(returnPathname, 'https://patchplane.local')
    redirectUrl.searchParams.set('github', 'connected')
    return redirectResponse(
      `${redirectUrl.pathname}${redirectUrl.search}${redirectUrl.hash}`,
      303,
    )
  })
}
