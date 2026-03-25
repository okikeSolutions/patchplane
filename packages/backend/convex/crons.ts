import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()

crons.interval(
  'reconcile github webhook deliveries',
  { minutes: 15 },
  internal.githubWorker.reconcileWebhookDeliveries,
  {},
)

export default crons
