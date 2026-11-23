import type { BrowserHttpClient } from '@effect/platform-browser'
import type { AttemptSummary } from '@patchplane/contracts'
import { Match } from 'effect'
import type * as FoldkitCommand from 'foldkit/command'

export type WebHttpClientLayer = typeof BrowserHttpClient.layerXMLHttpRequest

export interface InboxModel {
  readonly items: ReadonlyArray<AttemptSummary>
  readonly selectedAttemptId: string | undefined
}

export type InboxMessage =
  | {
      readonly _tag: 'InboxLoaded'
      readonly items: ReadonlyArray<AttemptSummary>
    }
  | { readonly _tag: 'AttemptSelected'; readonly attemptId: string }

export type InboxCommand = FoldkitCommand.Command<InboxMessage>

export interface DiffIslandViewData {
  readonly attemptId: string
  readonly diffText: string
}

export type DiffIslandEvent = {
  readonly _tag: 'FileFocused'
  readonly path: string
}

export const initialInboxModel: InboxModel = {
  items: [],
  selectedAttemptId: undefined,
}

export const updateInboxModel = (
  model: InboxModel,
  message: InboxMessage,
): InboxModel =>
  Match.value(message).pipe(
    Match.tag('InboxLoaded', ({ items }) => ({
      ...model,
      items,
    })),
    Match.tag('AttemptSelected', ({ attemptId }) => ({
      ...model,
      selectedAttemptId: attemptId,
    })),
    Match.exhaustive,
  )
