import { describe, expect, it } from '@effect/vitest'
import { Effect, Schema } from 'effect'
import {
  resolveAttemptSummary,
  ServerAttemptStoreLayer,
} from '../../apps/server/src/index'
import { initialInboxModel, updateInboxModel } from '../../apps/web/src/index'
import {
  AttemptGeneration,
  AttemptNotFoundError,
  ChangeRequestId,
  type VerificationAttempt,
  VerificationAttemptId,
} from '../../packages/domain/src/index'

describe('V2 greenfield core smoke', () => {
  it.effect(
    'resolves an attempt summary and updates the Foldkit inbox model',
    () =>
      Effect.gen(function* () {
        const changeRequestId =
          yield* Schema.decodeEffect(ChangeRequestId)('pr-42')
        const attemptId = yield* Schema.decodeEffect(VerificationAttemptId)(
          'attempt-1',
        )
        const generation = yield* Schema.decodeEffect(AttemptGeneration)(1)
        const attempts = new Map<VerificationAttemptId, VerificationAttempt>([
          [
            attemptId,
            {
              id: attemptId,
              changeRequestId,
              status: 'incomplete',
              generation,
            },
          ],
        ])

        const summary = yield* resolveAttemptSummary(attemptId).pipe(
          Effect.provide(ServerAttemptStoreLayer(attempts)),
        )
        expect(summary).toEqual({
          attemptId,
          changeRequestId,
          status: 'incomplete',
          nextAction: 'Inspect missing or blocked evidence',
        })

        const loaded = updateInboxModel(initialInboxModel, {
          _tag: 'InboxLoaded',
          items: [summary],
        })
        const selected = updateInboxModel(loaded, {
          _tag: 'AttemptSelected',
          attemptId,
        })
        expect(selected.items).toHaveLength(1)
        expect(selected.selectedAttemptId).toBe(attemptId)
      }),
  )

  it.effect('fails with typed AttemptNotFoundError when missing', () =>
    Effect.gen(function* () {
      const missingId = yield* Schema.decodeEffect(VerificationAttemptId)(
        'attempt-missing',
      )
      const error = yield* Effect.flip(
        resolveAttemptSummary(missingId).pipe(
          Effect.provide(ServerAttemptStoreLayer(new Map())),
        ),
      )
      expect(error).toEqual(new AttemptNotFoundError({ attemptId: missingId }))
    }),
  )
})
