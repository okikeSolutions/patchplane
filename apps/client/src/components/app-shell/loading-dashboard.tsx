import { ActivityIcon } from 'lucide-react'
import { MetricCard } from './metric-card'
import {
  getStatusDetail,
  getStatusLabel,
  timelineStatuses,
} from './status'

export function LoadingDashboard() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {timelineStatuses.map((status) => (
        <MetricCard
          key={status}
          title={getStatusLabel(status)}
          value="—"
          detail={getStatusDetail(status)}
          icon={ActivityIcon}
        />
      ))}
    </div>
  )
}
