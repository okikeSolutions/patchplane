import type { BrowserHttpClient } from '@effect/platform-browser'
import { Context, Duration, Effect, Layer, Match, Schema, Stream } from 'effect'
import * as Sse from 'effect/encoding/Sse'
import { HttpClient, HttpClientError, HttpClientRequest } from 'effect/http'
import { HttpApiClient } from 'effect/http-api'
import * as Redacted from 'effect/Redacted'
import {
  type AttemptDetail,
  DecisionInboxApi,
  type DecisionInboxStreamEvent,
  type InboxAttemptNotFoundError,
  type InboxDecisionConflictError,
  type InboxForbiddenError,
  type InboxServerError,
  type InboxSnapshot,
  type InboxUnauthorizedError,
  type SubmitDecisionPayload,
  type SubmitDecisionResponse,
} from '@patchplane/contracts'
import {
  sanitizeErrorMessage,
  type VerificationAttemptId,
} from '@patchplane/domain'

/**
 * Browser HTTP layer for Decision Inbox REST + SSE streaming.
 * Uses Fetch (`layerFetch`) rather than XHR so long-lived SSE streams do not
 * buffer the full response body in memory.
 */
export type WebHttpClientLayer = typeof BrowserHttpClient.layerFetch

export const InboxUiErrorCode = Schema.Literals([
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'server_error',
  'transport_error',
  'decode_error',
  'stream_error',
  'timeout',
])
export type InboxUiErrorCode = typeof InboxUiErrorCode.Type

export const InboxUiError = Schema.TaggedStruct('InboxUiError', {
  code: InboxUiErrorCode,
  message: Schema.NonEmptyString,
  retryable: Schema.Boolean,
})
export interface InboxUiError extends Schema.Schema.Type<typeof InboxUiError> {}

const makeUiError = (
  code: InboxUiErrorCode,
  message: string,
  fallback: string,
  retryable: boolean,
): InboxUiError => ({
  _tag: 'InboxUiError',
  code,
  message: message.trim().length > 0 ? message.trim() : fallback,
  retryable,
})

const mapHttpClientError = (
  error: HttpClientError.HttpClientError,
): InboxUiError =>
  Match.value(error.reason).pipe(
    Match.tag('StatusCodeError', (reason) => {
      const status = reason.response.status
      if (status === 401) {
        return makeUiError(
          'unauthorized',
          sanitizeErrorMessage(error),
          'Authentication required',
          false,
        )
      }
      if (status === 403) {
        return makeUiError(
          'forbidden',
          sanitizeErrorMessage(error),
          'Repository permission required',
          false,
        )
      }
      if (status === 404) {
        return makeUiError(
          'not_found',
          sanitizeErrorMessage(error),
          'Verification attempt not found',
          false,
        )
      }
      if (status === 409) {
        return makeUiError(
          'conflict',
          sanitizeErrorMessage(error),
          'Decision conflict for proposal',
          false,
        )
      }
      if (status >= 500) {
        return makeUiError(
          'server_error',
          sanitizeErrorMessage(error),
          'Control-plane server error',
          true,
        )
      }
      return makeUiError(
        'transport_error',
        sanitizeErrorMessage(error),
        `Unexpected HTTP status ${status}`,
        false,
      )
    }),
    Match.tag('DecodeError', () =>
      makeUiError(
        'decode_error',
        sanitizeErrorMessage(error),
        'Invalid server response payload',
        false,
      ),
    ),
    Match.tag('EmptyBodyError', () =>
      makeUiError(
        'decode_error',
        sanitizeErrorMessage(error),
        'Empty response body from server',
        false,
      ),
    ),
    Match.tag('EncodeError', () =>
      makeUiError(
        'transport_error',
        sanitizeErrorMessage(error),
        'Failed to encode request payload',
        false,
      ),
    ),
    Match.tag('InvalidUrlError', () =>
      makeUiError(
        'transport_error',
        sanitizeErrorMessage(error),
        'Invalid server endpoint URL',
        false,
      ),
    ),
    Match.tag('TransportError', () =>
      makeUiError(
        'transport_error',
        sanitizeErrorMessage(error),
        'Network request failed',
        true,
      ),
    ),
    Match.exhaustive,
  )

type ApiEndpointError =
  | InboxUnauthorizedError
  | InboxForbiddenError
  | InboxAttemptNotFoundError
  | InboxDecisionConflictError
  | InboxServerError
  | HttpClientError.HttpClientError
  | Schema.SchemaError

const mapApiError = (error: ApiEndpointError): InboxUiError =>
  Match.value(error).pipe(
    Match.tag('InboxUnauthorizedError', (err) =>
      makeUiError(
        'unauthorized',
        sanitizeErrorMessage(err.message),
        'Authentication required',
        false,
      ),
    ),
    Match.tag('InboxForbiddenError', (err) =>
      makeUiError(
        'forbidden',
        sanitizeErrorMessage(err.message),
        'Repository permission required',
        false,
      ),
    ),
    Match.tag('InboxAttemptNotFoundError', (err) =>
      makeUiError(
        'not_found',
        sanitizeErrorMessage(err.message),
        'Verification attempt not found',
        false,
      ),
    ),
    Match.tag('InboxDecisionConflictError', (err) =>
      makeUiError(
        'conflict',
        sanitizeErrorMessage(err.message),
        'Decision conflict for proposal',
        false,
      ),
    ),
    Match.tag('InboxServerError', (err) =>
      makeUiError(
        'server_error',
        sanitizeErrorMessage(err.message),
        'Control-plane server error',
        true,
      ),
    ),
    Match.tag('HttpClientError', mapHttpClientError),
    Match.tag('SchemaError', (err) =>
      makeUiError(
        'decode_error',
        sanitizeErrorMessage(err),
        'Invalid server payload',
        false,
      ),
    ),
    Match.exhaustive,
  )

type SseStreamError =
  | InboxUnauthorizedError
  | HttpClientError.HttpClientError
  | Schema.SchemaError
  | Sse.SseError
  | Sse.Retry

const mapStreamError = (error: SseStreamError): InboxUiError =>
  Match.value(error).pipe(
    Match.tag('InboxUnauthorizedError', (err) =>
      makeUiError(
        'unauthorized',
        sanitizeErrorMessage(err.message),
        'Authentication required',
        false,
      ),
    ),
    Match.tag('HttpClientError', mapHttpClientError),
    Match.tag('SchemaError', (err) =>
      makeUiError(
        'decode_error',
        sanitizeErrorMessage(err),
        'Invalid SSE event payload',
        false,
      ),
    ),
    Match.tag('SseError', (err) =>
      makeUiError(
        'stream_error',
        sanitizeErrorMessage(err),
        'Live update stream error',
        true,
      ),
    ),
    Match.tag('Retry', (retry) =>
      makeUiError(
        'stream_error',
        `Server requested SSE reconnect in ${Duration.toMillis(retry.duration)}ms`,
        'Server requested SSE reconnect',
        true,
      ),
    ),
    Match.exhaustive,
  )

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
  readonly requestTimeout?: Duration.Input
}

export const makeDecisionInboxClientLayer = (
  config: DecisionInboxClientConfig,
): Layer.Layer<DecisionInboxClient, never, HttpClient.HttpClient> =>
  Layer.effect(
    DecisionInboxClient,
    Effect.gen(function* () {
      const baseHttpClient = yield* HttpClient.HttpClient
      const bearerToken = config.bearerToken
      const timeoutDuration = Duration.fromInputUnsafe(
        config.requestTimeout ?? '15 seconds',
      )

      const httpClient =
        bearerToken !== undefined
          ? HttpClient.mapRequest(baseHttpClient, (request) =>
              HttpClientRequest.bearerToken(
                request,
                Redacted.value(bearerToken),
              ),
            )
          : baseHttpClient

      const apiClient = yield* HttpApiClient.makeWith(DecisionInboxApi, {
        httpClient,
        baseUrl: config.baseUrl,
      })

      const withRequestTimeout = <A>(
        effect: Effect.Effect<A, InboxUiError>,
        operation: string,
      ): Effect.Effect<A, InboxUiError> =>
        effect.pipe(
          Effect.timeoutOrElse({
            duration: timeoutDuration,
            orElse: () =>
              Effect.fail(
                makeUiError(
                  'timeout',
                  `${operation} timed out`,
                  'Request timed out',
                  true,
                ),
              ),
          }),
        )

      const listInbox = withRequestTimeout(
        apiClient.inbox.listInbox({}).pipe(Effect.mapError(mapApiError)),
        'DecisionInboxClient.listInbox',
      ).pipe(Effect.withSpan('DecisionInboxClient.listInbox'))

      const openEventStream = apiClient.inbox.streamEvents({}).pipe(
        Effect.map((eventStream) =>
          eventStream.pipe(Stream.mapError(mapStreamError)),
        ),
        Effect.mapError(mapApiError),
        Effect.withSpan('DecisionInboxClient.openEventStream'),
      )

      return DecisionInboxClient.of({
        listInbox,

        getAttemptDetail: Effect.fn('DecisionInboxClient.getAttemptDetail')(
          function* (attemptId) {
            return yield* withRequestTimeout(
              apiClient.inbox
                .getAttemptDetail({ params: { attemptId } })
                .pipe(Effect.mapError(mapApiError)),
              'DecisionInboxClient.getAttemptDetail',
            )
          },
        ),

        submitDecision: Effect.fn('DecisionInboxClient.submitDecision')(
          function* ({ attemptId, payload }) {
            return yield* withRequestTimeout(
              apiClient.inbox
                .submitDecision({ params: { attemptId }, payload })
                .pipe(Effect.mapError(mapApiError)),
              'DecisionInboxClient.submitDecision',
            )
          },
        ),

        openEventStream,
      })
    }),
  )
