import { Effect } from 'effect'
import type {
  PolicyBundle,
  RuntimeEventInput,
  RuntimeProviderEventInput,
} from '@patchplane/domain'
import { evaluateReviews } from './evaluate'
import {
  runConfiguredRuntimeReviewers,
  summarizeQueueMessagesFromProviderEvents,
} from './reviewers'
import { ReviewFailure } from '../errors'

const SYSTEM_REVIEW_ACTOR = 'system:policy-review'
const SYSTEM_INPUT_ACTOR = 'system:runtime-follow-up'

export interface RuntimeReviewOutcome {
  readonly reviewRuns: ReadonlyArray<{
    readonly reviewer: string
    readonly score: number
    readonly passed: boolean
    readonly summary: string
  }>
  readonly pendingApproval:
    | {
        readonly kind: string
        readonly title: string
        readonly body?: string
        readonly requestedByUserId: string
      }
    | undefined
  readonly pendingInputs: ReadonlyArray<{
    readonly kind: string
    readonly prompt: string
    readonly requestedByUserId: string
  }>
  readonly mergeDecision: {
    readonly status: 'pending' | 'approved' | 'rejected'
    readonly reasons: ReadonlyArray<string>
    readonly decidedByUserId?: string
  }
}

function buildPendingInputs(
  normalizedEvents: ReadonlyArray<RuntimeEventInput>,
  providerEvents: ReadonlyArray<RuntimeProviderEventInput>,
): RuntimeReviewOutcome['pendingInputs'] {
  const hasRuntimeFailure = normalizedEvents.some(
    (event) => event.type === 'session.failed' || event.type === 'turn.failed',
  )
  const queueMessages = summarizeQueueMessagesFromProviderEvents(providerEvents)

  if (hasRuntimeFailure) {
    const failureMessages = normalizedEvents
      .filter(
        (event) =>
          event.type === 'session.failed' || event.type === 'turn.failed',
      )
      .map((event) => event.message)
      .join(' ')

    return [
      {
        kind: 'runtime.follow_up',
        prompt:
          `Runtime execution failed. Provide follow-up guidance before retrying.` +
          (failureMessages.length > 0
            ? ` Last failure: ${failureMessages}`
            : ''),
        requestedByUserId: SYSTEM_INPUT_ACTOR,
      },
    ]
  }

  if (queueMessages.length > 0) {
    return [
      {
        kind: 'runtime.queue_resume',
        prompt:
          `Runtime finished with queued follow-up work. Review and provide the next operator message. ${queueMessages.join(' ')}`.trim(),
        requestedByUserId: SYSTEM_INPUT_ACTOR,
      },
    ]
  }

  return []
}

export function reviewRuntimeExecution(args: {
  readonly requestId: string
  readonly policy: Pick<PolicyBundle, 'requiredReviewers' | 'minimumScore'>
  readonly normalizedEvents: ReadonlyArray<RuntimeEventInput>
  readonly providerEvents: ReadonlyArray<RuntimeProviderEventInput>
}) {
  const pendingInputs = buildPendingInputs(
    args.normalizedEvents,
    args.providerEvents,
  )

  return runConfiguredRuntimeReviewers(args.policy.requiredReviewers, {
    normalizedEvents: args.normalizedEvents,
    providerEvents: args.providerEvents,
  }).pipe(
    Effect.flatMap((automatedReviewRuns) => {
      if (pendingInputs.length > 0) {
        return Effect.succeed<RuntimeReviewOutcome>({
          reviewRuns: automatedReviewRuns.map((reviewRun) => ({
            reviewer: reviewRun.reviewer,
            score: reviewRun.score,
            passed: reviewRun.passed,
            summary: reviewRun.summary,
          })),
          pendingApproval: undefined,
          pendingInputs,
          mergeDecision: {
            status: 'pending',
            reasons: [
              'Runtime execution requires operator follow-up before merge.',
            ],
          },
        })
      }

      return Effect.match(
        evaluateReviews(args.requestId, automatedReviewRuns, args.policy),
        {
          onFailure: (error: ReviewFailure): RuntimeReviewOutcome => ({
            reviewRuns: automatedReviewRuns.map((reviewRun) => ({
              reviewer: reviewRun.reviewer,
              score: reviewRun.score,
              passed: reviewRun.passed,
              summary: reviewRun.summary,
            })),
            pendingApproval: {
              kind: 'policy.manual_review',
              title: 'Manual review required',
              body: error.reasons.join(' '),
              requestedByUserId: SYSTEM_REVIEW_ACTOR,
            },
            pendingInputs: [],
            mergeDecision: {
              status: 'pending',
              reasons: [...error.reasons],
            },
          }),
          onSuccess: (evaluation): RuntimeReviewOutcome => ({
            reviewRuns: automatedReviewRuns.map((reviewRun) => ({
              reviewer: reviewRun.reviewer,
              score: reviewRun.score,
              passed: reviewRun.passed,
              summary: reviewRun.summary,
            })),
            pendingApproval: undefined,
            pendingInputs: [],
            mergeDecision: {
              status: 'approved',
              reasons: [
                `Automated review passed with average score ${evaluation.averageScore.toFixed(2)}.`,
              ],
              decidedByUserId: SYSTEM_REVIEW_ACTOR,
            },
          }),
        },
      )
    }),
  )
}
