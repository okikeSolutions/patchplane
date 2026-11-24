import { Effect, Equal, Match, Option, Schema, Stream } from 'effect'
import * as Command from 'foldkit/command'
import * as Message from 'foldkit/message'
import * as Navigation from 'foldkit/navigation'
import * as FoldkitSchema from 'foldkit/schema'
import * as Subscription from 'foldkit/subscription'
import type * as Update from 'foldkit/update'
import * as FoldkitUrl from 'foldkit/url'
import {
  AttemptDetail,
  AttemptSummary,
  DecisionInboxStreamEvent,
  DiffIslandEvent,
  InboxRevision,
  InboxSnapshot,
  SubmitDecisionResponse,
} from '@patchplane/contracts'
import {
  AcceptanceDecision,
  DecisionKind,
  ProposalVersion,
  VerificationAttemptId,
} from '@patchplane/domain'
import { DecisionInboxClient, InboxUiError } from './client'
import {
  AppRoute,
  attemptDetailRouter,
  inboxRouter,
  urlToAppRoute,
} from './routes'

export const InboxLoadState = FoldkitSchema.defineTaggedUnion({
  Idle: {},
  Loading: {},
  Loaded: {},
  Failed: {
    error: InboxUiError,
  },
})
export type InboxLoadState = typeof InboxLoadState.Type

export const AttemptDetailState = FoldkitSchema.defineTaggedUnion({
  Idle: {},
  Loading: {
    attemptId: VerificationAttemptId,
  },
  Loaded: {
    detail: AttemptDetail,
  },
  Failed: {
    attemptId: VerificationAttemptId,
    error: InboxUiError,
  },
})
export type AttemptDetailState = typeof AttemptDetailState.Type

export const DecisionSubmissionState = FoldkitSchema.defineTaggedUnion({
  Idle: {},
  Submitting: {
    attemptId: VerificationAttemptId,
    kind: DecisionKind,
  },
  Submitted: {
    decision: AcceptanceDecision,
  },
  Failed: {
    attemptId: VerificationAttemptId,
    error: InboxUiError,
  },
})
export type DecisionSubmissionState = typeof DecisionSubmissionState.Type

export const SseConnectionState = FoldkitSchema.defineTaggedUnion({
  Disconnected: {},
  Connecting: {},
  Connected: {},
  Failed: {
    error: InboxUiError,
  },
})
export type SseConnectionState = typeof SseConnectionState.Type

export const SelectedDiffLine = Schema.Struct({
  attemptId: VerificationAttemptId,
  path: Schema.NonEmptyString,
  lineNumber: Schema.Int.check(Schema.isGreaterThan(0)),
})
export interface SelectedDiffLine extends Schema.Schema.Type<
  typeof SelectedDiffLine
> {}

export const DiffIslandMountIdentity = Schema.Struct({
  attemptId: VerificationAttemptId,
  proposalVersion: ProposalVersion,
})
export interface DiffIslandMountIdentity extends Schema.Schema.Type<
  typeof DiffIslandMountIdentity
> {}

export const RequestSequence = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
)

export const InboxModel = Schema.Struct({
  route: AppRoute,
  routingEnabled: Schema.Boolean,
  items: Schema.Array(AttemptSummary),
  lastStreamRevision: InboxRevision,
  listRequestSeq: RequestSequence,
  listState: InboxLoadState,
  selectedAttemptId: Schema.Option(VerificationAttemptId),
  detailRequestSeq: RequestSequence,
  activeDetail: AttemptDetailState,
  decisionRequestSeq: RequestSequence,
  decisionSubmission: DecisionSubmissionState,
  focusedFilePath: Schema.Option(Schema.NonEmptyString),
  selectedDiffLine: Schema.Option(SelectedDiffLine),
  diffIslandMount: Schema.Option(DiffIslandMountIdentity),
  sseConnection: SseConnectionState,
  streamEnabled: Schema.Boolean,
})
export type InboxModel = typeof InboxModel.Type

export const InboxMessage = Message.defineMessageUnion({
  UrlRequested: {
    request: Navigation.UrlRequest,
  },
  UrlChanged: {
    url: FoldkitUrl.Url,
  },
  CompletedNavigation: {},
  ClickedRefreshInbox: {},
  ClickedAttempt: {
    attemptId: VerificationAttemptId,
  },
  ClickedBackToInbox: {},
  ToggledLiveUpdates: {
    enabled: Schema.Boolean,
  },
  SucceededLoadInbox: {
    requestSeq: RequestSequence,
    snapshot: InboxSnapshot,
  },
  FailedLoadInbox: {
    requestSeq: RequestSequence,
    error: InboxUiError,
  },
  SucceededLoadAttemptDetail: {
    requestSeq: RequestSequence,
    attemptId: VerificationAttemptId,
    detail: AttemptDetail,
  },
  FailedLoadAttemptDetail: {
    requestSeq: RequestSequence,
    attemptId: VerificationAttemptId,
    error: InboxUiError,
  },
  ClickedSubmitDecision: {
    attemptId: VerificationAttemptId,
    proposalVersion: ProposalVersion,
    kind: DecisionKind,
  },
  SucceededSubmitDecision: {
    requestSeq: RequestSequence,
    attemptId: VerificationAttemptId,
    response: SubmitDecisionResponse,
  },
  FailedSubmitDecision: {
    requestSeq: RequestSequence,
    attemptId: VerificationAttemptId,
    error: InboxUiError,
  },
  SseConnected: {},
  SseEventReceived: {
    event: DecisionInboxStreamEvent,
  },
  SseStreamFailed: {
    error: InboxUiError,
  },
  SseDisconnected: {},
  DiffIslandMounted: {
    attemptId: VerificationAttemptId,
    proposalVersion: ProposalVersion,
  },
  DiffIslandUnmounted: {
    attemptId: VerificationAttemptId,
    proposalVersion: ProposalVersion,
  },
  DiffIslandEventReceived: {
    event: DiffIslandEvent,
  },
})
export type InboxMessage = typeof InboxMessage.Type

type InboxCommand = Command.Command<InboxMessage, never, DecisionInboxClient>

export const LoadInboxCommand = Command.define('LoadInbox', {
  args: {
    requestSeq: RequestSequence,
  },
  messages: [InboxMessage.SucceededLoadInbox, InboxMessage.FailedLoadInbox],
  execute: ({ requestSeq }) =>
    Effect.gen(function* () {
      const client = yield* DecisionInboxClient
      const snapshot = yield* client.listInbox
      return InboxMessage.SucceededLoadInbox({ requestSeq, snapshot })
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(InboxMessage.FailedLoadInbox({ requestSeq, error })),
      ),
    ),
})

export const LoadAttemptDetailCommand = Command.define('LoadAttemptDetail', {
  args: {
    attemptId: VerificationAttemptId,
    requestSeq: RequestSequence,
  },
  messages: [
    InboxMessage.SucceededLoadAttemptDetail,
    InboxMessage.FailedLoadAttemptDetail,
  ],
  execute: ({ attemptId, requestSeq }) =>
    Effect.gen(function* () {
      const client = yield* DecisionInboxClient
      const detail = yield* client.getAttemptDetail(attemptId)
      return InboxMessage.SucceededLoadAttemptDetail({
        requestSeq,
        attemptId,
        detail,
      })
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(
          InboxMessage.FailedLoadAttemptDetail({
            requestSeq,
            attemptId,
            error,
          }),
        ),
      ),
    ),
})

export const SubmitDecisionCommand = Command.define('SubmitDecision', {
  args: {
    attemptId: VerificationAttemptId,
    proposalVersion: ProposalVersion,
    kind: DecisionKind,
    requestSeq: RequestSequence,
  },
  messages: [
    InboxMessage.SucceededSubmitDecision,
    InboxMessage.FailedSubmitDecision,
  ],
  execute: ({ attemptId, proposalVersion, kind, requestSeq }) =>
    Effect.gen(function* () {
      const client = yield* DecisionInboxClient
      const response = yield* client.submitDecision({
        attemptId,
        payload: { proposalVersion, kind },
      })
      return InboxMessage.SucceededSubmitDecision({
        requestSeq,
        attemptId,
        response,
      })
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(
          InboxMessage.FailedSubmitDecision({
            requestSeq,
            attemptId,
            error,
          }),
        ),
      ),
    ),
})

export const PushUrlCommand = Command.define('PushUrl', {
  args: {
    url: Schema.String,
  },
  messages: [InboxMessage.CompletedNavigation],
  execute: ({ url }) =>
    Navigation.pushUrl(url).pipe(Effect.as(InboxMessage.CompletedNavigation())),
})

export const LoadExternalUrlCommand = Command.define('LoadExternalUrl', {
  args: {
    href: Schema.String,
  },
  messages: [InboxMessage.CompletedNavigation],
  execute: ({ href }) =>
    Navigation.load(href).pipe(Effect.as(InboxMessage.CompletedNavigation())),
})

export const inboxSubscriptions = Subscription.make<
  InboxModel,
  InboxMessage,
  DecisionInboxClient
>()((entry) => ({
  liveEvents: entry(
    { streamEnabled: Schema.Boolean },
    {
      modelToDependencies: (model) => ({
        streamEnabled: model.streamEnabled,
      }),
      dependenciesToStream: ({ streamEnabled }) => {
        if (!streamEnabled) {
          return Stream.empty
        }
        return Stream.unwrap(
          Effect.gen(function* () {
            const client = yield* DecisionInboxClient
            const eventStream = yield* client.openEventStream
            const mappedWithCleanEof = Stream.concat(
              eventStream.pipe(
                Stream.map((event): InboxMessage =>
                  InboxMessage.SseEventReceived({ event }),
                ),
              ),
              Stream.succeed<InboxMessage>(InboxMessage.SseDisconnected()),
            ).pipe(
              Stream.catch((error) =>
                Stream.succeed<InboxMessage>(
                  InboxMessage.SseStreamFailed({ error }),
                ),
              ),
            )
            return Stream.concat(
              Stream.succeed<InboxMessage>(InboxMessage.SseConnected()),
              mappedWithCleanEof,
            )
          }).pipe(
            Effect.catch((error) =>
              Effect.succeed(
                Stream.succeed<InboxMessage>(
                  InboxMessage.SseStreamFailed({ error }),
                ),
              ),
            ),
          ),
        )
      },
    },
  ),
}))

const upsertAttemptSummary = (
  items: ReadonlyArray<AttemptSummary>,
  summary: AttemptSummary,
): ReadonlyArray<AttemptSummary> => {
  const index = items.findIndex((item) => item.attemptId === summary.attemptId)
  if (index === -1) {
    return [summary, ...items]
  }
  return items.map((item, idx) => (idx === index ? summary : item))
}

const applyStatusChangeToSummary = (
  item: AttemptSummary,
  event: Extract<
    DecisionInboxStreamEvent,
    { readonly _tag: 'VerificationStatusChangedEvent' }
  >,
): AttemptSummary => ({
  attemptId: item.attemptId,
  changeRequestId: item.changeRequestId,
  repositoryId: item.repositoryId,
  title: item.title,
  status: event.status,
  generation: event.generation,
  proposalVersion: item.proposalVersion,
  nextAction: event.nextAction,
  updatedAtMs: event.updatedAtMs,
})

const applyStatusChangeToItems = (
  items: ReadonlyArray<AttemptSummary>,
  event: Extract<
    DecisionInboxStreamEvent,
    { readonly _tag: 'VerificationStatusChangedEvent' }
  >,
): ReadonlyArray<AttemptSummary> =>
  items.map((item) =>
    item.attemptId === event.attemptId
      ? applyStatusChangeToSummary(item, event)
      : item,
  )

const syncActiveDetailSummary = (
  activeDetail: AttemptDetailState,
  summary: AttemptSummary,
  revision?: InboxRevision,
  decision?: AcceptanceDecision,
): AttemptDetailState =>
  AttemptDetailState.matchOrElse(
    activeDetail,
    {
      Loaded: ({ detail }) =>
        detail.summary.attemptId === summary.attemptId
          ? AttemptDetailState.Loaded({
              detail: {
                revision:
                  revision !== undefined && revision > detail.revision
                    ? revision
                    : detail.revision,
                summary,
                diffText: detail.diffText,
                files: detail.files,
                decision: decision ?? detail.decision,
              },
            })
          : activeDetail,
    },
    () => activeDetail,
  )

const syncActiveDetailFromSnapshot = (
  activeDetail: AttemptDetailState,
  items: ReadonlyArray<AttemptSummary>,
  revision: InboxRevision,
): AttemptDetailState =>
  AttemptDetailState.matchOrElse(
    activeDetail,
    {
      Loaded: ({ detail }) => {
        const matching = items.find(
          (item) => item.attemptId === detail.summary.attemptId,
        )
        return matching !== undefined
          ? syncActiveDetailSummary(activeDetail, matching, revision)
          : activeDetail
      },
    },
    () => activeDetail,
  )

const syncActiveDetailStatus = (
  activeDetail: AttemptDetailState,
  event: Extract<
    DecisionInboxStreamEvent,
    { readonly _tag: 'VerificationStatusChangedEvent' }
  >,
): AttemptDetailState =>
  AttemptDetailState.matchOrElse(
    activeDetail,
    {
      Loaded: ({ detail }) =>
        detail.summary.attemptId === event.attemptId
          ? AttemptDetailState.Loaded({
              detail: {
                revision:
                  event.revision > detail.revision
                    ? event.revision
                    : detail.revision,
                summary: applyStatusChangeToSummary(detail.summary, event),
                diffText: detail.diffText,
                files: detail.files,
                decision: detail.decision,
              },
            })
          : activeDetail,
    },
    () => activeDetail,
  )

const buildInternalPath = (url: FoldkitUrl.Url): string => {
  const searchSuffix = Option.match(url.search, {
    onNone: () => '',
    onSome: (search) => (search.startsWith('?') ? search : `?${search}`),
  })
  const hashSuffix = Option.match(url.hash, {
    onNone: () => '',
    onSome: (hash) => (hash.startsWith('#') ? hash : `#${hash}`),
  })
  return `${url.pathname}${searchSuffix}${hashSuffix}`
}

export const makeInitialInboxModel = (
  route: AppRoute = AppRoute.Inbox(),
  options?: {
    readonly streamEnabled?: boolean
    readonly routingEnabled?: boolean
  },
): InboxModel => {
  const streamEnabled = options?.streamEnabled ?? true
  const routingEnabled = options?.routingEnabled ?? true
  return {
    route,
    routingEnabled,
    items: [],
    lastStreamRevision: 0,
    listRequestSeq: 0,
    listState: InboxLoadState.Idle(),
    selectedAttemptId: AppRoute.matchOrElse(
      route,
      {
        AttemptDetail: ({ attemptId }) => Option.some(attemptId),
      },
      () => Option.none(),
    ),
    detailRequestSeq: 0,
    activeDetail: AttemptDetailState.Idle(),
    decisionRequestSeq: 0,
    decisionSubmission: DecisionSubmissionState.Idle(),
    focusedFilePath: Option.none(),
    selectedDiffLine: Option.none(),
    diffIslandMount: Option.none(),
    sseConnection: streamEnabled
      ? SseConnectionState.Connecting()
      : SseConnectionState.Disconnected(),
    streamEnabled,
  }
}

export const initialInboxModel: InboxModel = makeInitialInboxModel()

export const initInbox = (
  url?: FoldkitUrl.Url,
  options?: {
    readonly streamEnabled?: boolean
    readonly routingEnabled?: boolean
  },
): Update.Return<InboxModel, InboxMessage, DecisionInboxClient> => {
  const route = url !== undefined ? urlToAppRoute(url) : AppRoute.Inbox()
  const base = makeInitialInboxModel(route, options)
  const listRequestSeq = 1
  const commands: Array<InboxCommand> = [
    LoadInboxCommand({ requestSeq: listRequestSeq }),
  ]

  return AppRoute.matchOrElse(
    route,
    {
      AttemptDetail: ({ attemptId }) => {
        const detailRequestSeq = 1
        return {
          model: {
            ...base,
            listRequestSeq,
            listState: InboxLoadState.Loading(),
            selectedAttemptId: Option.some(attemptId),
            detailRequestSeq,
            activeDetail: AttemptDetailState.Loading({ attemptId }),
          },
          commands: [
            ...commands,
            LoadAttemptDetailCommand({
              attemptId,
              requestSeq: detailRequestSeq,
            }),
          ],
        }
      },
    },
    () => ({
      model: {
        ...base,
        listRequestSeq,
        listState: InboxLoadState.Loading(),
      },
      commands,
    }),
  )
}

const transitionToRoute = (
  model: InboxModel,
  route: AppRoute,
): Update.Return<InboxModel, InboxMessage, DecisionInboxClient> =>
  AppRoute.match(route, {
    Inbox: () => ({
      model: {
        ...model,
        route,
        selectedAttemptId: Option.none(),
        detailRequestSeq: model.detailRequestSeq + 1,
        activeDetail: AttemptDetailState.Idle(),
        decisionRequestSeq: model.decisionRequestSeq + 1,
        decisionSubmission: DecisionSubmissionState.Idle(),
        focusedFilePath: Option.none(),
        selectedDiffLine: Option.none(),
      },
    }),
    AttemptDetail: ({ attemptId }) => {
      const nextDetailSeq = model.detailRequestSeq + 1
      return {
        model: {
          ...model,
          route,
          selectedAttemptId: Option.some(attemptId),
          detailRequestSeq: nextDetailSeq,
          activeDetail: AttemptDetailState.Loading({ attemptId }),
          decisionRequestSeq: model.decisionRequestSeq + 1,
          decisionSubmission: DecisionSubmissionState.Idle(),
          focusedFilePath: Option.none(),
          selectedDiffLine: Option.none(),
        },
        commands: [
          LoadAttemptDetailCommand({
            attemptId,
            requestSeq: nextDetailSeq,
          }),
        ],
      }
    },
    NotFound: () => ({
      model: {
        ...model,
        route,
        selectedAttemptId: Option.none(),
        detailRequestSeq: model.detailRequestSeq + 1,
        activeDetail: AttemptDetailState.Idle(),
        decisionRequestSeq: model.decisionRequestSeq + 1,
        decisionSubmission: DecisionSubmissionState.Idle(),
        focusedFilePath: Option.none(),
        selectedDiffLine: Option.none(),
      },
    }),
  })

export const updateInbox = (
  model: InboxModel,
  message: InboxMessage,
): Update.Return<InboxModel, InboxMessage, DecisionInboxClient> =>
  InboxMessage.match(message, {
    UrlRequested: ({ request }) =>
      Navigation.UrlRequest.match(request, {
        Internal: ({ url }) => {
          const targetRoute = urlToAppRoute(url)
          const targetPath = buildInternalPath(url)
          const next = Equal.equals(model.route, targetRoute)
            ? { model }
            : transitionToRoute(model, targetRoute)
          const navCommands: ReadonlyArray<InboxCommand> = model.routingEnabled
            ? [PushUrlCommand({ url: targetPath })]
            : []
          return {
            model: next.model,
            commands: [...(next.commands ?? []), ...navCommands],
          }
        },
        External: ({ href }) => ({
          model,
          commands: [LoadExternalUrlCommand({ href })],
        }),
      }),

    UrlChanged: ({ url }) => {
      const parsed = urlToAppRoute(url)
      if (Equal.equals(model.route, parsed)) {
        return { model }
      }
      return transitionToRoute(model, parsed)
    },

    CompletedNavigation: () => ({ model }),

    ClickedRefreshInbox: () => {
      const nextListSeq = model.listRequestSeq + 1
      return {
        model: {
          ...model,
          listRequestSeq: nextListSeq,
          listState: InboxLoadState.Loading(),
        },
        commands: [LoadInboxCommand({ requestSeq: nextListSeq })],
      }
    },

    ClickedAttempt: ({ attemptId }) => {
      const targetRoute = AppRoute.AttemptDetail({ attemptId })
      const next = Equal.equals(model.route, targetRoute)
        ? { model }
        : transitionToRoute(model, targetRoute)
      const navCommands: ReadonlyArray<InboxCommand> = model.routingEnabled
        ? [PushUrlCommand({ url: attemptDetailRouter({ attemptId }) })]
        : []
      return {
        model: next.model,
        commands: [...(next.commands ?? []), ...navCommands],
      }
    },

    ClickedBackToInbox: () => {
      const targetRoute = AppRoute.Inbox()
      const next = Equal.equals(model.route, targetRoute)
        ? { model }
        : transitionToRoute(model, targetRoute)
      const navCommands: ReadonlyArray<InboxCommand> = model.routingEnabled
        ? [PushUrlCommand({ url: inboxRouter() })]
        : []
      return {
        model: next.model,
        commands: [...(next.commands ?? []), ...navCommands],
      }
    },

    ToggledLiveUpdates: ({ enabled }) => ({
      model: {
        ...model,
        streamEnabled: enabled,
        sseConnection: enabled
          ? SseConnectionState.Connecting()
          : SseConnectionState.Disconnected(),
      },
    }),

    SucceededLoadInbox: ({ requestSeq, snapshot }) => {
      // Reject stale out-of-order inbox responses.
      if (requestSeq !== model.listRequestSeq) {
        return { model }
      }
      if (snapshot.revision < model.lastStreamRevision) {
        return {
          model: {
            ...model,
            listState: InboxLoadState.Loaded(),
          },
        }
      }
      return {
        model: {
          ...model,
          items: snapshot.items,
          lastStreamRevision: snapshot.revision,
          listState: InboxLoadState.Loaded(),
          activeDetail: syncActiveDetailFromSnapshot(
            model.activeDetail,
            snapshot.items,
            snapshot.revision,
          ),
        },
      }
    },

    FailedLoadInbox: ({ requestSeq, error }) => {
      if (requestSeq !== model.listRequestSeq) {
        return { model }
      }
      return {
        model: {
          ...model,
          listState: InboxLoadState.Failed({ error }),
        },
      }
    },

    SucceededLoadAttemptDetail: ({ requestSeq, attemptId, detail }) => {
      if (
        requestSeq !== model.detailRequestSeq ||
        !Option.contains(model.selectedAttemptId, attemptId)
      ) {
        return { model }
      }

      // Preserve newer live SSE summary fields if detail was fetched at an older revision.
      const existingSummary = model.items.find(
        (item) => item.attemptId === detail.summary.attemptId,
      )
      const isDetailOlderThanLive =
        detail.revision < model.lastStreamRevision &&
        existingSummary !== undefined &&
        existingSummary.updatedAtMs >= detail.summary.updatedAtMs

      const effectiveSummary = isDetailOlderThanLive
        ? existingSummary
        : detail.summary
      const effectiveRevision = isDetailOlderThanLive
        ? model.lastStreamRevision
        : detail.revision

      const mergedDetail: AttemptDetail = {
        revision: effectiveRevision,
        summary: effectiveSummary,
        diffText: detail.diffText,
        files: detail.files,
        decision: detail.decision,
      }

      return {
        model: {
          ...model,
          activeDetail: AttemptDetailState.Loaded({ detail: mergedDetail }),
          items: upsertAttemptSummary(model.items, effectiveSummary),
          lastStreamRevision:
            effectiveRevision > model.lastStreamRevision
              ? effectiveRevision
              : model.lastStreamRevision,
        },
      }
    },

    FailedLoadAttemptDetail: ({ requestSeq, attemptId, error }) => {
      if (
        requestSeq !== model.detailRequestSeq ||
        !Option.contains(model.selectedAttemptId, attemptId)
      ) {
        return { model }
      }
      return {
        model: {
          ...model,
          activeDetail: AttemptDetailState.Failed({ attemptId, error }),
        },
      }
    },

    ClickedSubmitDecision: ({ attemptId, proposalVersion, kind }) => {
      if (DecisionSubmissionState.guards.Submitting(model.decisionSubmission)) {
        return { model }
      }
      const nextDecisionSeq = model.decisionRequestSeq + 1
      return {
        model: {
          ...model,
          decisionRequestSeq: nextDecisionSeq,
          decisionSubmission: DecisionSubmissionState.Submitting({
            attemptId,
            kind,
          }),
        },
        commands: [
          SubmitDecisionCommand({
            attemptId,
            proposalVersion,
            kind,
            requestSeq: nextDecisionSeq,
          }),
        ],
      }
    },

    SucceededSubmitDecision: ({ requestSeq, attemptId, response }) => {
      if (
        requestSeq !== model.decisionRequestSeq ||
        !Option.contains(model.selectedAttemptId, attemptId)
      ) {
        return { model }
      }
      return {
        model: {
          ...model,
          items: upsertAttemptSummary(model.items, response.summary),
          activeDetail: syncActiveDetailSummary(
            model.activeDetail,
            response.summary,
            undefined,
            response.decision,
          ),
          decisionSubmission: DecisionSubmissionState.Submitted({
            decision: response.decision,
          }),
        },
      }
    },

    FailedSubmitDecision: ({ requestSeq, attemptId, error }) => {
      if (
        requestSeq !== model.decisionRequestSeq ||
        !Option.contains(model.selectedAttemptId, attemptId)
      ) {
        return { model }
      }
      return {
        model: {
          ...model,
          decisionSubmission: DecisionSubmissionState.Failed({
            attemptId,
            error,
          }),
        },
      }
    },

    SseConnected: () => ({
      model: {
        ...model,
        sseConnection: SseConnectionState.Connected(),
      },
    }),

    SseDisconnected: () => ({
      model: {
        ...model,
        sseConnection: SseConnectionState.Disconnected(),
      },
    }),

    SseStreamFailed: ({ error }) => ({
      model: {
        ...model,
        sseConnection: SseConnectionState.Failed({ error }),
      },
    }),

    SseEventReceived: ({ event }) => {
      if (event.revision < model.lastStreamRevision) {
        return { model }
      }
      return Match.value(event).pipe(
        Match.tag('InboxSnapshotEvent', (snapshot) => ({
          model: {
            ...model,
            items: snapshot.items,
            lastStreamRevision: snapshot.revision,
            listState: InboxLoadState.Loaded(),
            activeDetail: syncActiveDetailFromSnapshot(
              model.activeDetail,
              snapshot.items,
              snapshot.revision,
            ),
            sseConnection: SseConnectionState.Connected(),
          },
        })),
        Match.tag('InboxUpdatedEvent', ({ revision, summary }) => ({
          model: {
            ...model,
            items: upsertAttemptSummary(model.items, summary),
            lastStreamRevision: revision,
            activeDetail: syncActiveDetailSummary(
              model.activeDetail,
              summary,
              revision,
            ),
            sseConnection: SseConnectionState.Connected(),
          },
        })),
        Match.tag('VerificationStatusChangedEvent', (statusEvent) => ({
          model: {
            ...model,
            items: applyStatusChangeToItems(model.items, statusEvent),
            lastStreamRevision: statusEvent.revision,
            activeDetail: syncActiveDetailStatus(
              model.activeDetail,
              statusEvent,
            ),
            sseConnection: SseConnectionState.Connected(),
          },
        })),
        Match.tag(
          'DecisionRecordedEvent',
          ({ revision, decision, summary }) => ({
            model: {
              ...model,
              items: upsertAttemptSummary(model.items, summary),
              lastStreamRevision: revision,
              activeDetail: syncActiveDetailSummary(
                model.activeDetail,
                summary,
                revision,
                decision,
              ),
              sseConnection: SseConnectionState.Connected(),
            },
          }),
        ),
        Match.exhaustive,
      )
    },

    DiffIslandMounted: ({ attemptId, proposalVersion }) => ({
      model: {
        ...model,
        diffIslandMount: Option.some({ attemptId, proposalVersion }),
      },
    }),

    DiffIslandUnmounted: ({ attemptId, proposalVersion }) => ({
      model: {
        ...model,
        diffIslandMount: Option.match(model.diffIslandMount, {
          onNone: () => Option.none(),
          onSome: (mounted) =>
            mounted.attemptId === attemptId &&
            mounted.proposalVersion === proposalVersion
              ? Option.none()
              : Option.some(mounted),
        }),
      },
    }),

    DiffIslandEventReceived: ({ event }) => {
      // Ignore stale island events emitted for a previously viewed attempt.
      if (!Option.contains(model.selectedAttemptId, event.attemptId)) {
        return { model }
      }
      return Match.value(event).pipe(
        Match.tag('FileFocused', ({ path }) => ({
          model: {
            ...model,
            focusedFilePath: Option.some(path),
          },
        })),
        Match.tag('LineSelected', ({ attemptId, path, lineNumber }) => ({
          model: {
            ...model,
            focusedFilePath: Option.some(path),
            selectedDiffLine: Option.some({
              attemptId,
              path,
              lineNumber,
            }),
          },
        })),
        Match.exhaustive,
      )
    },
  })
