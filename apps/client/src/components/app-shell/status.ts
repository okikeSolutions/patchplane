import { type WorkflowStatus } from '@patchplane/domain/workflow-run'
import * as m from '@/paraglide/messages'

export const timelineStatuses = [
  'queued',
  'running',
  'reviewed',
] as const satisfies ReadonlyArray<WorkflowStatus>
export type TimelineStatus = (typeof timelineStatuses)[number]

const statusLabels = {
  queued: m.app_status_queued_label,
  running: m.app_status_running_label,
  reviewed: m.app_status_reviewed_label,
} satisfies Record<TimelineStatus, () => string>

const statusDetails = {
  queued: m.app_status_queued_detail,
  running: m.app_status_running_detail,
  reviewed: m.app_status_reviewed_detail,
} satisfies Record<TimelineStatus, () => string>

export function getStatusLabel(status: TimelineStatus) {
  return statusLabels[status]()
}

export function getStatusDetail(status: TimelineStatus) {
  return statusDetails[status]()
}
