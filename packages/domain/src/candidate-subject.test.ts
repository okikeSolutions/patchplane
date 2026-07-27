import { assert, describe, it } from '@effect/vitest'
import { Effect, Schema } from 'effect'
import {
  CandidateSubject,
  IncomingPullRequestCandidateSubject,
} from './candidate-subject'
import { CandidatePatchSet } from './decision-review'
import { makeGitCommitSha } from './refinements'

const incomingSubject = Schema.decodeUnknownSync(
  IncomingPullRequestCandidateSubject,
)({
  kind: 'incoming-pull-request',
  repositoryProvider: 'github',
  repositoryExternalId: '456',
  repositoryOwner: 'patchplane',
  repositoryName: 'demo',
  repositoryFullName: 'patchplane/demo',
  pullRequestExternalId: '789',
  pullRequestNumber: 7,
  baseSha: makeGitCommitSha('abcdefabcdefabcdefabcdefabcdefabcdefabcd'),
  headSha: makeGitCommitSha('0123456789012345678901234567890123456789'),
  sourceEventProvider: 'github',
  sourceEventDeliveryId: 'delivery-1',
  sourceEventKind: 'github.pull_request.synchronize',
})

describe('candidate subject', () => {
  it.effect('decodes an exact incoming pull-request subject', () =>
    Effect.gen(function* () {
      const subject = yield* Schema.decodeUnknownEffect(
        IncomingPullRequestCandidateSubject,
      )(incomingSubject)

      assert.deepStrictEqual(subject, incomingSubject)
    }),
  )

  it.effect('keeps generated and incoming candidate origins distinct', () =>
    Effect.gen(function* () {
      const generated = yield* Schema.decodeUnknownEffect(CandidateSubject)({
        kind: 'sandbox-generated',
        sandboxExecutionId: 'sandbox-1',
      })
      const incomingCandidate = yield* Schema.decodeUnknownEffect(
        CandidatePatchSet,
      )({
        id: 'candidate-1',
        workflowRunId: 'workflow-1',
        subject: incomingSubject,
        status: 'captured',
        candidateDigest: `sha256:${'a'.repeat(64)}`,
        baseSha: incomingSubject.baseSha,
        headSha: incomingSubject.headSha,
        diffArtifactId: 'artifact-1',
        createdAt: 1,
      })

      assert.strictEqual(generated.kind, 'sandbox-generated')
      assert.strictEqual(
        incomingCandidate.subject?.kind,
        'incoming-pull-request',
      )
      assert.strictEqual(
        incomingCandidate.candidateDigest,
        `sha256:${'a'.repeat(64)}`,
      )
    }),
  )

  it('rejects contradictory subject-bearing candidate records', () => {
    const decode = Schema.decodeUnknownSync(CandidatePatchSet)
    const candidate = {
      id: 'candidate-1',
      workflowRunId: 'workflow-1',
      subject: incomingSubject,
      status: 'captured',
      candidateDigest: `sha256:${'a'.repeat(64)}`,
      baseSha: incomingSubject.baseSha,
      headSha: incomingSubject.headSha,
      diffArtifactId: 'artifact-1',
      createdAt: 1,
    } as const

    assert.throws(() => decode({ ...candidate, baseSha: 'f'.repeat(40) }))
    assert.throws(() => decode({ ...candidate, candidateDigest: undefined }))
    assert.throws(() => decode({ ...candidate, diffArtifactId: undefined }))
    assert.doesNotThrow(() =>
      decode({
        ...candidate,
        status: 'failed',
        candidateDigest: undefined,
        diffArtifactId: undefined,
      }),
    )
    const generatedCandidate = {
      ...candidate,
      subject: {
        kind: 'sandbox-generated',
        sandboxExecutionId: 'sandbox-subject',
      },
      sandboxExecutionId: 'sandbox-subject',
    } as const
    assert.doesNotThrow(() => decode(generatedCandidate))
    assert.throws(() =>
      decode({ ...generatedCandidate, candidateDigest: undefined }),
    )
    assert.throws(() => decode({ ...generatedCandidate, status: 'failed' }))
    assert.doesNotThrow(() =>
      decode({
        ...generatedCandidate,
        status: 'empty',
        candidateDigest: undefined,
        diffArtifactId: undefined,
      }),
    )
    assert.throws(() =>
      decode({
        ...generatedCandidate,
        sandboxExecutionId: 'sandbox-record',
      }),
    )
  })

  it('rejects incomplete or malformed incoming pull-request identity', () => {
    const decode = Schema.decodeUnknownSync(IncomingPullRequestCandidateSubject)
    assert.throws(() =>
      decode({ ...incomingSubject, repositoryExternalId: undefined }),
    )
    assert.throws(() =>
      decode({ ...incomingSubject, pullRequestExternalId: '' }),
    )
    assert.throws(() =>
      decode({ ...incomingSubject, repositoryFullName: 'other/demo' }),
    )
    assert.throws(() =>
      decode({ ...incomingSubject, sourceEventProvider: 'gitlab' }),
    )
    assert.throws(() =>
      decode({ ...incomingSubject, sourceEventKind: 'github.issue.opened' }),
    )
    assert.throws(() => decode({ ...incomingSubject, pullRequestNumber: 0 }))
    assert.throws(() => decode({ ...incomingSubject, baseSha: undefined }))
    assert.throws(() => decode({ ...incomingSubject, headSha: undefined }))
  })
})
