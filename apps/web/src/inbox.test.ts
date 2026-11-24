import { describe, expect, it } from '@effect/vitest'
import { Option } from 'effect'
import * as Navigation from 'foldkit/navigation'
import { Scene, Story } from 'foldkit/test'
import * as Url from 'foldkit/url'
import type {
  AttemptDetail,
  AttemptSummary,
  SubmitDecisionResponse,
} from '@patchplane/contracts'
import {
  AcceptanceDecision,
  ActorId,
  AttemptGeneration,
  ChangeRequestId,
  DecisionId,
  ProposalVersion,
  RepositoryId,
  VerificationAttemptId,
} from '@patchplane/domain'
import {
  AppRoute,
  AttemptDetailState,
  attemptDetailRouter,
  DecisionSubmissionState,
  InboxLoadState,
  InboxMessage,
  inboxRouter,
  initInbox,
  LoadAttemptDetailCommand,
  LoadExternalUrlCommand,
  makeInitialInboxModel,
  MountDiffViewerIsland,
  PushUrlCommand,
  SseConnectionState,
  SubmitDecisionCommand,
  updateInbox,
  urlToAppRoute,
  viewInboxDocument,
} from './index'

const ATTEMPT_A = VerificationAttemptId.make('att-alpha-1')
const ATTEMPT_B = VerificationAttemptId.make('att-beta-2')
const CR_A = ChangeRequestId.make('pr-101')
const CR_B = ChangeRequestId.make('pr-102')
const REPO = RepositoryId.make('okikeSolutions/patchplane')
const GEN_1 = AttemptGeneration.make(1)
const GEN_2 = AttemptGeneration.make(2)
const VERSION_1 = ProposalVersion.make(1)

const SAMPLE_DIFF = [
  '--- a/src/math.ts',
  '+++ b/src/math.ts',
  '@@ -1,2 +1,3 @@',
  ' export const add = (a: number, b: number) => {',
  '-  return a - b',
  '+  // fix addition bug',
  '+  return a + b',
].join('\n')

const summaryA: AttemptSummary = {
  attemptId: ATTEMPT_A,
  changeRequestId: CR_A,
  repositoryId: REPO,
  title: 'Fix arithmetic helper',
  status: 'running',
  generation: GEN_1,
  proposalVersion: VERSION_1,
  nextAction: 'Await sandbox checks',
  updatedAtMs: 1_700_000_000_000,
}

const summaryB: AttemptSummary = {
  attemptId: ATTEMPT_B,
  changeRequestId: CR_B,
  repositoryId: REPO,
  title: 'Update Arbeo offline calculation',
  status: 'passed',
  generation: GEN_1,
  proposalVersion: VERSION_1,
  nextAction: 'Review Patch Report and approve',
  updatedAtMs: 1_700_000_005_000,
}

const detailA: AttemptDetail = {
  revision: 1,
  summary: summaryA,
  diffText: SAMPLE_DIFF,
  files: [
    {
      path: 'src/math.ts',
      hunkCount: 1,
      additions: 2,
      deletions: 1,
    },
  ],
  decision: null,
}

const detailB: AttemptDetail = {
  revision: 2,
  summary: summaryB,
  diffText: SAMPLE_DIFF.replaceAll('src/math.ts', 'src/arbeo.ts'),
  files: [
    {
      path: 'src/arbeo.ts',
      hunkCount: 1,
      additions: 2,
      deletions: 1,
    },
  ],
  decision: null,
}

const makeUiError = (
  code:
    | 'unauthorized'
    | 'forbidden'
    | 'not_found'
    | 'conflict'
    | 'stream_error',
  message: string,
  retryable = false,
) => ({
  _tag: 'InboxUiError' as const,
  code,
  message,
  retryable,
})

describe('Foldkit Web Decision Inbox routing & state machine', () => {
  it('parses and builds Inbox, AttemptDetail, NotFound routes and handles UrlChanged / UrlRequested without double transitions', () => {
    const rootUrl = Option.getOrThrow(Url.fromString('https://app.test/'))
    expect(urlToAppRoute(rootUrl)).toEqual(AppRoute.Inbox())
    expect(inboxRouter()).toBe('/')

    const detailPath = attemptDetailRouter({ attemptId: ATTEMPT_A })
    expect(detailPath).toBe(`/attempts/${ATTEMPT_A}`)
    const detailUrl = Option.getOrThrow(
      Url.fromString(`https://app.test${detailPath}?tab=diff#hunk-1`),
    )
    expect(urlToAppRoute(detailUrl)).toEqual(
      AppRoute.AttemptDetail({ attemptId: ATTEMPT_A }),
    )

    const unknownUrl = Option.getOrThrow(
      Url.fromString('https://app.test/unknown/path'),
    )
    expect(urlToAppRoute(unknownUrl)).toEqual(
      AppRoute.NotFound({ path: '/unknown/path' }),
    )

    // UrlRequested(Internal) preserves search + hash, transitions route, and
    // subsequent echoed UrlChanged for the same route is a no-op (no duplicate fetch).
    Story.story(
      updateInbox,
      Story.given(makeInitialInboxModel(AppRoute.Inbox())),
      Story.message(
        InboxMessage.UrlRequested({
          request: Navigation.UrlRequest.Internal({ url: detailUrl }),
        }),
      ),
      Story.Command.resolveAllExact(
        [
          PushUrlCommand({ url: `/attempts/${ATTEMPT_A}?tab=diff#hunk-1` }),
          InboxMessage.CompletedNavigation(),
        ],
        [
          LoadAttemptDetailCommand({ attemptId: ATTEMPT_A, requestSeq: 1 }),
          InboxMessage.SucceededLoadAttemptDetail({
            requestSeq: 1,
            attemptId: ATTEMPT_A,
            detail: detailA,
          }),
        ],
      ),
      // Echoed UrlChanged from Navigation.pushUrl does not re-fetch or route to NotFound
      Story.message(InboxMessage.UrlChanged({ url: detailUrl })),
      Story.Command.expectNone(),
      Story.model((model) => {
        expect(model.route).toEqual(
          AppRoute.AttemptDetail({ attemptId: ATTEMPT_A }),
        )
        expect(model.activeDetail).toEqual(
          AttemptDetailState.Loaded({ detail: detailA }),
        )
      }),
      // Browser back button triggers UrlChanged to root -> transitions cleanly to Inbox
      Story.message(InboxMessage.UrlChanged({ url: rootUrl })),
      Story.Command.expectNone(),
      Story.model((model) => {
        expect(model.route).toEqual(AppRoute.Inbox())
        expect(model.selectedAttemptId).toEqual(Option.none())
        expect(model.activeDetail).toEqual(AttemptDetailState.Idle())
      }),
      // External link delegates to LoadExternalUrlCommand
      Story.message(
        InboxMessage.UrlRequested({
          request: Navigation.UrlRequest.External({
            href: 'https://github.com/okikeSolutions/patchplane',
          }),
        }),
      ),
      Story.Command.resolve(
        LoadExternalUrlCommand({
          href: 'https://github.com/okikeSolutions/patchplane',
        }),
        InboxMessage.CompletedNavigation(),
      ),
    )
  })

  it('rejects stale out-of-order list, detail, decision, and island responses across rapid transitions', () => {
    const startModel = makeInitialInboxModel(AppRoute.Inbox(), {
      streamEnabled: true,
    })

    // Fire refresh #1, then fire refresh #2 before #1 completes
    const refresh1 = updateInbox(startModel, InboxMessage.ClickedRefreshInbox())
    expect(refresh1.commands?.map((cmd) => cmd.name)).toEqual(['LoadInbox'])
    const refresh2 = updateInbox(
      refresh1.model,
      InboxMessage.ClickedRefreshInbox(),
    )
    expect(refresh2.model.listRequestSeq).toBe(2)

    // Response #2 arrives first with revision 5
    const afterResp2 = updateInbox(
      refresh2.model,
      InboxMessage.SucceededLoadInbox({
        requestSeq: 2,
        snapshot: { revision: 5, items: [summaryA, summaryB] },
      }),
    )
    expect(afterResp2.model.items).toEqual([summaryA, summaryB])
    expect(afterResp2.model.lastStreamRevision).toBe(5)

    // Stale response #1 (both success and failure) arrives late and is ignored
    const afterStaleResp1 = updateInbox(
      afterResp2.model,
      InboxMessage.SucceededLoadInbox({
        requestSeq: 1,
        snapshot: { revision: 1, items: [summaryA] },
      }),
    )
    const afterStaleFail1 = updateInbox(
      afterStaleResp1.model,
      InboxMessage.FailedLoadInbox({
        requestSeq: 1,
        error: makeUiError('unauthorized', 'Late error'),
      }),
    )
    expect(afterStaleFail1.model.items).toEqual([summaryA, summaryB])
    expect(afterStaleFail1.model.listState).toEqual(InboxLoadState.Loaded())

    // Select Attempt A, start submitting a decision on A, then immediately switch to B
    const selectA = updateInbox(
      afterStaleFail1.model,
      InboxMessage.ClickedAttempt({ attemptId: ATTEMPT_A }),
    )
    const submittingA = updateInbox(
      selectA.model,
      InboxMessage.ClickedSubmitDecision({
        attemptId: ATTEMPT_A,
        proposalVersion: VERSION_1,
        kind: 'approve',
      }),
    )
    // Double submit while already Submitting is rejected
    const duplicateSubmit = updateInbox(
      submittingA.model,
      InboxMessage.ClickedSubmitDecision({
        attemptId: ATTEMPT_A,
        proposalVersion: VERSION_1,
        kind: 'reject',
      }),
    )
    expect(duplicateSubmit.commands).toBeUndefined()

    const selectB = updateInbox(
      submittingA.model,
      InboxMessage.ClickedAttempt({ attemptId: ATTEMPT_B }),
    )

    // Attempt B resolves first, and a live SSE update advances Attempt B before an older detail
    const afterSseOnB = updateInbox(
      selectB.model,
      InboxMessage.SseEventReceived({
        event: {
          _tag: 'VerificationStatusChangedEvent',
          revision: 8,
          attemptId: ATTEMPT_B,
          repositoryId: REPO,
          status: 'incomplete',
          generation: GEN_2,
          nextAction: 'Budget exhausted',
          updatedAtMs: 1_700_000_090_000,
        },
      }),
    )
    // Detail for B arrives from an older revision (2 < 8): keeps newer SSE status while loading diff!
    const loadedB = updateInbox(
      afterSseOnB.model,
      InboxMessage.SucceededLoadAttemptDetail({
        requestSeq: selectB.model.detailRequestSeq,
        attemptId: ATTEMPT_B,
        detail: detailB,
      }),
    )
    expect(
      AttemptDetailState.guards.Loaded(loadedB.model.activeDetail)
        ? loadedB.model.activeDetail.detail.summary.status
        : undefined,
    ).toBe('incomplete')

    // Late decision failure from Attempt A must NOT leak onto Attempt B's page
    const afterLateDecisionErrA = updateInbox(
      loadedB.model,
      InboxMessage.FailedSubmitDecision({
        requestSeq: submittingA.model.decisionRequestSeq,
        attemptId: ATTEMPT_A,
        error: makeUiError('conflict', 'Late conflict from A'),
      }),
    )
    expect(afterLateDecisionErrA.model.decisionSubmission).toEqual(
      DecisionSubmissionState.Idle(),
    )

    // Late detail success & failure for Attempt A are discarded
    const afterLateSuccessA = updateInbox(
      afterLateDecisionErrA.model,
      InboxMessage.SucceededLoadAttemptDetail({
        requestSeq: selectA.model.detailRequestSeq,
        attemptId: ATTEMPT_A,
        detail: detailA,
      }),
    )
    const afterLateFailureA = updateInbox(
      afterLateSuccessA.model,
      InboxMessage.FailedLoadAttemptDetail({
        requestSeq: selectA.model.detailRequestSeq,
        attemptId: ATTEMPT_A,
        error: makeUiError('not_found', 'Late error from A'),
      }),
    )
    expect(afterLateFailureA.model.selectedAttemptId).toEqual(
      Option.some(ATTEMPT_B),
    )

    // Stale island event from Attempt A is also ignored while Attempt B is selected
    const afterStaleIsland = updateInbox(
      afterLateFailureA.model,
      InboxMessage.DiffIslandEventReceived({
        event: {
          _tag: 'FileFocused',
          attemptId: ATTEMPT_A,
          path: 'src/math.ts',
        },
      }),
    )
    expect(afterStaleIsland.model.focusedFilePath).toEqual(Option.none())
  })

  it('handles live SSE updates, InboxUpdatedEvent, ToggledLiveUpdates, and rejects stale revisions without Convex', () => {
    const startModel = makeInitialInboxModel(AppRoute.Inbox(), {
      streamEnabled: true,
    })

    const recordedDecision: AcceptanceDecision = {
      id: DecisionId.make('dec-1'),
      attemptId: ATTEMPT_A,
      proposalVersion: VERSION_1,
      kind: 'approve',
      actorId: ActorId.make('maintainer-1'),
    }

    Story.story(
      updateInbox,
      Story.given({
        ...startModel,
        items: [summaryA],
        lastStreamRevision: 2,
        selectedAttemptId: Option.some(ATTEMPT_A),
        activeDetail: AttemptDetailState.Loaded({ detail: detailA }),
      }),
      Story.message(InboxMessage.SseConnected()),
      // Live status update advances both list item and active detail
      Story.message(
        InboxMessage.SseEventReceived({
          event: {
            _tag: 'VerificationStatusChangedEvent',
            revision: 3,
            attemptId: ATTEMPT_A,
            repositoryId: REPO,
            status: 'passed',
            generation: GEN_2,
            nextAction: 'Ready for maintainer approval',
            updatedAtMs: 1_700_000_010_000,
          },
        }),
      ),
      Story.model((model) => {
        expect(model.sseConnection).toEqual(SseConnectionState.Connected())
        expect(model.lastStreamRevision).toBe(3)
        expect(model.items[0]?.status).toBe('passed')
        expect(model.items[0]?.generation).toBe(GEN_2)
        expect(
          AttemptDetailState.guards.Loaded(model.activeDetail)
            ? model.activeDetail.detail.summary.status
            : undefined,
        ).toBe('passed')
      }),
      // InboxUpdatedEvent inserts a newly discovered attempt into the inbox
      Story.message(
        InboxMessage.SseEventReceived({
          event: {
            _tag: 'InboxUpdatedEvent',
            revision: 4,
            summary: summaryB,
          },
        }),
      ),
      Story.model((model) => {
        expect(model.items.map((item) => item.attemptId)).toContain(ATTEMPT_B)
        expect(model.lastStreamRevision).toBe(4)
      }),
      // Stale SSE event with lower revision is rejected
      Story.message(
        InboxMessage.SseEventReceived({
          event: {
            _tag: 'VerificationStatusChangedEvent',
            revision: 1,
            attemptId: ATTEMPT_A,
            repositoryId: REPO,
            status: 'failed',
            generation: GEN_1,
            nextAction: 'Stale regression',
            updatedAtMs: 1_699_999_999_000,
          },
        }),
      ),
      Story.model((model) => {
        const currentA = model.items.find((i) => i.attemptId === ATTEMPT_A)
        expect(currentA?.status).toBe('passed')
        expect(model.lastStreamRevision).toBe(4)
      }),
      // DecisionRecordedEvent syncs recorded decision into active detail
      Story.message(
        InboxMessage.SseEventReceived({
          event: {
            _tag: 'DecisionRecordedEvent',
            revision: 5,
            decision: recordedDecision,
            summary: {
              attemptId: summaryA.attemptId,
              changeRequestId: summaryA.changeRequestId,
              repositoryId: summaryA.repositoryId,
              title: summaryA.title,
              status: 'passed',
              generation: summaryA.generation,
              proposalVersion: summaryA.proposalVersion,
              nextAction: 'Approved',
              updatedAtMs: summaryA.updatedAtMs,
            },
          },
        }),
      ),
      Story.model((model) => {
        expect(
          AttemptDetailState.guards.Loaded(model.activeDetail)
            ? model.activeDetail.detail.decision
            : null,
        ).toEqual(recordedDecision)
      }),
      // Pausing and resuming live updates transitions streamEnabled and sseConnection
      Story.message(InboxMessage.ToggledLiveUpdates({ enabled: false })),
      Story.model((model) => {
        expect(model.streamEnabled).toBe(false)
        expect(model.sseConnection).toEqual(SseConnectionState.Disconnected())
      }),
      Story.message(InboxMessage.ToggledLiveUpdates({ enabled: true })),
      Story.model((model) => {
        expect(model.streamEnabled).toBe(true)
        expect(model.sseConnection).toEqual(SseConnectionState.Connecting())
      }),
    )
  })

  it('surfaces typed errors for inbox load, detail load, decision conflict, and SSE failure', () => {
    const booted = initInbox(
      Option.getOrThrow(Url.fromString('https://app.test/')),
    )
    expect(booted.model.listState).toEqual(InboxLoadState.Loading())
    expect(booted.commands).toHaveLength(1)

    Story.story(
      updateInbox,
      Story.given(booted.model),
      Story.message(
        InboxMessage.FailedLoadInbox({
          requestSeq: 1,
          error: makeUiError('unauthorized', 'WorkOS session expired'),
        }),
      ),
      Story.model((model) => {
        expect(model.listState).toEqual(
          InboxLoadState.Failed({
            error: makeUiError('unauthorized', 'WorkOS session expired'),
          }),
        )
      }),
      Story.message(InboxMessage.ClickedAttempt({ attemptId: ATTEMPT_A })),
      Story.Command.resolveAllExact(
        [
          PushUrlCommand({ url: `/attempts/${ATTEMPT_A}` }),
          InboxMessage.CompletedNavigation(),
        ],
        [
          LoadAttemptDetailCommand({ attemptId: ATTEMPT_A, requestSeq: 1 }),
          InboxMessage.FailedLoadAttemptDetail({
            requestSeq: 1,
            attemptId: ATTEMPT_A,
            error: makeUiError('forbidden', 'Write permission required'),
          }),
        ],
      ),
      Story.model((model) => {
        expect(model.activeDetail).toEqual(
          AttemptDetailState.Failed({
            attemptId: ATTEMPT_A,
            error: makeUiError('forbidden', 'Write permission required'),
          }),
        )
      }),
      Story.message(
        InboxMessage.ClickedSubmitDecision({
          attemptId: ATTEMPT_A,
          proposalVersion: VERSION_1,
          kind: 'approve',
        }),
      ),
      Story.Command.resolve(
        SubmitDecisionCommand({
          attemptId: ATTEMPT_A,
          proposalVersion: VERSION_1,
          kind: 'approve',
          requestSeq: 2,
        }),
        InboxMessage.FailedSubmitDecision({
          requestSeq: 2,
          attemptId: ATTEMPT_A,
          error: makeUiError('conflict', 'Proposal v1 already rejected'),
        }),
      ),
      Story.model((model) => {
        expect(model.decisionSubmission).toEqual(
          DecisionSubmissionState.Failed({
            attemptId: ATTEMPT_A,
            error: makeUiError('conflict', 'Proposal v1 already rejected'),
          }),
        )
      }),
      Story.message(
        InboxMessage.SseStreamFailed({
          error: makeUiError('stream_error', 'Upstream SSE dropped', true),
        }),
      ),
      Story.model((model) => {
        expect(model.sseConnection).toEqual(
          SseConnectionState.Failed({
            error: makeUiError('stream_error', 'Upstream SSE dropped', true),
          }),
        )
      }),
    )
  })

  it('drives UI interactions, React diff island mount/events/unmount, and live updates in Foldkit Scene', () => {
    const decisionResponse: SubmitDecisionResponse = {
      decision: {
        id: DecisionId.make('dec-approve-1'),
        attemptId: ATTEMPT_A,
        proposalVersion: VERSION_1,
        kind: 'approve',
        actorId: ActorId.make('maintainer-1'),
      },
      summary: {
        attemptId: summaryA.attemptId,
        changeRequestId: summaryA.changeRequestId,
        repositoryId: summaryA.repositoryId,
        title: summaryA.title,
        status: 'passed',
        generation: summaryA.generation,
        proposalVersion: summaryA.proposalVersion,
        nextAction: 'Approved by maintainer',
        updatedAtMs: summaryA.updatedAtMs,
      },
    }

    Scene.scene(
      { update: updateInbox, view: viewInboxDocument },
      Scene.given({
        ...makeInitialInboxModel(AppRoute.Inbox(), { streamEnabled: true }),
        items: [summaryA, summaryB],
        listState: InboxLoadState.Loaded(),
        sseConnection: SseConnectionState.Connected(),
      }),
      Scene.expect(Scene.testId('sse-status')).toHaveText(
        'Live updates active',
      ),
      Scene.click(Scene.testId(`select-attempt-${ATTEMPT_A}`)),
      Scene.Command.resolveAllExact(
        [
          PushUrlCommand({ url: `/attempts/${ATTEMPT_A}` }),
          InboxMessage.CompletedNavigation(),
        ],
        [
          LoadAttemptDetailCommand({ attemptId: ATTEMPT_A, requestSeq: 1 }),
          InboxMessage.SucceededLoadAttemptDetail({
            requestSeq: 1,
            attemptId: ATTEMPT_A,
            detail: detailA,
          }),
        ],
      ),
      // React diff island is mounted via Foldkit OnMount
      Scene.Mount.expectExact(MountDiffViewerIsland),
      Scene.Mount.resolve(
        MountDiffViewerIsland,
        InboxMessage.DiffIslandEventReceived({
          event: {
            _tag: 'LineSelected',
            attemptId: ATTEMPT_A,
            path: 'src/math.ts',
            lineNumber: 3,
          },
        }),
      ),
      Scene.expect(Scene.testId('focused-file')).toHaveText(
        'Focused file: src/math.ts',
      ),
      Scene.expect(Scene.testId('selected-line')).toHaveText(
        'Selected src/math.ts:3',
      ),
      Scene.expect(Scene.testId('diff-island-host')).toHaveAttr(
        'data-focused-file',
        'src/math.ts',
      ),
      // Approve decision through Foldkit Command
      Scene.click(Scene.testId('decision-approve')),
      Scene.Command.resolve(
        SubmitDecisionCommand({
          attemptId: ATTEMPT_A,
          proposalVersion: VERSION_1,
          kind: 'approve',
          requestSeq: 2,
        }),
        InboxMessage.SucceededSubmitDecision({
          requestSeq: 2,
          attemptId: ATTEMPT_A,
          response: decisionResponse,
        }),
      ),
      Scene.expect(Scene.testId('decision-status')).toContainText(
        'Decision recorded: approve (v1)',
      ),
      // Live SSE update refreshes status directly in the rendered DOM
      Scene.Subscription.emit(
        InboxMessage.SseEventReceived({
          event: {
            _tag: 'VerificationStatusChangedEvent',
            revision: 2,
            attemptId: ATTEMPT_B,
            repositoryId: REPO,
            status: 'failed',
            generation: GEN_2,
            nextAction: 'Inspect failed Android check',
            updatedAtMs: 1_700_000_020_000,
          },
        }),
      ),
      Scene.expect(Scene.testId(`attempt-status-${ATTEMPT_B}`)).toHaveText(
        'failed',
      ),
      // Navigating back unmounts the React diff island cleanly
      Scene.click(Scene.testId('back-to-inbox')),
      Scene.Command.resolve(
        PushUrlCommand({ url: '/' }),
        InboxMessage.CompletedNavigation(),
      ),
      Scene.Mount.expectEnded(MountDiffViewerIsland),
      Scene.expect(Scene.testId('detail-empty')).toExist(),
    )
  })
})
