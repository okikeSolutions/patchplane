import { Data } from 'effect'

export class ExecutionFailure extends Data.TaggedError('ExecutionFailure')<{
  readonly requestId: string
  readonly reason: string
}> {}

export class ReviewFailure extends Data.TaggedError('ReviewFailure')<{
  readonly requestId: string
  readonly minimumScore: number
  readonly actualScore: number
  readonly reasons: ReadonlyArray<string>
}> {}
