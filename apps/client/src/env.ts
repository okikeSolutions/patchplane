export interface ClientWorkerEnv {
  SOURCE_CONTROL_WORKER: Fetcher
}

declare global {
  namespace Cloudflare {
    interface Env extends ClientWorkerEnv {}
  }
}

interface CloudflareWorkersModule {
  readonly env: ClientWorkerEnv
}

/**
 * Reads the Cloudflare service binding at call time.
 *
 * @remarks
 * `cloudflare:workers` is only available inside Alchemy/Cloudflare Vite's
 * workerd runtime. Keep the import lazy so normal TanStack/Vite route discovery
 * can run without trying to resolve the Cloudflare-only virtual module.
 */
function sourceControlWorkerUrlFallback(): Fetcher | undefined {
  const baseUrl = process.env.PATCHPLANE_SOURCE_CONTROL_WORKER_URL?.trim()
  if (!baseUrl) return undefined

  const normalizedBaseUrl = baseUrl.replace(/\/$/, '')
  return {
    fetch(input, init) {
      const request = input instanceof Request ? input : new Request(input, init)
      const url = new URL(request.url)
      const fallbackUrl = `${normalizedBaseUrl}${url.pathname}${url.search}`
      return fetch(new Request(fallbackUrl, request))
    },
    connect() {
      throw new Error('PATCHPLANE_SOURCE_CONTROL_WORKER_URL fallback does not support sockets')
    },
  }
}

export async function getSourceControlWorker(): Promise<Fetcher> {
  try {
    const cf = await import(/* @vite-ignore */ 'cloudflare:workers') as CloudflareWorkersModule
    return cf.env.SOURCE_CONTROL_WORKER
  } catch (cause) {
    const fallback = sourceControlWorkerUrlFallback()
    if (fallback !== undefined) return fallback

    throw new Error(
      'SOURCE_CONTROL_WORKER binding is unavailable. Run through Alchemy Cloudflare.Vite or set PATCHPLANE_SOURCE_CONTROL_WORKER_URL for local Vite development.',
      { cause },
    )
  }
}
