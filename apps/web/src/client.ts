import type { BrowserHttpClient } from '@effect/platform-browser'
import { Context, Effect, Layer, Match, Schema, Stream } from 'effect'
import { HttpClient, HttpClientRequest } from 'effect/http'
import { HttpApiClient } from 'effect/http-api'
import * as Redacted from 'effect/Redacted'
import {
  type AttemptDetail,
  DecisionInboxApi,
  type DecisionInboxStreamEvent,
  type InboxSnapshot,
  type SubmitDecisionPayload,
  type SubmitDecisionResponse,
} from '@patchplane/contracts'
import {
  sanitizeErrorMessage,
  type VerificationAttemptId,
} from '@patchplane/domain'

export type WebHttpClientLayer = typeof BrowserHttpClient.layerXMLHttpRequest

export const InboxUiErrorCode = Schema.Literals([
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'server_error',
  'transport_error',
  'decode_error',
  'stream_error',
])
export type InboxUiErrorCode = typeof InboxUiErrorCode.Type

export const InboxUiError = Schema.Struct({
  code: InboxUiErrorCode,
  message: Schema.NonEmptyString,
  retryable: Schema.Boolean,
})
export interface InboxUiError extends Schema.Schema.Type<typeof InboxUiError> {}

const safeNonEmpty = (value: string, fallback: string): string =>
  value.trim().length > 0 ? value.trim() : fallback

const mapTransportError = (error: unknown): InboxUiError => {
  if (typeof error === 'object' && error !== null && '_tag' in error) {
    const tag = String(Reflect.get(error, '_tag'))
    const rawMessage =
      'message' in error && typeof Reflect.get(error, 'message') === 'string'
        ? sanitizeErrorMessage(Reflect.get(error, 'message'))
        : sanitizeErrorMessage(error)
    return Match.value(tag).pipe(
      Match.when('InboxUnauthorizedError', () => ({
        code: 'unauthorized' as const,
        message: safeNonEmpty(rawMessage, 'Authentication required'),
        retryable: false,
      })),
      Match.when('InboxForbiddenError', () => ({
        code: 'forbidden' as const,
        message: safeNonEmpty(rawMessage, 'Repository permission required'),
        retryable: false,
      })),
      Match.when('InboxAttemptNotFoundError', () => ({
        code: 'not_found' as const,
        message: safeNonEmpty(rawMessage, 'Verification attempt not found'),
        retryable: false,
      })),
      Match.when('InboxDecisionConflictError', () => ({
        code: 'conflict' as const,
        message: safeNonEmpty(rawMessage, 'Decision conflict for proposal'),
        retryable: false,
      })),
      Match.when('InboxServerError', () => ({
        code: 'server_error' as const,
        message: safeNonEmpty(rawMessage, 'Control-plane server error'),
        retryable: true,
      })),
      Match.when('SchemaError', () => ({
        code: 'decode_error' as const,
        message: safeNonEmpty(rawMessage, 'Invalid server payload'),
        retryable: false,
      })),
      Match.when('SseError', () => ({
        code: 'stream_error' as const,
        message: safeNonEmpty(rawMessage, 'Live update stream error'),
        retryable: true,
      })),
      Match.orElse(() => ({
        code: 'transport_error' as const,
        message: safeNonEmpty(rawMessage, 'Network request failed'),
        retryable: true,
      })),
    )
  }

  return {
    code: 'transport_error',
    message: safeNonEmpty(
      sanitizeErrorMessage(error),
      'Network request failed',
    ),
    retryable: true,
  }
}

export interface DecisionInboxClientService {
  readonly listInbox: Effect.Effect<InboxSnapshot, InboxUiError>
  readonly getAttemptDetail: (
    attemptId: VerificationAttemptId,
  ) => Effect.Effect<AttemptDetail, InboxUiError>
  readonly submitDecision: (input: {
    readonly attemptId: VerificationAttemptId
    readonly payload: SubmitDecisionPayload
  }) => Effect.Effect<SubmitDecisionResponse, InboxUiError>
  readonly openEventStream: Effect.Effect<
    Stream.Stream<DecisionInboxStreamEvent, InboxUiError>,
    InboxUiError
  >
}

export class DecisionInboxClient extends Context.Service<
  DecisionInboxClient,
  DecisionInboxClientService
>()('@patchplane/web/DecisionInboxClient') {}

export interface DecisionInboxClientConfig {
  readonly baseUrl: string
  readonly bearerToken?: Redacted.Redacted
}

export const makeDecisionInboxClientLayer = (
  config: DecisionInboxClientConfig,
): Layer.Layer<DecisionInboxClient, never, HttpClient.HttpClient> =>
  Layer.effect(
    DecisionInboxClient,
    Effect.gen(function* () {
      const baseHttpClient = yield* HttpClient.HttpClient
      const httpClient =
        config.bearerToken !== undefined
          ? HttpClient.mapRequest(baseHttpClient, (request) =>
              HttpClientRequest.bearerToken(
                request,
                Redacted.value(config.bearerToken!),
              ),
            )
          : baseHttpClient

      const apiClient = yield* HttpApiClient.makeWith(DecisionInboxApi, {
        httpClient,
        baseUrl: config.baseUrl,
      })

      const listInbox = apiClient.inbox
        .listInbox({})
        .pipe(
          Effect.mapError(mapTransportError),
          Effect.withSpan('DecisionInboxClient.listInbox'),
        )

      const openEventStream = apiClient.inbox.streamEvents({}).pipe(
        Effect.map((eventStream) =>
          eventStream.pipe(Stream.mapError(mapTransportError)),
        ),
        Effect.mapError(mapTransportError),
        Effect.withSpan('DecisionInboxClient.openEventStream'),
      )

      return DecisionInboxClient.of({
        listInbox,

        getAttemptDetail: Effect.fn('DecisionInboxClient.getAttemptDetail')(
          function* (attemptId) {
            return yield* apiClient.inbox
              .getAttemptDetail({ params: { attemptId } })
              .pipe(Effect.mapError(mapTransportError))
          },
        ),

        submitDecision: Effect.fn('DecisionInboxClient.submitDecision')(
          function* ({ attemptId, payload }) {
            return yield* apiClient.inbox
              .submitDecision({ params: { attemptId }, payload })
              .pipe(Effect.mapError(mapTransportError))
          },
        ),

        openEventStream,
      })
    }),
  )
