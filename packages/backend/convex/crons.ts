import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()

crons.interval(
  'clean expired GitHub connection intents',
  { minutes: 15 },
  internal.connectedRepositories.cleanupExpiredGitHubConnectionIntents,
  {},
)

export default crons
