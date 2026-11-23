import { getAttemptSummary } from '@patchplane/core'
import { makeInMemoryAttemptStoreLayer } from '@patchplane/plugins'

export const ServerAttemptStoreLayer = makeInMemoryAttemptStoreLayer
export const resolveAttemptSummary = getAttemptSummary
