import { assert, describe, expect, it } from '@effect/vitest'
import { Schema } from 'effect'
import { EvidenceArtifact } from './evidence-artifact'
import { GitCommitSha, HttpUrl } from './refinements'
import { SandboxPolicy } from './sandbox-policy'
import { VerificationResult } from './verification'

const decodeArtifact = Schema.decodeUnknownSync(EvidenceArtifact)
const decodePolicy = Schema.decodeUnknownSync(SandboxPolicy)
const decodeVerificationResult = Schema.decodeUnknownSync(VerificationResult)

describe('trust primitive refinements', () => {
  it('accepts only full SHA-1 or SHA-256 commit identifiers', () => {
    const decodeCommitSha = Schema.decodeUnknownSync(GitCommitSha)
    assert.strictEqual(decodeCommitSha('a'.repeat(40)), 'a'.repeat(40))
    assert.strictEqual(decodeCommitSha('b'.repeat(64)), 'b'.repeat(64))
    assert.throws(() => decodeCommitSha('A'.repeat(40)))
    assert.throws(() => decodeCommitSha('B'.repeat(64)))
    assert.throws(() => decodeCommitSha(`${'a'.repeat(39)}B`))
    assert.throws(() => decodeCommitSha('a'.repeat(39)))
    assert.throws(() => decodeCommitSha('a'.repeat(41)))
    assert.throws(() => decodeCommitSha('g'.repeat(40)))
    assert.throws(() => decodeCommitSha('a'.repeat(63)))
    assert.throws(() => decodeCommitSha('a'.repeat(65)))
  })

  it('rejects syntactically invalid HTTP URLs', () => {
    const decodeUrl = Schema.decodeUnknownSync(HttpUrl)
    expect(() => decodeUrl('http://%')).toThrow()
    expect(() => decodeUrl('https://?')).toThrow()
    expect(() => decodeUrl('https://#')).toThrow()
    expect(() => decodeUrl('https://example.com:99999')).toThrow()
    expect(() => decodeUrl('https://256.256.256.256')).toThrow()
    expect(decodeUrl('https://example.com/path')).toBe(
      'https://example.com/path',
    )
  })
  it('rejects malformed artifact digests, sizes, and timestamps', () => {
    const artifact = {
      id: 'artifact-1',
      workflowRunId: 'workflow-1',
      kind: 'stdout',
      storageProvider: 'cloudflare-r2',
      storageKey: 'workflows/workflow-1/stdout.txt',
      contentType: 'text/plain',
      sizeBytes: 1,
      sha256: 'a'.repeat(64),
      createdAt: 1,
    }

    expect(() =>
      decodeArtifact({ ...artifact, sha256: 'not-a-digest' }),
    ).toThrow()
    expect(() => decodeArtifact({ ...artifact, sizeBytes: -1 })).toThrow()
    expect(() => decodeArtifact({ ...artifact, createdAt: 1.5 })).toThrow()
  })

  it('rejects non-positive sandbox resources and timeouts', () => {
    const policy = {
      lifecycle: { ephemeral: true, retainAfterRun: false },
      network: {},
      resources: {},
    }

    expect(() => decodePolicy({ ...policy, resources: { cpu: 0 } })).toThrow()
    expect(() => decodePolicy({ ...policy, timeoutSeconds: -1 })).toThrow()
  })

  it('rejects malformed candidate digests and negative verification counts', () => {
    const result = {
      id: 'result-1',
      workflowRunId: 'workflow-1',
      requirementId: 'requirement-1',
      candidatePatchSetId: 'candidate-1',
      provider: 'daytona',
      platform: 'linux',
      architecture: 'x64',
      status: 'passed',
      exitCode: 0,
      artifactIds: [],
      producedArtifactKinds: [],
      candidateDigestBefore: `sha256:${'a'.repeat(64)}`,
      candidateDigestAfter: `sha256:${'a'.repeat(64)}`,
      startedAt: 1,
    }

    expect(() =>
      decodeVerificationResult({
        ...result,
        candidateDigestBefore: 'sha256:not-a-digest',
      }),
    ).toThrow()
    expect(() =>
      decodeVerificationResult({ ...result, passedCount: -1 }),
    ).toThrow()
    expect(() =>
      decodeVerificationResult({
        ...result,
        status: 'invalidated',
        candidateDigestBefore: undefined,
        candidateDigestAfter: undefined,
      }),
    ).not.toThrow()
  })
})
