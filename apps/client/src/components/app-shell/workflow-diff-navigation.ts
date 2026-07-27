export type WorkflowDiffView = 'split' | 'unified'

export type WorkflowDiffNavigation = {
  readonly expanded: boolean
  readonly selectedFileIndex: number | undefined
  readonly view: WorkflowDiffView
}

const maximumCandidateFileIndex = 9_999

export function workflowDiffFileIndex(value: unknown) {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.length > 0
        ? Number(value)
        : Number.NaN
  return Number.isInteger(parsed) &&
    parsed >= 0 &&
    parsed <= maximumCandidateFileIndex
    ? parsed
    : undefined
}

export function workflowDiffView(value: unknown): WorkflowDiffView {
  return value === 'split' ? 'split' : 'unified'
}

export function workflowDiffExpanded(value: unknown) {
  return value === 'diff' || value === true
}
