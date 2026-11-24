import type { Layer } from 'effect'
import * as Runtime from 'foldkit/runtime'
import type { DecisionInboxClient } from './client'
import {
  InboxMessage,
  InboxModel,
  inboxSubscriptions,
  initInbox,
  updateInbox,
} from './model'
import { renderInboxBody, viewInboxDocument } from './view'

export interface CreateDecisionInboxOptions {
  readonly container: HTMLElement | null
  readonly clientLayer: Layer.Layer<DecisionInboxClient>
  readonly streamEnabled?: boolean
}

/**
 * Creates the standalone Foldkit Web Decision Inbox application with full URL
 * routing, Effect Commands, live SSE Subscriptions, and isolated React diff
 * island mounting.
 */
export const createDecisionInboxApp = (options: CreateDecisionInboxOptions) =>
  Runtime.makeApplication({
    Model: InboxModel,
    init: (url) =>
      initInbox(url, {
        routingEnabled: true,
        ...(options.streamEnabled !== undefined
          ? { streamEnabled: options.streamEnabled }
          : {}),
      }),
    update: updateInbox,
    view: viewInboxDocument,
    subscriptions: inboxSubscriptions,
    resources: options.clientLayer,
    container: options.container,
    routing: {
      onUrlRequest: (request) => InboxMessage.UrlRequested({ request }),
      onUrlChange: (url) => InboxMessage.UrlChanged({ url }),
    },
  })

/**
 * Creates a container-scoped Foldkit element runtime suitable for deterministic
 * lifecycle testing (`Runtime.embed` + `disposeAsync`) without mutating
 * `window.history` or document `<head>`.
 */
export const createDecisionInboxElement = (
  options: CreateDecisionInboxOptions,
) =>
  Runtime.makeElement({
    Model: InboxModel,
    init: () =>
      initInbox(undefined, {
        routingEnabled: false,
        ...(options.streamEnabled !== undefined
          ? { streamEnabled: options.streamEnabled }
          : {}),
      }),
    update: updateInbox,
    view: renderInboxBody,
    subscriptions: inboxSubscriptions,
    resources: options.clientLayer,
    container: options.container,
  })
