import { isBuiltin } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'

const serverSentryModule =
  /\/node_modules\/@sentry\/(cloudflare|node|server-utils|opentelemetry|effect)(\/|$)/
const browserSentryModule = /\/node_modules\/@sentry\/(react|browser)(\/|$)/
const clientChunkSizeLimitBytes = 500 * 1024

/** Checks the modules actually emitted, after framework transforms and tree shaking. */
export function runtimeBoundaries(): Plugin {
  return {
    name: 'patchplane-runtime-boundaries',
    apply: 'build',
    generateBundle(_options, bundle) {
      const environment = this.environment.name
      const isClient = environment === 'client'
      const modules = new Set<string>()
      const violations = new Set<string>()
      const oversizedChunks: string[] = []
      const chunks: Array<{
        file: string
        bytes: number
        modules: string[]
        imports: string[]
        dynamicImports: string[]
        largestModules: Array<{
          id: string
          renderedBytes: number
        }>
      }> = []
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue
        const chunkModules = Object.keys(output.modules).toSorted()
        const bytes = new TextEncoder().encode(output.code).byteLength
        chunks.push({
          file: output.fileName,
          bytes,
          modules: chunkModules,
          imports: [...output.imports],
          dynamicImports: [...output.dynamicImports],
          largestModules: Object.entries(output.modules)
            .map(([id, module]) => ({
              id,
              renderedBytes: module.renderedLength,
            }))
            .toSorted((left, right) => right.renderedBytes - left.renderedBytes)
            .slice(0, 20),
        })
        if (isClient && bytes > clientChunkSizeLimitBytes) {
          oversizedChunks.push(
            `${output.fileName}: ${bytes} bytes (limit ${clientChunkSizeLimitBytes})`,
          )
        }
        for (const id of chunkModules) {
          modules.add(id)
          if (isClient) {
            // Rolldown omits external dynamic imports from chunk.dynamicImports.
            // Their dependencies remain visible on the emitted module's graph.
            const info = this.getModuleInfo(id)
            for (const dependency of [
              ...(info?.importedIds ?? []),
              ...(info?.dynamicallyImportedIds ?? []),
            ]) {
              if (isBuiltin(dependency)) violations.add(dependency)
            }
          }
          if (
            isClient
              ? serverSentryModule.test(id) ||
                id.includes('__vite-browser-external')
              : browserSentryModule.test(id)
          ) {
            violations.add(id)
          }
        }
        if (isClient) {
          for (const id of [...output.imports, ...output.dynamicImports]) {
            if (isBuiltin(id)) violations.add(id)
          }
        }
      }
      if (violations.size > 0) {
        this.error(
          `Forbidden modules emitted in ${environment}:\n${[...violations].join('\n')}`,
        )
      }
      if (oversizedChunks.length > 0) {
        this.error(
          `Client chunks exceed Vite's 500 kB warning threshold:\n${oversizedChunks.join('\n')}`,
        )
      }
      // Local evidence stays outside deployable output and bundle measurements.
      const evidenceDirectory = resolve(
        this.environment.config.root,
        '../../.patchplane/state/build',
      )
      mkdirSync(evidenceDirectory, { recursive: true })
      writeFileSync(
        resolve(evidenceDirectory, `${environment}-runtime-modules.json`),
        JSON.stringify(
          {
            environment,
            modules: [...modules].toSorted(),
            chunks: chunks.toSorted((left, right) => left.file.localeCompare(right.file)),
            violations: [],
          },
          null,
          2,
        ),
      )
    },
  }
}
