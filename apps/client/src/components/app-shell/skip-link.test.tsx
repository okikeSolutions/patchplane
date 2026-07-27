// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { SkipLink } from './skip-link'

afterEach(cleanup)

describe('SkipLink', () => {
  test('targets the primary content and becomes visible on focus', () => {
    render(
      <>
        <SkipLink />
        <main id="main-content">Content</main>
      </>,
    )
    const link = screen.getByRole('link', { name: 'Skip to main content' })
    expect(link.getAttribute('href')).toBe('#main-content')
    expect(link.className).toContain('focus:translate-y-0')
  })
})
