import { httpRouter } from 'convex/server'
import { authKit } from './auth'
import {
  githubInstallationCallbackHandler,
  githubWebhookHandler,
} from './githubHttp'

const http = httpRouter()

authKit.registerRoutes(http)
http.route({
  path: '/github/install/callback',
  method: 'GET',
  handler: githubInstallationCallbackHandler,
})
http.route({
  path: '/github/webhooks',
  method: 'POST',
  handler: githubWebhookHandler,
})

export default http
