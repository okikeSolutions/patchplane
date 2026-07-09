import { Config } from 'effect'

export const R2ArtifactsConfig = Config.all({
  accountId: Config.string('CLOUDFLARE_ACCOUNT_ID'),
  bucketName: Config.option(Config.string('PATCHPLANE_EVIDENCE_R2_BUCKET')),
  s3ApiEndpoint: Config.option(Config.string('CLOUDFLARE_S3_API_ENDPOINT')),
  accessKeyId: Config.option(
    Config.redacted('PATCHPLANE_EVIDENCE_R2_ACCESS_KEY_ID').pipe(
      Config.orElse(() => Config.redacted('CLOUDFLARE_ACCESS_KEY_ID')),
    ),
  ),
  secretAccessKey: Config.option(
    Config.redacted('PATCHPLANE_EVIDENCE_R2_SECRET_ACCESS_KEY').pipe(
      Config.orElse(() => Config.redacted('CLOUDFLARE_SECRET_ACCESS_KEY')),
    ),
  ),
  signedUrlExpiresInSeconds: Config.number('PATCHPLANE_EVIDENCE_R2_SIGNED_URL_EXPIRES_SECONDS').pipe(
    Config.withDefault(900),
  ),
  maxArtifactBytes: Config.number('PATCHPLANE_EVIDENCE_MAX_ARTIFACT_BYTES').pipe(
    Config.withDefault(10 * 1024 * 1024),
  ),
})

export type R2ArtifactsConfig = typeof R2ArtifactsConfig extends Config.Config<infer A> ? A : never
