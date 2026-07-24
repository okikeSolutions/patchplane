#!/usr/bin/env bun
/// <reference types="node" />

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface RoadmapMilestone {
  readonly milestone: string
  readonly status: string
  readonly line: number
  readonly claimsCompletion: boolean
}

export interface AcceptanceRow {
  readonly milestone: string
  readonly criterion: string
  readonly status: string
  readonly line: number
}

export interface RoadmapAcceptanceInconsistency {
  readonly milestone: string
  readonly roadmapStatus: string
  readonly roadmapLine: number
  readonly criterion: string
  readonly acceptanceLine: number
}

const milestoneHeadingPattern = /^###\s+(M\d+(?:\.\d+)?)\b/
const milestoneStatusPattern = /^\s*\*\*Status:\*\*\s*(.+?)\s*$/i
const completionStatusPattern = /^(?:Complete|Implemented)\b/i

function cleanTableCell(cell: string): string {
  return cell
    .trim()
    .replace(/^\*\*(.*)\*\*$/, '$1')
    .replace(/^`(.*)`$/, '$1')
}

/** Parse milestone headings and their first Status field from ROADMAP.md. */
export function parseRoadmapMilestones(markdown: string): RoadmapMilestone[] {
  const milestones: RoadmapMilestone[] = []
  let currentMilestone: string | undefined

  for (const [index, line] of markdown.split(/\r?\n/).entries()) {
    const heading = milestoneHeadingPattern.exec(line)
    if (heading) {
      currentMilestone = heading[1]
      continue
    }

    if (!currentMilestone) {
      continue
    }

    const status = milestoneStatusPattern.exec(line)
    if (!status) {
      continue
    }

    const statusText = status[1].trim()
    milestones.push({
      milestone: currentMilestone,
      status: statusText,
      line: index + 1,
      claimsCompletion: completionStatusPattern.test(statusText),
    })
    currentMilestone = undefined
  }

  return milestones
}

/** Parse milestone rows from the acceptance-test Markdown tables. */
export function parseAcceptanceRows(markdown: string): AcceptanceRow[] {
  const rows: AcceptanceRow[] = []

  for (const [index, line] of markdown.split(/\r?\n/).entries()) {
    if (!line.trimStart().startsWith('|')) {
      continue
    }

    const cells = line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map(cleanTableCell)

    if (!/^M\d+(?:\.\d+)?$/.test(cells[0] ?? '') || cells.length < 4) {
      continue
    }

    rows.push({
      milestone: cells[0],
      criterion: cells[1],
      status: cells.at(-1) ?? '',
      line: index + 1,
    })
  }

  return rows
}

/** Find completed roadmap milestones that still have Missing acceptance evidence. */
export function findRoadmapAcceptanceInconsistencies(
  roadmapMarkdown: string,
  acceptanceMarkdown: string,
): RoadmapAcceptanceInconsistency[] {
  const completed = new Map(
    parseRoadmapMilestones(roadmapMarkdown)
      .filter(({ claimsCompletion }) => claimsCompletion)
      .map((milestone) => [milestone.milestone, milestone]),
  )

  return parseAcceptanceRows(acceptanceMarkdown).flatMap((row) => {
    const roadmap = completed.get(row.milestone)
    if (!roadmap || row.status.toLowerCase() !== 'missing') {
      return []
    }

    return [
      {
        milestone: row.milestone,
        roadmapStatus: roadmap.status,
        roadmapLine: roadmap.line,
        criterion: row.criterion,
        acceptanceLine: row.line,
      },
    ]
  })
}

function run(argv: readonly string[]): number {
  const roadmapPath = resolve(argv[0] ?? 'ROADMAP.md')
  const acceptancePath = resolve(argv[1] ?? 'docs/acceptance-tests.md')
  const inconsistencies = findRoadmapAcceptanceInconsistencies(
    readFileSync(roadmapPath, 'utf8'),
    readFileSync(acceptancePath, 'utf8'),
  )

  if (inconsistencies.length === 0) {
    console.log(
      'Roadmap completion claims are consistent with acceptance evidence.',
    )
    return 0
  }

  console.error(
    `Found ${inconsistencies.length} roadmap/acceptance ${inconsistencies.length === 1 ? 'inconsistency' : 'inconsistencies'}:`,
  )
  for (const inconsistency of inconsistencies) {
    console.error(
      `- ${inconsistency.milestone}: ROADMAP.md:${inconsistency.roadmapLine} claims "${inconsistency.roadmapStatus}", but docs/acceptance-tests.md:${inconsistency.acceptanceLine} is Missing: ${inconsistency.criterion}`,
    )
  }
  return 1
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    process.exitCode = run(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
