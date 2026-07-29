import { Exit, Schema } from 'effect'

export const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))

export const PositiveFinite = Schema.Finite.check(Schema.isGreaterThan(0))

export const EpochMillis = NonNegativeInt

export const Sha256Hex = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{64}$/i),
)

export const ProviderProcessId = Schema.NonEmptyString.check(
  Schema.isMaxLength(256),
).pipe(Schema.brand('ProviderProcessId'))
export type ProviderProcessId = Schema.Schema.Type<typeof ProviderProcessId>

export const Sha256Digest = Schema.String.check(
  Schema.isPattern(/^sha256:[0-9a-f]{64}$/i),
)

export const GitCommitSha = Schema.String.check(
  Schema.isPattern(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/),
).pipe(Schema.brand('GitCommitSha'))
export type GitCommitSha = Schema.Schema.Type<typeof GitCommitSha>
export const makeGitCommitSha = Schema.decodeUnknownSync(GitCommitSha)

const decodeUrl = Schema.decodeUnknownExit(Schema.URLFromString)

export const HttpUrl = Schema.String.check(
  Schema.makeFilter(
    (value) => /^https?:\/\//i.test(value) && Exit.isSuccess(decodeUrl(value)),
    { expected: 'a valid HTTP or HTTPS URL' },
  ),
)
