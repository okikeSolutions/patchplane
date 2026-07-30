import type { Breadcrumb } from '@sentry/core'
import { FILTERED, decodeSentryLevel, makeSafeBreadcrumb } from './policy'
import {
  safeFiniteNumber,
  safeTelemetryName,
  sanitizeSentryAttributes,
  sanitizeTelemetryUrl,
} from './attributes'
import { Option, String as EffectString } from 'effect'

function sanitizeBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  const requestedCategory = safeTelemetryName(breadcrumb.category)
  const criticalPathBreadcrumb =
    requestedCategory === 'patchplane.critical-path'
  const patchplaneBreadcrumb =
    requestedCategory !== undefined &&
    EffectString.startsWith('patchplane.')(requestedCategory)
  const category = criticalPathBreadcrumb
    ? 'patchplane.critical-path'
    : patchplaneBreadcrumb
      ? 'patchplane.event'
      : 'sentry.automatic'
  const level = Option.getOrUndefined(decodeSentryLevel(breadcrumb.level))
  const timestamp = safeFiniteNumber(breadcrumb.timestamp)
  const attributes = sanitizeSentryAttributes(breadcrumb.data)
  const stage = attributes.criticalPathStage ?? attributes.stage
  const status = attributes.status
  const message =
    criticalPathBreadcrumb &&
    typeof stage === 'string' &&
    typeof status === 'string'
      ? `${stage}.${status}`
      : typeof breadcrumb.message === 'string'
        ? patchplaneBreadcrumb
          ? 'patchplane.event'
          : EffectString.includes('://')(breadcrumb.message) ||
              EffectString.startsWith('/')(breadcrumb.message)
            ? sanitizeTelemetryUrl(breadcrumb.message)
            : FILTERED
        : undefined

  return {
    ...(category === undefined ? {} : { category }),
    ...(level === undefined ? {} : { level }),
    ...(timestamp === undefined ? {} : { timestamp }),
    ...(message === undefined ? {} : { message }),
    data: attributes,
  }
}

const trySanitizeBreadcrumb = Option.liftThrowable(sanitizeBreadcrumb)

export function sanitizeSentryBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  return Option.getOrElse(trySanitizeBreadcrumb(breadcrumb), makeSafeBreadcrumb)
}
