import { layer as BrowserCryptoLayer } from '@effect/platform-browser/BrowserCrypto'
import { ConvexStoragePlugin } from '@patchplane/plugins/convex/storage-plugin'
import { CloudflareTelemetryPlugin } from '@patchplane/plugins/sentry/cloudflare-telemetry-plugin'
import { WorkOSAuthPlugin } from '@patchplane/plugins/workos/auth-plugin'
import { Layer } from 'effect'

export const appLayer = Layer.mergeAll(
  ConvexStoragePlugin.layer,
  WorkOSAuthPlugin.layer,
  CloudflareTelemetryPlugin.layer,
  BrowserCryptoLayer,
)
