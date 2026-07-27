import { describe, expect, test } from 'vitest'
import { artifactMetadataFailureCode } from './artifact-metadata-failure'

describe('artifactMetadataFailureCode', () => {
  test.each([
    'Active WorkOS organization required',
    'Active membership required',
    'Permission required',
    'Workspace mismatch',
    'WorkOS workspace required',
  ])('classifies %s as an authorization failure', (message) => {
    expect(artifactMetadataFailureCode(new Error(message))).toBe(
      'artifact_authorization_required',
    )
  })

  test('classifies an expired Convex identity as authentication required', () => {
    expect(
      artifactMetadataFailureCode({
        cause: new Error('Uncaught ConvexError: Authentication required'),
      }),
    ).toBe('authentication_required')
  })

  test('keeps unexpected metadata failures retryable and provider-neutral', () => {
    expect(artifactMetadataFailureCode(new Error('connection reset'))).toBe(
      'artifact_metadata_unavailable',
    )
  })
})
