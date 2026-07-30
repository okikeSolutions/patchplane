import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  ArchitectureFileSystemLayer,
  fileText,
  relativeToRepo,
  sourceFilesUnder,
} from './architecture-files'

const explicitFrameworkBoundaries: ReadonlyMap<string, string> = new Map([
  [
    'apps/source-control/src/worker.ts',
    'CF-WORKER-001: Cloudflare requires a Response or Promise response',
  ],
  [
    'packages/backend/convex/auth.ts',
    'CONVEX-HANDLER-001: Convex serializes a directly returned Effect',
  ],
  [
    'packages/backend/convex/connectedRepositories.ts',
    'CONVEX-HANDLER-001: Convex serializes a directly returned Effect',
  ],
  [
    'packages/backend/convex/promptRequests.ts',
    'CONVEX-HANDLER-001: Convex serializes a directly returned Effect',
  ],
  [
    'packages/backend/convex/requests.ts',
    'CONVEX-HANDLER-001: Convex serializes a directly returned Effect',
  ],
  [
    'packages/backend/convex/viewer.ts',
    'CONVEX-HANDLER-001: Convex serializes a directly returned Effect',
  ],
  [
    'packages/backend/convex/workflowRuns.ts',
    'CONVEX-HANDLER-001: Convex serializes a directly returned Effect',
  ],
  [
    'packages/backend/convex/workflowStarts.ts',
    'CONVEX-HANDLER-001: Convex serializes a directly returned Effect',
  ],
  [
    'packages/plugins/src/sentry/cloudflare-worker.ts',
    'SENTRY-CF-001: Sentry owns the Promise-returning Worker wrapper',
  ],
] as const)

function productionModule(file: string) {
  return (
    !file.endsWith('.test.ts') &&
    !file.endsWith('.test.tsx') &&
    !file.endsWith('.d.ts') &&
    !file.includes('/_generated/') &&
    !file.includes('/scripts/') &&
    !file.endsWith('/live-rpc-smoke.ts')
  )
}

function importsEffect(source: string) {
  return /from\s+['"]effect(?:\/[^'"]*)?['"]/.test(source)
}

function asynchronousOrchestration(source: string) {
  return /\basync\s+|\bawait\s+|\bnew\s+Promise\b|\bPromise\s*(?:<|\.|\()|\.(?:then|catch|finally)\s*\(/.test(
    source,
  )
}

describe('Effect-native boundaries', () => {
  it.effect(
    'classifies every asynchronous production module and keeps eligible compliance above 85%',
    () =>
      Effect.gen(function* () {
        const files = [
          ...(yield* sourceFilesUnder('packages')),
          ...(yield* sourceFilesUnder('apps/source-control')),
          ...(yield* sourceFilesUnder('apps/infra')),
        ]
        const modules = [] as Array<{
          readonly file: string
          readonly source: string
        }>
        for (const absolute of files) {
          const file = yield* relativeToRepo(absolute)
          if (!productionModule(file)) continue
          modules.push({ file, source: yield* fileText(file) })
        }
        modules.push({
          file: 'alchemy.run.ts',
          source: yield* fileText('alchemy.run.ts'),
        })

        const unclassified = modules.filter(
          ({ file, source }) =>
            asynchronousOrchestration(source) &&
            !importsEffect(source) &&
            !explicitFrameworkBoundaries.has(file),
        )
        expect(unclassified.map(({ file }) => file)).toEqual([])

        const eligible = modules.filter(
          ({ file }) => !explicitFrameworkBoundaries.has(file),
        )
        const compliant = eligible.filter(
          ({ source }) =>
            importsEffect(source) || !asynchronousOrchestration(source),
        )
        const percentage = (compliant.length / eligible.length) * 100
        expect(
          percentage,
          `Effect-native eligible compliance was ${percentage.toFixed(1)}% (${compliant.length}/${eligible.length})`,
        ).toBeGreaterThanOrEqual(85)
      }).pipe(Effect.provide(ArchitectureFileSystemLayer)),
  )

  it.effect('keeps every explicit framework exception documented', () =>
    Effect.gen(function* () {
      const document = yield* fileText('docs/effect-boundaries.md')
      for (const [file, reason] of explicitFrameworkBoundaries) {
        expect(document).toContain(file)
        expect(document).toContain(reason.split(':', 1)[0]!)
      }
    }).pipe(Effect.provide(ArchitectureFileSystemLayer)),
  )

  it.effect(
    'keeps Cloudflare entry callbacks as minimal runPromise bridges',
    () =>
      Effect.gen(function* () {
        const sourceControlWorker = yield* fileText(
          'apps/source-control/src/worker.ts',
        )
        expect(sourceControlWorker).not.toContain('Effect.runPromise(')
        expect(sourceControlWorker).not.toContain('async fetch(')
        expect(sourceControlWorker).toContain('.finally(() =>')

        const webhookEntry = yield* fileText(
          'apps/source-control/src/webhook-worker.ts',
        )
        expect(webhookEntry).toContain('Effect.runPromise(')
        expect(webhookEntry).not.toContain('async fetch(')
        expect(webhookEntry).not.toContain('async queue(')
        expect(webhookEntry).not.toContain('async scheduled(')
        const webhookWorker = yield* fileText(
          'apps/source-control/src/webhook-worker.ts',
        )
        expect(webhookWorker).not.toContain('new Promise')
        expect(webhookWorker).not.toContain('Promise.race')
        expect(webhookWorker).not.toContain('setTimeout(')
      }).pipe(Effect.provide(ArchitectureFileSystemLayer)),
  )

  it.effect(
    'keeps domain, core, and CLI production orchestration Promise-free',
    () =>
      Effect.gen(function* () {
        const violations: string[] = []
        for (const directory of [
          'packages/domain/src',
          'packages/core/src',
          'packages/cli/src',
        ]) {
          for (const absolute of yield* sourceFilesUnder(directory)) {
            const file = yield* relativeToRepo(absolute)
            if (!productionModule(file)) continue
            const source = yield* fileText(file)
            if (asynchronousOrchestration(source)) violations.push(file)
          }
        }
        expect(violations).toEqual([])
      }).pipe(Effect.provide(ArchitectureFileSystemLayer)),
  )

  it.effect('keeps Alchemy provisioning natively Effect-based', () =>
    Effect.gen(function* () {
      const source = yield* fileText('alchemy.run.ts')
      expect(source).toContain("import * as Effect from 'effect/Effect'")
      expect(source).toContain('Effect.gen(function* ()')
      expect(source).not.toContain('async function')
    }).pipe(Effect.provide(ArchitectureFileSystemLayer)),
  )

  it.effect('documents why a runtime bridge is required', () =>
    Effect.gen(function* () {
      const direct = Effect.succeed('direct')
      expect(direct instanceof Promise).toBe(false)
      expect(JSON.parse(JSON.stringify(direct))).not.toBe('direct')
      expect(yield* direct).toBe('direct')
    }),
  )
})
