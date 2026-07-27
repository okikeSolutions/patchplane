import { Schema } from 'effect'

export const AppVersionId = Schema.NonEmptyString.pipe(
  Schema.brand('AppVersionId'),
)
export type AppVersionId = typeof AppVersionId.Type

export const ActiveAppVersion = Schema.Struct({
  versionId: AppVersionId,
})
export type ActiveAppVersion = typeof ActiveAppVersion.Type

const decodeAppVersionId = Schema.decodeUnknownSync(AppVersionId)
const decodeActiveAppVersion = Schema.decodeUnknownSync(ActiveAppVersion)

export const localAppVersionId = decodeAppVersionId('local-development')

export function appVersionIdFrom(value: unknown): AppVersionId {
  return decodeAppVersionId(value)
}

export function activeAppVersionFrom(value: unknown): ActiveAppVersion {
  return decodeActiveAppVersion(value)
}

export function isNewAppVersion(
  bootVersionId: AppVersionId,
  activeVersionId: AppVersionId,
) {
  return bootVersionId !== activeVersionId
}

export function createAppVersionResponse(
  versionId: AppVersionId,
  method = 'GET',
) {
  return new Response(
    method === 'HEAD' ? null : JSON.stringify({ versionId }),
    {
      headers: {
        'cache-control': 'no-store',
        'content-type': 'application/json; charset=utf-8',
        'x-content-type-options': 'nosniff',
      },
    },
  )
}
