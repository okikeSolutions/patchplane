import { describe, expect, test } from 'vitest'
import {
  workflowDiffExpanded,
  workflowDiffFileIndex,
  workflowDiffView,
} from './workflow-diff-navigation'

describe('workflow diff navigation search state', () => {
  test.each([
    [0, 0],
    ['4', 4],
    [9_999, 9_999],
    [-1, undefined],
    ['1.5', undefined],
    [10_000, undefined],
    ['src/private.ts', undefined],
    [undefined, undefined],
  ])(
    'bounds candidate file indexes without accepting paths',
    (value, result) => {
      expect(workflowDiffFileIndex(value)).toBe(result)
    },
  )

  test('defaults unknown view modes to the alpha unified view', () => {
    expect(workflowDiffView('split')).toBe('split')
    expect(workflowDiffView('unified')).toBe('unified')
    expect(workflowDiffView('side-by-side')).toBe('unified')
  })

  test('accepts only the bounded diff focus state', () => {
    expect(workflowDiffExpanded('diff')).toBe(true)
    expect(workflowDiffExpanded(true)).toBe(true)
    expect(workflowDiffExpanded('report')).toBe(false)
  })
})
