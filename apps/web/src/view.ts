import { Option } from 'effect'
import type * as Html from 'foldkit/html'
import type { AttemptDetail, AttemptSummary } from '@patchplane/contracts'
import { MountDiffViewerIsland } from './diff-island-mount'
import {
  AttemptDetailState,
  DecisionSubmissionState,
  InboxLoadState,
  InboxMessage,
  type InboxModel,
  SseConnectionState,
} from './model'
import { AppRoute } from './routes'

const renderSseStatusBadge = (
  connection: SseConnectionState,
  h: Html.HtmlBuilder<InboxMessage>,
): Html.Html =>
  SseConnectionState.match(connection, {
    Disconnected: () =>
      h.span(
        [h.DataAttribute('testid', 'sse-status')],
        ['Live updates paused'],
      ),
    Connecting: () =>
      h.span(
        [h.DataAttribute('testid', 'sse-status')],
        ['Connecting to live updates'],
      ),
    Connected: () =>
      h.span(
        [h.DataAttribute('testid', 'sse-status')],
        ['Live updates active'],
      ),
    Failed: ({ error }) =>
      h.span(
        [h.DataAttribute('testid', 'sse-status'), h.Role('alert')],
        [`Live stream error (${error.code}): ${error.message}`],
      ),
  })

const renderInboxItem = (
  item: AttemptSummary,
  isSelected: boolean,
  h: Html.HtmlBuilder<InboxMessage>,
): Html.Html =>
  h.li(
    [
      h.Key(item.attemptId),
      h.DataAttribute('testid', `inbox-item-${item.attemptId}`),
    ],
    [
      h.button(
        [
          h.Type('button'),
          h.AriaCurrent(isSelected ? 'page' : 'false'),
          h.DataAttribute('testid', `select-attempt-${item.attemptId}`),
          h.OnClick(InboxMessage.ClickedAttempt({ attemptId: item.attemptId })),
        ],
        [
          h.strong([], [item.title]),
          h.span(
            [h.DataAttribute('testid', `attempt-status-${item.attemptId}`)],
            [item.status],
          ),
          h.span([], [`${item.repositoryId} · gen ${item.generation}`]),
          h.span(
            [
              h.DataAttribute(
                'testid',
                `attempt-next-action-${item.attemptId}`,
              ),
            ],
            [item.nextAction],
          ),
        ],
      ),
    ],
  )

const renderDecisionBanner = (
  submission: DecisionSubmissionState,
  h: Html.HtmlBuilder<InboxMessage>,
): Html.Html =>
  DecisionSubmissionState.match(submission, {
    Idle: () => h.empty,
    Submitting: ({ kind }) =>
      h.p(
        [h.DataAttribute('testid', 'decision-status')],
        [`Submitting ${kind} decision...`],
      ),
    Submitted: ({ decision }) =>
      h.p(
        [h.DataAttribute('testid', 'decision-status')],
        [`Decision recorded: ${decision.kind} (v${decision.proposalVersion})`],
      ),
    Failed: ({ error }) =>
      h.p(
        [h.DataAttribute('testid', 'decision-error'), h.Role('alert')],
        [`Decision failed (${error.code}): ${error.message}`],
      ),
  })

const renderAttemptDetailLoaded = (
  model: InboxModel,
  detail: AttemptDetail,
  h: Html.HtmlBuilder<InboxMessage>,
): Html.Html => {
  const isSubmitting = DecisionSubmissionState.guards.Submitting(
    model.decisionSubmission,
  )
  const focusedPath = Option.getOrNull(model.focusedFilePath)
  const selectedLineText = Option.match(model.selectedDiffLine, {
    onNone: () => 'No diff line selected',
    onSome: ({ path, lineNumber }) => `Selected ${path}:${lineNumber}`,
  })

  return h.section(
    [h.DataAttribute('testid', 'attempt-detail-panel')],
    [
      h.header(
        [],
        [
          h.button(
            [
              h.Type('button'),
              h.DataAttribute('testid', 'back-to-inbox'),
              h.OnClick(InboxMessage.ClickedBackToInbox()),
            ],
            ['Back to Inbox'],
          ),
          h.h2([], [detail.summary.title]),
          h.p(
            [h.DataAttribute('testid', 'detail-status')],
            [
              `Status: ${detail.summary.status} · Proposal v${detail.summary.proposalVersion} · ${detail.summary.nextAction}`,
            ],
          ),
        ],
      ),
      h.div(
        [h.DataAttribute('testid', 'decision-actions')],
        [
          h.button(
            [
              h.Type('button'),
              h.Disabled(isSubmitting),
              h.DataAttribute('testid', 'decision-approve'),
              h.OnClick(
                InboxMessage.ClickedSubmitDecision({
                  attemptId: detail.summary.attemptId,
                  proposalVersion: detail.summary.proposalVersion,
                  kind: 'approve',
                }),
              ),
            ],
            ['Approve'],
          ),
          h.button(
            [
              h.Type('button'),
              h.Disabled(isSubmitting),
              h.DataAttribute('testid', 'decision-reject'),
              h.OnClick(
                InboxMessage.ClickedSubmitDecision({
                  attemptId: detail.summary.attemptId,
                  proposalVersion: detail.summary.proposalVersion,
                  kind: 'reject',
                }),
              ),
            ],
            ['Reject'],
          ),
          h.button(
            [
              h.Type('button'),
              h.Disabled(isSubmitting),
              h.DataAttribute('testid', 'decision-waive'),
              h.OnClick(
                InboxMessage.ClickedSubmitDecision({
                  attemptId: detail.summary.attemptId,
                  proposalVersion: detail.summary.proposalVersion,
                  kind: 'waive',
                }),
              ),
            ],
            ['Waive'],
          ),
        ],
      ),
      renderDecisionBanner(model.decisionSubmission, h),
      detail.decision !== null
        ? h.p(
            [h.DataAttribute('testid', 'recorded-decision')],
            [
              `Recorded: ${detail.decision.kind} by ${detail.decision.actorId} (v${detail.decision.proposalVersion})`,
            ],
          )
        : h.empty,
      h.div(
        [h.DataAttribute('testid', 'diff-selection-status')],
        [
          h.span(
            [h.DataAttribute('testid', 'focused-file')],
            [
              focusedPath !== null
                ? `Focused file: ${focusedPath}`
                : 'No file focused',
            ],
          ),
          h.span(
            [h.DataAttribute('testid', 'selected-line')],
            [selectedLineText],
          ),
        ],
      ),
      h.div(
        [
          h.Key(
            `diff-island:${detail.summary.attemptId}:${detail.summary.proposalVersion}`,
          ),
          h.DataAttribute('testid', 'diff-island-host'),
          h.OnMount(
            MountDiffViewerIsland({
              initialData: {
                attemptId: detail.summary.attemptId,
                proposalVersion: detail.summary.proposalVersion,
                diffText: detail.diffText,
                focusedFilePath: focusedPath,
              },
            }),
          ),
          h.OnUnmount(
            InboxMessage.DiffIslandUnmounted({
              attemptId: detail.summary.attemptId,
            }),
          ),
        ],
        [],
      ),
    ],
  )
}

const renderDetailPane = (
  model: InboxModel,
  h: Html.HtmlBuilder<InboxMessage>,
): Html.Html =>
  AttemptDetailState.match(model.activeDetail, {
    Idle: () =>
      h.section(
        [h.DataAttribute('testid', 'detail-empty')],
        ['Select a verification attempt to inspect its Patch Report and diff.'],
      ),
    Loading: ({ attemptId }) =>
      h.section(
        [h.DataAttribute('testid', 'detail-loading')],
        [`Loading attempt ${attemptId}...`],
      ),
    Failed: ({ error }) =>
      h.section(
        [h.DataAttribute('testid', 'detail-error'), h.Role('alert')],
        [`Failed to load attempt (${error.code}): ${error.message}`],
      ),
    Loaded: ({ detail }) => renderAttemptDetailLoaded(model, detail, h),
  })

export const renderInboxBody = (
  model: InboxModel,
  h: Html.HtmlBuilder<InboxMessage>,
): Html.Html => {
  const selectedId = Option.getOrUndefined(model.selectedAttemptId)

  return h.main(
    [h.DataAttribute('testid', 'decision-inbox-app')],
    [
      h.header(
        [],
        [
          h.h1([], ['Patchplane Decision Inbox']),
          renderSseStatusBadge(model.sseConnection, h),
          h.button(
            [
              h.Type('button'),
              h.DataAttribute('testid', 'refresh-inbox'),
              h.OnClick(InboxMessage.ClickedRefreshInbox()),
            ],
            ['Refresh'],
          ),
          h.button(
            [
              h.Type('button'),
              h.DataAttribute('testid', 'toggle-live-updates'),
              h.OnClick(
                InboxMessage.ToggledLiveUpdates({
                  enabled: !model.streamEnabled,
                }),
              ),
            ],
            [
              model.streamEnabled
                ? 'Pause Live Updates'
                : 'Resume Live Updates',
            ],
          ),
        ],
      ),
      InboxLoadState.match(model.listState, {
        Idle: () => h.empty,
        Loading: () =>
          h.p(
            [h.DataAttribute('testid', 'inbox-loading')],
            ['Loading inbox...'],
          ),
        Loaded: () => h.empty,
        Failed: ({ error }) =>
          h.p(
            [h.DataAttribute('testid', 'inbox-error'), h.Role('alert')],
            [`Failed to load inbox (${error.code}): ${error.message}`],
          ),
      }),
      AppRoute.match(model.route, {
        NotFound: ({ path }) =>
          h.section(
            [h.DataAttribute('testid', 'route-not-found')],
            [
              h.p([], [`Route not found: ${path}`]),
              h.button(
                [
                  h.Type('button'),
                  h.OnClick(InboxMessage.ClickedBackToInbox()),
                ],
                ['Return to Decision Inbox'],
              ),
            ],
          ),
        Inbox: () =>
          h.div(
            [],
            [
              h.ul(
                [h.DataAttribute('testid', 'inbox-list')],
                model.items.map((item) =>
                  renderInboxItem(item, item.attemptId === selectedId, h),
                ),
              ),
              renderDetailPane(model, h),
            ],
          ),
        AttemptDetail: () =>
          h.div(
            [],
            [
              h.ul(
                [h.DataAttribute('testid', 'inbox-list')],
                model.items.map((item) =>
                  renderInboxItem(item, item.attemptId === selectedId, h),
                ),
              ),
              renderDetailPane(model, h),
            ],
          ),
      }),
    ],
  )
}

export const viewInboxDocument = (
  model: InboxModel,
  h: Html.HtmlBuilder<InboxMessage>,
): Html.Document => {
  const title = AppRoute.match(model.route, {
    Inbox: () => 'Patchplane — Decision Inbox',
    AttemptDetail: ({ attemptId }) => `Patchplane — Attempt ${attemptId}`,
    NotFound: () => 'Patchplane — Not Found',
  })

  return {
    title,
    body: renderInboxBody(model, h),
  }
}
