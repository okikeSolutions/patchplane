export interface GitHubInstallAuthState {
  readonly hasUser: boolean
  readonly organizationId?: string | undefined
  readonly accessToken?: string | undefined
}

export interface GitHubConnectionIntent {
  readonly workspaceId: string
  readonly actorId: string
  readonly returnPathname?: string | undefined
}

export function sanitizeGitHubInstallReturnPathname(value: string | null) {
  if (!value) {
    return '/app'
  }

  try {
    const url = new URL(value, 'https://patchplane.local')
    return `/${url.pathname.replace(/^\/+/, '')}${url.search}${url.hash}`
  } catch {
    return '/app'
  }
}

export function redirectResponse(location: string, status = 307) {
  return new Response(null, { status, headers: { Location: location } })
}

export async function createGitHubInstallStartResponse(input: {
  readonly auth: GitHubInstallAuthState
  readonly requestUrl: string
  readonly state: string
  readonly installUrl: string
  readonly createIntent: (intent: {
    readonly state: string
    readonly workspaceId: string
    readonly returnPathname: string
    readonly expiresAt: number
  }) => Promise<unknown>
  readonly now?: number
}) {
  if (!input.auth.hasUser || !input.auth.organizationId || !input.auth.accessToken) {
    return redirectResponse('/api/auth/sign-in?returnPathname=/app')
  }

  const searchParams = new URL(input.requestUrl).searchParams
  const returnPathname = sanitizeGitHubInstallReturnPathname(
    searchParams.get('returnPathname'),
  )

  await input.createIntent({
    state: input.state,
    workspaceId: `workos:${input.auth.organizationId}`,
    returnPathname,
    expiresAt: (input.now ?? Date.now()) + 10 * 60_000,
  })

  const installUrl = new URL(input.installUrl)
  installUrl.searchParams.set('state', input.state)
  return redirectResponse(installUrl.toString())
}

export async function createGitHubInstallCallbackResponse(input: {
  readonly auth: GitHubInstallAuthState
  readonly requestUrl: string
  readonly consumeIntent: (input: {
    readonly state: string
    readonly workspaceId: string
  }) => Promise<GitHubConnectionIntent>
  readonly syncInstallation: (input: {
    readonly installationId: string
    readonly workspaceId: string
  }) => Promise<unknown>
}) {
  const url = new URL(input.requestUrl)
  const installationId = url.searchParams.get('installation_id')
  const state = url.searchParams.get('state')
  const setupAction = url.searchParams.get('setup_action')

  if (!installationId || !state) {
    return redirectResponse('/app?github=failed&reason=missing_github_installation_callback_params', 303)
  }

  if (setupAction !== null && !['install', 'update'].includes(setupAction)) {
    return redirectResponse('/app?github=failed&reason=unsupported_github_installation_action', 303)
  }

  if (!input.auth.hasUser || !input.auth.organizationId || !input.auth.accessToken) {
    return redirectResponse('/api/auth/sign-in?returnPathname=/app')
  }

  const workspaceId = `workos:${input.auth.organizationId}`
  let intent: GitHubConnectionIntent
  try {
    intent = await input.consumeIntent({ state, workspaceId })
  } catch {
    return redirectResponse('/app?github=failed&reason=invalid_github_connection_state', 303)
  }

  try {
    await input.syncInstallation({ installationId, workspaceId: intent.workspaceId })
  } catch {
    return redirectResponse('/app?github=failed&reason=github_repository_sync_failed', 303)
  }

  const returnPathname = intent.returnPathname ?? '/app'
  const redirectUrl = new URL(returnPathname, 'https://patchplane.local')
  redirectUrl.searchParams.set('github', 'connected')
  return redirectResponse(`${redirectUrl.pathname}${redirectUrl.search}${redirectUrl.hash}`, 303)
}
