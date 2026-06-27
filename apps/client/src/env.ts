import * as cf from 'cloudflare:workers'

export interface ClientWorkerEnv {
  SOURCE_CONTROL_WORKER: Fetcher
}

declare global {
  namespace Cloudflare {
    interface Env extends ClientWorkerEnv {}
  }
}

export const env: ClientWorkerEnv = {
  get SOURCE_CONTROL_WORKER() {
    return cf.env.SOURCE_CONTROL_WORKER
  },
}
