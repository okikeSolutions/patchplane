import {
  appVersionIdFrom,
  localAppVersionId,
  type AppVersionId,
} from '@/lib/app-version'

interface WorkerVersionMetadata {
  readonly id: string
  readonly tag: string
  readonly timestamp: string
}

export interface ClientWorkerEnv {
  SOURCE_CONTROL_WORKER: Fetcher
  PATCHPLANE_EVIDENCE_BUCKET: R2Bucket
  CF_VERSION_METADATA?: WorkerVersionMetadata
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

async function loadCloudflareEnv(): Promise<ClientWorkerEnv> {
  const cf = await import(/* @vite-ignore */ 'cloudflare:workers') as CloudflareWorkersModule
  return cf.env
}

export async function getEvidenceBucket(): Promise<R2Bucket> {
  try {
    const bucket = (await loadCloudflareEnv()).PATCHPLANE_EVIDENCE_BUCKET
    if (bucket === undefined) throw new Error('binding is undefined')
    return bucket
  } catch (cause) {
    throw new Error(
      'PATCHPLANE_EVIDENCE_BUCKET binding is unavailable. Run through Alchemy Cloudflare.Vite.',
      { cause },
    )
  }
}

export async function getSourceControlWorker(): Promise<Fetcher> {
  try {
    return (await loadCloudflareEnv()).SOURCE_CONTROL_WORKER
  } catch (cause) {
    const fallback = sourceControlWorkerUrlFallback()
    if (fallback !== undefined) return fallback

    throw new Error(
      'SOURCE_CONTROL_WORKER binding is unavailable. Run through Alchemy Cloudflare.Vite or set PATCHPLANE_SOURCE_CONTROL_WORKER_URL for local Vite development.',
      { cause },
    )
  }
}

export async function getClientVersionId(): Promise<AppVersionId> {
  try {
    const versionId = (await loadCloudflareEnv()).CF_VERSION_METADATA?.id
    if (versionId !== undefined) return appVersionIdFrom(versionId)
  } catch {
    // Local Vite and route discovery do not expose Cloudflare bindings.
  }

  const configuredVersionId = process.env.PATCHPLANE_BUILD_ID?.trim()
  return configuredVersionId
    ? appVersionIdFrom(configuredVersionId)
    : localAppVersionId
}
