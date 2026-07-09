import { describe, expect, it } from '@effect/vitest'
import { Effect, Exit } from 'effect'
import { decodeEvidenceArtifact } from './evidence-artifact'

const artifact = {
  id: 'artifact-1',
  workflowRunId: 'workflow-1',
  traceId: 'trace-1',
  kind: 'stdout',
  label: 'Sandbox stdout',
  storageProvider: 'cloudflare-r2',
  storageKey: 'workflow-1/stdout.txt',
  contentType: 'text/plain; charset=utf-8',
  sizeBytes: 2,
  sha256: '2689367b205c16ce32e8ecd5e2fe58ae6d4acc7ba32d3d116dc92d4c2715f1b5',
  retentionPolicy: 'alpha-14-days',
  createdAt: 1,
}

describe('EvidenceArtifact', () => {
  it.effect('decodes R2-backed artifact metadata', () =>
    Effect.gen(function* () {
      const decoded = yield* decodeEvidenceArtifact(artifact)

      expect(decoded.kind).toBe('stdout')
      expect(decoded.storageProvider).toBe('cloudflare-r2')
      expect(decoded.storageKey).toBe('workflow-1/stdout.txt')
    }),
  )

  it.effect('rejects unknown artifact kinds', () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(decodeEvidenceArtifact({
        ...artifact,
        kind: 'unknown-artifact',
      }))

      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )
})
