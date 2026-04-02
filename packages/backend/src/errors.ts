import { Data, ParseResult } from 'effect'
import { BoundaryFailure } from '@patchplane/domain'

export class BackendConfigFailure extends Data.TaggedError(
  'BackendConfigFailure',
)<{
  readonly message: string
  readonly issues: string
  readonly cause: ParseResult.ParseError
}> {}

export class ConvexInteropFailure extends Data.TaggedError(
  'ConvexInteropFailure',
)<{
  readonly message: string
  readonly operation: string
  readonly cause: unknown
}> {}

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

export function readErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof BoundaryFailure) {
    return `${error.boundary}: ${error.message}`
  }

  if (error instanceof BackendConfigFailure) {
    return `${error.message} ${error.issues}`.trim()
  }

  if (error instanceof ConvexInteropFailure) {
    return error.message
  }

  if (error instanceof Error && error.message.length > 0) {
    return error.message
  }

  return fallback
}
