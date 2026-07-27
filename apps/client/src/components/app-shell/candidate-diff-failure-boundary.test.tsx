// @vitest-environment jsdom

import type { ReactNode } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  CandidateDiffFailureBoundary,
  CandidateDiffProcessorUnavailableError,
  candidateDiffRendererFailure,
} from './candidate-diff-failure-boundary'

function ThrowFailure({ error }: { readonly error: unknown }): ReactNode {
  throw error
}

describe('CandidateDiffFailureBoundary', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  test('maps parser and renderer failures to malformed evidence', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const onFailure = vi.fn()

    render(
      <CandidateDiffFailureBoundary
        fallbackKind="malformed"
        onFailure={onFailure}
      >
        <ThrowFailure error={new Error('raw candidate parser detail')} />
      </CandidateDiffFailureBoundary>,
    )

    expect(screen.getByRole('alert')).toBeTruthy()
    expect(
      screen.getByText('Diff format is malformed or unsupported'),
    ).toBeTruthy()
    expect(
      screen.getByText(
        'PatchPlane cannot establish trustworthy file and hunk boundaries for this artifact.',
      ),
    ).toBeTruthy()
    expect(screen.queryByText('raw candidate parser detail')).toBeNull()
    expect(onFailure).toHaveBeenCalledWith('malformed')
  })

  test('maps lazy processor and worker-style failures to unavailable evidence', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const onFailure = vi.fn()

    render(
      <CandidateDiffFailureBoundary
        fallbackKind="malformed"
        onFailure={onFailure}
      >
        <ThrowFailure error={new CandidateDiffProcessorUnavailableError()} />
      </CandidateDiffFailureBoundary>,
    )

    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByText('Diff processor could not be loaded')).toBeTruthy()
    expect(
      screen.getByText(/browser processing module is temporarily unavailable/),
    ).toBeTruthy()
    expect(onFailure).toHaveBeenCalledWith('processor-unavailable')
  })

  test('classifies untagged processor-boundary failures as unavailable', () => {
    expect(
      candidateDiffRendererFailure(
        new Error('worker initialization failed'),
        'processor-unavailable',
      ),
    ).toBe('processor-unavailable')
  })
})
