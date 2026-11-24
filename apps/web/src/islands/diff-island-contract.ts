import type { DiffIslandEvent, DiffIslandViewData } from '@patchplane/contracts'

export type { DiffIslandEvent, DiffIslandViewData }

export interface DiffViewerIslandHandle {
  readonly update: (nextData: DiffIslandViewData) => void
  readonly unmount: () => void
}
