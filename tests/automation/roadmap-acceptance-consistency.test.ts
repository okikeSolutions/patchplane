import { describe, expect, it } from 'vitest'
import {
  findRoadmapAcceptanceInconsistencies,
  parseAcceptanceRows,
  parseRoadmapMilestones,
} from '../../scripts/check-roadmap-acceptance'

const roadmap = `
### M7 — Provider

**Status:** Complete for alpha intake

### M8.5 — Visibility

**Status:** Implemented for the current read model

### M9 — Runtime

**Status:** In progress / mostly complete

### M10 — Publication

**Status:** Planned
`

const acceptance = `
| Milestone | Acceptance criterion | Evidence | Status |
| --------- | -------------------- | -------- | ------ |
| M7 | Publishes a result | adapter tests | Automated |
| M8.5 | Explains trust state | browser E2E | Missing |
| M9 | Runtime starts | smoke | Missing |
| M10 | Publishes a draft PR | smoke | Missing |
`

describe('roadmap/acceptance consistency', () => {
  it('parses completion claims only when Status begins Complete or Implemented', () => {
    expect(parseRoadmapMilestones(roadmap)).toEqual([
      {
        milestone: 'M7',
        status: 'Complete for alpha intake',
        line: 4,
        claimsCompletion: true,
      },
      {
        milestone: 'M8.5',
        status: 'Implemented for the current read model',
        line: 8,
        claimsCompletion: true,
      },
      {
        milestone: 'M9',
        status: 'In progress / mostly complete',
        line: 12,
        claimsCompletion: false,
      },
      {
        milestone: 'M10',
        status: 'Planned',
        line: 16,
        claimsCompletion: false,
      },
    ])
  })

  it('parses milestone acceptance rows and ignores table headers and separators', () => {
    expect(parseAcceptanceRows(acceptance)).toEqual([
      {
        milestone: 'M7',
        criterion: 'Publishes a result',
        status: 'Automated',
        line: 4,
      },
      {
        milestone: 'M8.5',
        criterion: 'Explains trust state',
        status: 'Missing',
        line: 5,
      },
      {
        milestone: 'M9',
        criterion: 'Runtime starts',
        status: 'Missing',
        line: 6,
      },
      {
        milestone: 'M10',
        criterion: 'Publishes a draft PR',
        status: 'Missing',
        line: 7,
      },
    ])
  })

  it('reports each Missing row only for milestones claiming completion', () => {
    expect(findRoadmapAcceptanceInconsistencies(roadmap, acceptance)).toEqual([
      {
        milestone: 'M8.5',
        roadmapStatus: 'Implemented for the current read model',
        roadmapLine: 8,
        criterion: 'Explains trust state',
        acceptanceLine: 5,
      },
    ])
  })

  it('allows complete milestones when every acceptance row has evidence', () => {
    const completeAcceptance = acceptance.replace(
      '| M8.5 | Explains trust state | browser E2E | Missing |',
      '| M8.5 | Explains trust state | component tests | Automated |',
    )

    expect(
      findRoadmapAcceptanceInconsistencies(roadmap, completeAcceptance),
    ).toEqual([])
  })
})
