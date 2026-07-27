// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { appVersionIdFrom } from '@/lib/app-version'
import { AppVersionNotifier } from './app-version-notifier'

const mocks = vi.hoisted(() => ({
  info: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    info: mocks.info,
  },
}))

vi.mock('@/paraglide/messages', () => ({
  app_update_available_title: () => 'New version',
  app_update_available_description: () => 'Reload for the latest interface.',
  app_update_reload: () => 'Reload',
}))

function renderNotifier(bootVersionId: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <AppVersionNotifier
        bootVersionId={appVersionIdFrom(bootVersionId)}
      />
    </QueryClientProvider>,
  )
}

describe('AppVersionNotifier', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    mocks.info.mockReset()
  })

  test('shows one persistent reload action when the active version changes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({ versionId: 'version-b' }),
      ),
    )
    renderNotifier('version-a')

    await waitFor(() => {
      expect(mocks.info).toHaveBeenCalledTimes(1)
    })
    expect(mocks.info).toHaveBeenCalledWith('New version', {
      id: 'app-version-update',
      description: 'Reload for the latest interface.',
      duration: Infinity,
      action: {
        label: 'Reload',
        onClick: expect.any(Function),
      },
    })
  })

  test('does not notify when the active version is unchanged', async () => {
    const fetchVersion = vi.fn().mockResolvedValue(
      Response.json({ versionId: 'version-a' }),
    )
    vi.stubGlobal('fetch', fetchVersion)
    renderNotifier('version-a')

    await waitFor(() => {
      expect(fetchVersion).toHaveBeenCalledTimes(1)
    })
    expect(mocks.info).not.toHaveBeenCalled()
  })
})
