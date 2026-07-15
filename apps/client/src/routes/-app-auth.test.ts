import { QueryClient } from '@tanstack/react-query'
import { describe, expect, test, vi } from 'vitest'

const authState = vi.hoisted(() => ({
  user: null as null | { readonly id: string },
}))

vi.mock('@/lib/workos-initial-auth', () => ({
  getInitialAuthServerFn: vi.fn(async () => authState),
}))

vi.mock('@/components/app-shell/app-workflow-console-page', () => ({
  AppWorkflowConsolePage: () => null,
}))

async function runBeforeLoad(href: string) {
  const { Route } = await import('./app')
  const beforeLoad = Route.options.beforeLoad
  if (beforeLoad === undefined) throw new Error('Missing beforeLoad')

  const input: Parameters<typeof beforeLoad>[0] = {
    abortController: new AbortController(),
    cause: 'enter',
    context: {
      convexClient: {
        clearAuth() {},
        setAuth() {},
      },
      queryClient: new QueryClient(),
    },
    location: {
      hash: '',
      href,
      maskedLocation: undefined,
      pathname: href.split('?')[0] ?? href,
      publicHref: href,
      search: {},
      searchStr: href.includes('?') ? `?${href.split('?')[1]}` : '',
      state: { __TSR_index: 0 },
      unmaskOnReload: false,
      external: false,
    },
    matches: [],
    navigate: vi.fn(),
    buildLocation: vi.fn(),
    params: {},
    preload: false,
    routeId: '/app',
    search: {},
  }

  return beforeLoad(input)
}

describe('/app auth guard', () => {
  test('redirects signed-out users to sign in with the original app path', async () => {
    authState.user = null

    await expect(
      runBeforeLoad('/app/workflows/run_123?tab=evidence'),
    ).rejects.toMatchObject({
      options: {
        href: '/api/auth/sign-in?returnPathname=%2Fapp%2Fworkflows%2Frun_123%3Ftab%3Devidence',
        statusCode: 307,
      },
    })
  })

  test('allows signed-in users through', async () => {
    authState.user = { id: 'user_123' }

    await expect(runBeforeLoad('/app')).resolves.toBeUndefined()
  })
})
