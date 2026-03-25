import { anyApi, cronJobs } from 'convex/server'

const crons = cronJobs()

crons.interval(
  'reconcile github webhook deliveries',
  { minutes: 15 },
  anyApi.githubWorker.reconcileWebhookDeliveries,
  {},
)

export default crons
