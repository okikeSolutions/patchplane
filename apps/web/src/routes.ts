import { pipe, Schema } from 'effect'
import * as Route from 'foldkit/route'
import { VerificationAttemptId } from '@patchplane/domain'

export const AppRoute = Route.defineRouteUnion({
  Inbox: {},
  AttemptDetail: {
    attemptId: VerificationAttemptId,
  },
  NotFound: {
    path: Schema.String,
  },
})
export type AppRoute = typeof AppRoute.Type

export const inboxRouter = pipe(Route.root, Route.mapTo(AppRoute.Inbox))

export const attemptDetailRouter = pipe(
  Route.literal('attempts'),
  Route.slash(Route.schemaSegment('attemptId', VerificationAttemptId)),
  Route.mapTo(AppRoute.AttemptDetail),
)

export const urlToAppRoute = Route.parseUrlWithFallback(
  Route.oneOf(attemptDetailRouter, inboxRouter),
  AppRoute.NotFound,
)
