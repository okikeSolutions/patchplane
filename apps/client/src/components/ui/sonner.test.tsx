// @vitest-environment jsdom

import { cleanup, render, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { afterEach, expect, test, vi } from 'vitest'
import { Toaster } from './sonner'

vi.mock('@/components/theme-provider', () => ({
  useTheme: () => ({ theme: 'dark' }),
}))

afterEach(() => {
  toast.dismiss()
  cleanup()
})

test('renders Sonner with the active Patchplane theme', async () => {
  render(<Toaster />)
  toast.info('Updated')

  await waitFor(() => {
    expect(
      document
        .querySelector('[data-sonner-toaster]')
        ?.getAttribute('data-sonner-theme'),
    ).toBe('dark')
  })
})
