import { describe, expect, it } from '@effect/vitest'
import { Schema } from 'effect'
import {
  extractImportSpecifiers,
  isProductionSourceFile,
  listSourceFiles,
  readRepoFile,
} from './architecture-files'

const PackageManifestSchema = Schema.fromJsonString(
  Schema.Struct({
    name: Schema.String,
    dependencies: Schema.optionalKey(
      Schema.Record(Schema.String, Schema.String),
    ),
    devDependencies: Schema.optionalKey(
      Schema.Record(Schema.String, Schema.String),
    ),
  }),
)

function readManifest(path: string) {
  return Schema.decodeSync(PackageManifestSchema)(readRepoFile(path))
}

function collectProductionImports(directory: string) {
  const files = listSourceFiles(directory).filter(isProductionSourceFile)
  return files.flatMap((file) =>
    extractImportSpecifiers(file, readRepoFile(file)).map((specifier) => ({
      file,
      specifier,
    })),
  )
}

describe('V2 architecture boundaries', () => {
  it('keeps packages/domain restricted to Effect only', () => {
    const imports = collectProductionImports('packages/domain/src')
    const violations = imports.filter(
      ({ specifier }) =>
        !specifier.startsWith('.') &&
        specifier !== 'effect' &&
        !specifier.startsWith('effect/'),
    )
    expect(violations).toEqual([])
  })

  it('keeps packages/contracts restricted to Effect and @patchplane/domain', () => {
    const imports = collectProductionImports('packages/contracts/src')
    const violations = imports.filter(
      ({ specifier }) =>
        !specifier.startsWith('.') &&
        specifier !== 'effect' &&
        !specifier.startsWith('effect/') &&
        specifier !== '@patchplane/domain',
    )
    expect(violations).toEqual([])
  })

  it('keeps packages/core free of provider SDKs, plugins, and apps', () => {
    const imports = collectProductionImports('packages/core/src')
    const allowedExternal = new Set([
      '@patchplane/domain',
      '@patchplane/contracts',
    ])
    const violations = imports.filter(
      ({ specifier }) =>
        !specifier.startsWith('.') &&
        specifier !== 'effect' &&
        !specifier.startsWith('effect/') &&
        !allowedExternal.has(specifier),
    )
    expect(violations).toEqual([])
  })

  it('keeps apps/web free of backend plugins, server, infra, and provider SDKs', () => {
    const forbidden = [
      /^@patchplane\/plugins(?:\/|$)/,
      /^@patchplane\/core(?:\/|$)/,
      /^@patchplane\/server(?:\/|$)/,
      /^@patchplane\/infra(?:\/|$)/,
      /^@effect\/sql-pg(?:\/|$)/,
      /^alchemy(?:\/|$)/,
      /^@alchemy\.run\//,
      /^@workos/,
      /^@octokit\//,
      /^octokit(?:\/|$)/,
      /^@daytona\//,
      /^@distilled\.cloud\//,
    ]
    const violations = collectProductionImports('apps/web/src').filter(
      ({ specifier }) => forbidden.some((pattern) => pattern.test(specifier)),
    )
    expect(violations).toEqual([])
  })

  it('keeps packages/cli free of plugins, server, web, and infra', () => {
    const forbidden = [
      /^@patchplane\/plugins(?:\/|$)/,
      /^@patchplane\/server(?:\/|$)/,
      /^@patchplane\/web(?:\/|$)/,
      /^@patchplane\/infra(?:\/|$)/,
      /^alchemy(?:\/|$)/,
      /^@alchemy\.run\//,
    ]
    const violations = collectProductionImports('packages/cli/src').filter(
      ({ specifier }) => forbidden.some((pattern) => pattern.test(specifier)),
    )
    expect(violations).toEqual([])
  })

  it('keeps apps/infra out of every runtime package and app', () => {
    const runtimeDirs = [
      'packages/domain/src',
      'packages/contracts/src',
      'packages/core/src',
      'packages/plugins/src',
      'packages/cli/src',
      'apps/server/src',
      'apps/web/src',
    ]
    const violations = runtimeDirs
      .flatMap((dir) => collectProductionImports(dir))
      .filter(
        ({ specifier }) =>
          specifier === '@patchplane/infra' ||
          specifier.startsWith('@patchplane/infra/') ||
          specifier.includes('/apps/infra/'),
      )
    expect(violations).toEqual([])
  })

  it('keeps removed V1 frameworks out of workspace manifests', () => {
    const manifests = [
      'package.json',
      'packages/domain/package.json',
      'packages/contracts/package.json',
      'packages/core/package.json',
      'packages/plugins/package.json',
      'packages/cli/package.json',
      'apps/server/package.json',
      'apps/web/package.json',
      'apps/infra/package.json',
    ]
    const forbidden = [
      /^convex(?:\/|$)/,
      /^@convex-dev\//,
      /^@tanstack\//,
      /^@earendil-works\//,
      /^@effect\/sql-d1$/,
    ]
    const violations: Array<{ readonly file: string; readonly dep: string }> =
      []
    for (const file of manifests) {
      const manifest = readManifest(file)
      const deps = [
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.devDependencies ?? {}),
      ]
      for (const dep of deps) {
        if (forbidden.some((pattern) => pattern.test(dep))) {
          violations.push({ file, dep })
        }
      }
    }
    expect(violations).toEqual([])
  })
})
