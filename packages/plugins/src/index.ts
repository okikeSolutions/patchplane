import type { PgClient } from '@effect/sql-pg'
import { Effect, Layer } from 'effect'
import { AttemptStore } from '@patchplane/core'
import {
  AttemptNotFoundError,
  type VerificationAttempt,
  type VerificationAttemptId,
} from '@patchplane/domain'

export type PostgresClientConfig = PgClient.PgClientConfig

export const makeInMemoryAttemptStoreLayer = (
  attempts: ReadonlyMap<VerificationAttemptId, VerificationAttempt>,
) =>
  Layer.succeed(
    AttemptStore,
    AttemptStore.of({
      findById: Effect.fn('InMemoryAttemptStore.findById')(function* (
        attemptId: VerificationAttemptId,
      ) {
        const found = attempts.get(attemptId)
        if (found === undefined) {
          return yield* new AttemptNotFoundError({ attemptId })
        }
        return found
      }),
    }),
  )
