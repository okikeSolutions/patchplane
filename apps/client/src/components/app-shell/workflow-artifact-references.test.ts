// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  decodeArtifactUrlPayload,
  openArtifact,
} from './workflow-artifact-references'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const expected = {
  artifactId: 'artifact_diff',
  baseUrl: 'https://app.patchplane.test/app/workflows/run_123?tab=evidence',
  workflowRunId: 'run_123',
}

describe('artifact opening', () => {
  test('aborts a stalled request at the Effect deadline', async () => {
    vi.useFakeTimers()
    let observedSignal: AbortSignal | undefined
    let notifyStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve
    })
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        observedSignal = init?.signal ?? undefined
        notifyStarted?.()
        return new Promise<Response>((_resolve, reject) => {
          observedSignal?.addEventListener(
            'abort',
            () => reject(observedSignal?.reason),
            { once: true },
          )
        })
      }),
    )
    const onComplete = vi.fn()
    const onError = vi.fn()
    const result = openArtifact(
      {
        id: 'artifact_diff',
        label: 'Diff',
        value: 'r2:diff',
        source: 'text/x-diff',
        artifactId: 'artifact_diff',
        workflowRunId: 'run_123',
      },
      { onStart: vi.fn(), onComplete, onError },
    )

    await started
    await vi.advanceTimersByTimeAsync(30_000)
    await result

    expect(observedSignal?.aborted).toBe(true)
    expect(onError).toHaveBeenCalledOnce()
    expect(onComplete).toHaveBeenCalledOnce()
  })

  test('keeps the fetch signal owned until a stalled response body is cancelled', async () => {
    vi.useFakeTimers()
    let observedSignal: AbortSignal | undefined
    let notifyBodyStarted: (() => void) | undefined
    const bodyStarted = new Promise<void>((resolve) => {
      notifyBodyStarted = resolve
    })
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        observedSignal = init?.signal ?? undefined
        return Promise.resolve({
          ok: true,
          json: () => {
            notifyBodyStarted?.()
            return new Promise<unknown>((_resolve, reject) => {
              observedSignal?.addEventListener(
                'abort',
                () => reject(observedSignal?.reason),
                { once: true },
              )
            })
          },
        } as Response)
      }),
    )
    const onComplete = vi.fn()
    const onError = vi.fn()
    const result = openArtifact(
      {
        id: 'artifact_diff',
        label: 'Diff',
        value: 'r2:diff',
        source: 'text/x-diff',
        artifactId: 'artifact_diff',
        workflowRunId: 'run_123',
      },
      { onStart: vi.fn(), onComplete, onError },
    )

    await bodyStarted
    await vi.advanceTimersByTimeAsync(30_000)
    await result

    expect(observedSignal?.aborted).toBe(true)
    expect(onError).toHaveBeenCalledOnce()
    expect(onComplete).toHaveBeenCalledOnce()
  })
})

describe('artifact download URL decoding', () => {
  test('accepts a candidate-bound same-origin download URL', () => {
    expect(
      decodeArtifactUrlPayload(
        {
          ok: true,
          artifactId: 'artifact_diff',
          workflowRunId: 'run_123',
          url: '/api/artifacts/url?artifactId=artifact_diff&workflowRunId=run_123&download=1',
        },
        expected,
      ),
    ).toEqual({
      ok: true,
      url: '/api/artifacts/url?artifactId=artifact_diff&workflowRunId=run_123&download=1',
    })
  })

  test.each([
    'https://evidence.example/api/artifacts/url?artifactId=artifact_diff&workflowRunId=run_123&download=1',
    '/api/artifacts/url?artifactId=another_artifact&workflowRunId=run_123&download=1',
    '/api/artifacts/url?artifactId=artifact_diff&workflowRunId=another_run&download=1',
    '/api/artifacts/url?artifactId=artifact_diff&workflowRunId=run_123',
    '/another-route?artifactId=artifact_diff&workflowRunId=run_123&download=1',
  ])('rejects an unbound or unsafe URL: %s', (url) => {
    expect(
      decodeArtifactUrlPayload({ ok: true, url }, expected),
    ).toBeUndefined()
  })

  test('preserves a bounded server error', () => {
    expect(
      decodeArtifactUrlPayload(
        { ok: false, error: 'Artifact not found' },
        expected,
      ),
    ).toEqual({ ok: false, error: 'Artifact not found' })
  })
})
