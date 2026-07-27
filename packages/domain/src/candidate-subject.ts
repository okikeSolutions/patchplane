import { Schema } from 'effect'
import { SandboxExecutionId } from './ids'
import { GitCommitSha, PositiveInt } from './refinements'

export const RepositoryExternalId = Schema.NonEmptyString.pipe(
  Schema.brand('RepositoryExternalId'),
)
export type RepositoryExternalId = Schema.Schema.Type<
  typeof RepositoryExternalId
>
export const PullRequestExternalId = Schema.NonEmptyString.pipe(
  Schema.brand('PullRequestExternalId'),
)
export type PullRequestExternalId = Schema.Schema.Type<
  typeof PullRequestExternalId
>
export const PullRequestNumber = PositiveInt.pipe(
  Schema.brand('PullRequestNumber'),
)

export type PullRequestNumber = Schema.Schema.Type<typeof PullRequestNumber>

export const makeRepositoryExternalId =
  Schema.decodeUnknownSync(RepositoryExternalId)
export const makePullRequestExternalId = Schema.decodeUnknownSync(
  PullRequestExternalId,
)
export const makePullRequestNumber = Schema.decodeUnknownSync(PullRequestNumber)

/** PatchPlane-owned identity for the incoming pull-request candidate under review. */
export const IncomingPullRequestCandidateSubject = Schema.Struct({
  kind: Schema.Literal('incoming-pull-request'),
  repositoryProvider: Schema.Literal('github'),
  repositoryExternalId: RepositoryExternalId,
  repositoryOwner: Schema.NonEmptyString,
  repositoryName: Schema.NonEmptyString,
  repositoryFullName: Schema.NonEmptyString,
  pullRequestExternalId: PullRequestExternalId,
  pullRequestNumber: PullRequestNumber,
  baseSha: GitCommitSha,
  headSha: GitCommitSha,
  sourceEventProvider: Schema.Literal('github'),
  sourceEventDeliveryId: Schema.NonEmptyString,
  sourceEventKind: Schema.Literals([
    'github.pull_request.opened',
    'github.pull_request.synchronize',
  ]),
}).check(
  Schema.makeFilter(
    (subject) =>
      subject.repositoryFullName ===
      `${subject.repositoryOwner}/${subject.repositoryName}`,
    { expected: 'repositoryFullName matching repositoryOwner/repositoryName' },
  ),
)
export type IncomingPullRequestCandidateSubject = Schema.Schema.Type<
  typeof IncomingPullRequestCandidateSubject
>

/** Existing generated-candidate foundation; it cannot identify an incoming PR. */
export const SandboxGeneratedCandidateSubject = Schema.Struct({
  kind: Schema.Literal('sandbox-generated'),
  sandboxExecutionId: SandboxExecutionId,
})
export type SandboxGeneratedCandidateSubject = Schema.Schema.Type<
  typeof SandboxGeneratedCandidateSubject
>

export const CandidateSubject = Schema.Union([
  IncomingPullRequestCandidateSubject,
  SandboxGeneratedCandidateSubject,
])
export type CandidateSubject = Schema.Schema.Type<typeof CandidateSubject>

export const decodeIncomingPullRequestCandidateSubject =
  Schema.decodeUnknownEffect(IncomingPullRequestCandidateSubject)
export const decodeCandidateSubject =
  Schema.decodeUnknownEffect(CandidateSubject)
