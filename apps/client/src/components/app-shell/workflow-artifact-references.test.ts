import { describe, expect, test } from 'vitest'
import { decodeArtifactUrlPayload } from './workflow-artifact-references'

const expected = {
  artifactId: 'artifact_diff',
  baseUrl: 'https://app.patchplane.test/app/workflows/run_123?tab=evidence',
  workflowRunId: 'run_123',
}

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
