import { layer as BrowserCryptoLayer } from '@effect/platform-browser/BrowserCrypto'
import { ConvexStoragePlugin } from '@patchplane/plugins/convex/storage-plugin'
import { SentryTelemetryPlugin } from '@patchplane/plugins/sentry/telemetry-plugin'
import { WorkOSAuthPlugin } from '@patchplane/plugins/workos/auth-plugin'
import { Layer } from 'effect'

export function makeAppLayer() {
  return Layer.mergeAll(
    ConvexStoragePlugin.layer,
    WorkOSAuthPlugin.layer,
    SentryTelemetryPlugin.layer,
    BrowserCryptoLayer,
  )
}
