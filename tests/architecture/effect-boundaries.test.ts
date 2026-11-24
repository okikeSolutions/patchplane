import { describe, expect, it } from '@effect/vitest'
import { Effect, Schema } from 'effect'
import {
  ArchitecturePlatformLayer,
  isProductionSourceFile,
  listSourceFiles,
  parseAst,
  readRepoFile,
  repoFileExists,
} from './architecture-files'

const BoundaryKind = Schema.Literals([
  'runtime-entry',
  'try-promise',
  'async-boundary',
  'native-promise',
])
type BoundaryKind = typeof BoundaryKind.Type

const PromiseExceptionEntry = Schema.Struct({
  id: Schema.NonEmptyString,
  file: Schema.NonEmptyString,
  symbol: Schema.NonEmptyString,
  kind: BoundaryKind,
  expectedCount: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
  externalContract: Schema.NonEmptyString,
  interruptionAndCleanup: Schema.NonEmptyString,
  evidence: Schema.NonEmptyString,
  reviewCondition: Schema.NonEmptyString,
})

const V2EffectBoundaryRegistry = Schema.Struct({
  version: Schema.Literal(2),
  exceptions: Schema.Array(PromiseExceptionEntry),
})
type V2EffectBoundaryRegistry = typeof V2EffectBoundaryRegistry.Type

const V2EffectBoundaryRegistryJson = Schema.fromJsonString(
  V2EffectBoundaryRegistry,
)

const RUNTIME_NAMES = new Set([
  'runPromise',
  'runPromiseExit',
  'runSync',
  'runSyncExit',
])
const PROMISE_STATICS = new Set([
  'all',
  'allSettled',
  'any',
  'race',
  'reject',
  'resolve',
  'withResolvers',
])
const PROMISE_CHAINS = new Set(['then', 'catch', 'finally'])

interface BoundaryUsageCounts {
  readonly 'runtime-entry': number
  readonly 'try-promise': number
  readonly 'async-boundary': number
  readonly 'native-promise': number
  readonly effectPromiseCalls: number
}

interface AstNode {
  readonly type: string
  readonly [key: string]: unknown
}

function isAstNode(value: unknown): value is AstNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof Reflect.get(value, 'type') === 'string'
  )
}

function collectEffectNamespaces(program: AstNode): {
  readonly effectNamespaces: ReadonlySet<string>
  readonly effectNamed: ReadonlyMap<string, string>
  readonly streamNamespaces: ReadonlySet<string>
} {
  const effectNamespaces = new Set<string>()
  const effectNamed = new Map<string, string>()
  const streamNamespaces = new Set<string>()
  const body = Array.isArray(program.body) ? program.body : []
  for (const statement of body) {
    if (!isAstNode(statement) || statement.type !== 'ImportDeclaration')
      continue
    if (!isAstNode(statement.source)) continue
    const source = statement.source.value
    if (
      source !== 'effect' &&
      source !== 'effect/Effect' &&
      source !== 'effect/Stream'
    )
      continue
    const specifiers = Array.isArray(statement.specifiers)
      ? statement.specifiers
      : []
    for (const specifier of specifiers) {
      if (!isAstNode(specifier) || !isAstNode(specifier.local)) continue
      const localName = String(specifier.local.name)
      if (
        source === 'effect/Effect' &&
        (specifier.type === 'ImportNamespaceSpecifier' ||
          specifier.type === 'ImportDefaultSpecifier')
      ) {
        effectNamespaces.add(localName)
      } else if (
        source === 'effect/Effect' &&
        specifier.type === 'ImportSpecifier' &&
        isAstNode(specifier.imported)
      ) {
        effectNamed.set(localName, String(specifier.imported.name))
      } else if (
        source === 'effect/Stream' &&
        (specifier.type === 'ImportNamespaceSpecifier' ||
          specifier.type === 'ImportDefaultSpecifier')
      ) {
        streamNamespaces.add(localName)
      } else if (
        source === 'effect' &&
        specifier.type === 'ImportSpecifier' &&
        isAstNode(specifier.imported)
      ) {
        if (specifier.imported.name === 'Effect') {
          effectNamespaces.add(localName)
        } else if (specifier.imported.name === 'Stream') {
          streamNamespaces.add(localName)
        }
      }
    }
  }
  return { effectNamespaces, effectNamed, streamNamespaces }
}

export function scanBoundaryUsages(
  file: string,
  source: string,
): BoundaryUsageCounts {
  const { program } = parseAst(file, source)
  const root: unknown = program
  const { effectNamespaces, effectNamed, streamNamespaces } = isAstNode(root)
    ? collectEffectNamespaces(root)
    : {
        effectNamespaces: new Set<string>(),
        effectNamed: new Map<string, string>(),
        streamNamespaces: new Set<string>(),
      }
  const counts = {
    'runtime-entry': 0,
    'try-promise': 0,
    'async-boundary': 0,
    'native-promise': 0,
    effectPromiseCalls: 0,
  }

  const getEffectCallName = (node: AstNode): string | undefined => {
    if (node.type !== 'CallExpression' || !isAstNode(node.callee)) {
      return undefined
    }
    const callee = node.callee
    if (callee.type === 'Identifier') {
      return effectNamed.get(String(callee.name))
    }
    if (
      callee.type === 'MemberExpression' &&
      callee.computed === false &&
      isAstNode(callee.object) &&
      callee.object.type === 'Identifier' &&
      effectNamespaces.has(String(callee.object.name)) &&
      isAstNode(callee.property) &&
      callee.property.type === 'Identifier'
    ) {
      return String(callee.property.name)
    }
    return undefined
  }

  const visit = (
    node: AstNode,
    parent: AstNode | undefined,
    grandParent: AstNode | undefined,
    greatGrandParent: AstNode | undefined,
  ) => {
    if (
      (node.type === 'FunctionDeclaration' ||
        node.type === 'FunctionExpression' ||
        node.type === 'ArrowFunctionExpression') &&
      node.async === true
    ) {
      const isTryPromiseThunk =
        parent?.type === 'Property' &&
        isAstNode(parent.key) &&
        parent.key.type === 'Identifier' &&
        parent.key.name === 'try' &&
        grandParent?.type === 'ObjectExpression' &&
        greatGrandParent !== undefined &&
        getEffectCallName(greatGrandParent) === 'tryPromise'
      if (!isTryPromiseThunk) {
        counts['async-boundary'] += 1
      }
    }

    if (
      node.type === 'NewExpression' &&
      isAstNode(node.callee) &&
      node.callee.type === 'Identifier' &&
      node.callee.name === 'Promise'
    ) {
      counts['native-promise'] += 1
    }

    if (node.type === 'CallExpression' && isAstNode(node.callee)) {
      const callee = node.callee
      const effectCall = getEffectCallName(node)
      if (effectCall === 'promise') {
        counts.effectPromiseCalls += 1
      } else if (effectCall === 'tryPromise') {
        counts['try-promise'] += 1
      } else if (effectCall !== undefined && RUNTIME_NAMES.has(effectCall)) {
        counts['runtime-entry'] += 1
      } else if (
        callee.type === 'MemberExpression' &&
        callee.computed === false &&
        isAstNode(callee.property) &&
        callee.property.type === 'Identifier'
      ) {
        const prop = String(callee.property.name)
        const objName =
          isAstNode(callee.object) && callee.object.type === 'Identifier'
            ? String(callee.object.name)
            : undefined

        const isEffectNamespace =
          objName !== undefined && effectNamespaces.has(objName)
        const isStreamNamespace =
          objName !== undefined && streamNamespaces.has(objName)

        if (RUNTIME_NAMES.has(prop)) {
          counts['runtime-entry'] += 1
        } else if (objName === 'Promise' && PROMISE_STATICS.has(prop)) {
          counts['native-promise'] += 1
        } else if (
          !isEffectNamespace &&
          !isStreamNamespace &&
          PROMISE_CHAINS.has(prop)
        ) {
          counts['native-promise'] += 1
        }
      } else if (
        callee.type === 'Identifier' &&
        RUNTIME_NAMES.has(String(callee.name))
      ) {
        counts['runtime-entry'] += 1
      }
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === 'type' || key === 'start' || key === 'end') continue
      if (Array.isArray(value)) {
        for (const item of value) {
          if (isAstNode(item)) visit(item, node, parent, grandParent)
        }
      } else if (isAstNode(value)) {
        visit(value, node, parent, grandParent)
      }
    }
  }

  if (isAstNode(root)) {
    visit(root, undefined, undefined, undefined)
  }
  return counts
}

export const validateRegistryAgainstFiles = (
  registry: V2EffectBoundaryRegistry,
  actualByFile: ReadonlyMap<string, BoundaryUsageCounts>,
) =>
  Effect.gen(function* () {
    const errors: string[] = []
    const expectedByKey = new Map<string, number>()
    const seenIds = new Set<string>()

    for (const entry of registry.exceptions) {
      if (seenIds.has(entry.id)) {
        errors.push(`Duplicate exception ID: ${entry.id}`)
      }
      seenIds.add(entry.id)

      if (entry.file.includes('*')) {
        errors.push(
          `Wildcard exception path is forbidden (${entry.id}): ${entry.file}`,
        )
      }

      if (!(yield* repoFileExists(entry.file))) {
        errors.push(`Stale exception ${entry.id}: missing file ${entry.file}`)
      }
      if (!(yield* repoFileExists(entry.evidence))) {
        errors.push(
          `Exception ${entry.id} missing evidence test file: ${entry.evidence}`,
        )
      }

      const key = `${entry.file}::${entry.kind}`
      expectedByKey.set(
        key,
        (expectedByKey.get(key) ?? 0) + entry.expectedCount,
      )
    }

    const kinds: ReadonlyArray<BoundaryKind> = [
      'runtime-entry',
      'try-promise',
      'async-boundary',
      'native-promise',
    ]

    for (const [file, usage] of actualByFile) {
      if (usage.effectPromiseCalls > 0) {
        errors.push(`${file}: Effect.promise is forbidden`)
      }
      for (const kind of kinds) {
        const actual = usage[kind]
        const expected = expectedByKey.get(`${file}::${kind}`) ?? 0
        if (actual > expected) {
          errors.push(
            `${file}: unregistered ${kind} usage (found ${actual}, registered ${expected})`,
          )
        } else if (actual < expected) {
          errors.push(
            `${file}: stale ${kind} allowance (found ${actual}, registered ${expected})`,
          )
        }
      }
    }

    for (const [key, expected] of expectedByKey) {
      const [file, kind] = key.split('::')
      if (file === undefined || kind === undefined) continue
      if (!actualByFile.has(file) && expected > 0) {
        errors.push(
          `${file}: stale ${kind} allowance (file has 0 usages, registered ${expected})`,
        )
      }
    }

    return errors
  })

describe('V2 Effect boundary registry', () => {
  it.effect(
    'matches config/effect-boundaries.json exactly with zero unregistered or stale allowances',
    () =>
      Effect.gen(function* () {
        const registryJson = yield* readRepoFile(
          'config/effect-boundaries.json',
        )
        const registry = yield* Schema.decodeEffect(
          V2EffectBoundaryRegistryJson,
        )(registryJson)

        const productionFiles = [
          ...(yield* listSourceFiles('packages')),
          ...(yield* listSourceFiles('apps')),
        ].filter(isProductionSourceFile)

        const actualByFile = new Map<string, BoundaryUsageCounts>()
        for (const file of productionFiles) {
          const source = yield* readRepoFile(file)
          actualByFile.set(file, scanBoundaryUsages(file, source))
        }

        const errors = yield* validateRegistryAgainstFiles(
          registry,
          actualByFile,
        )
        expect(errors).toEqual([])
      }).pipe(Effect.provide(ArchitecturePlatformLayer)),
  )

  it.effect('rejects stale or unused Promise exception allowances', () =>
    Effect.gen(function* () {
      const staleRegistry: V2EffectBoundaryRegistry = {
        version: 2,
        exceptions: [
          {
            id: 'STALE-TEST-001',
            file: 'packages/core/src/index.ts',
            symbol: 'staleBridge',
            kind: 'try-promise',
            expectedCount: 1,
            externalContract: 'Synthetic stale test allowance',
            interruptionAndCleanup: 'None',
            evidence: 'tests/architecture/effect-boundaries.test.ts',
            reviewCondition: 'Remove immediately',
          },
        ],
      }

      const actual = new Map<string, BoundaryUsageCounts>([
        [
          'packages/core/src/index.ts',
          {
            'runtime-entry': 0,
            'try-promise': 0,
            'async-boundary': 0,
            'native-promise': 0,
            effectPromiseCalls: 0,
          },
        ],
      ])

      const errors = yield* validateRegistryAgainstFiles(staleRegistry, actual)
      expect(errors).toEqual([
        'packages/core/src/index.ts: stale try-promise allowance (found 0, registered 1)',
      ])
    }).pipe(Effect.provide(ArchitecturePlatformLayer)),
  )

  it('allows Effect.catch and Stream.catch while flagging promise.catch', () => {
    const effectCatchCounts = scanBoundaryUsages(
      'sample-effect.ts',
      `
        import { Effect as E, Stream as S } from 'effect'
        import * as Fx from 'effect/Effect'
        import * as St from 'effect/Stream'
        export const a = E.succeed(1).pipe(E.catch(() => E.succeed(2)))
        export const b = Fx.succeed(1).pipe(Fx.catch(() => Fx.succeed(2)))
        export const c = S.succeed(1).pipe(S.catch(() => S.succeed(2)))
        export const d = St.succeed(1).pipe(St.catch(() => St.succeed(2)))
      `,
    )
    expect(effectCatchCounts['native-promise']).toBe(0)

    const promiseCatchCounts = scanBoundaryUsages(
      'sample-promise.ts',
      `
        export const run = (value: { catch: (fn: () => void) => void }) =>
          value.catch(() => {})
      `,
    )
    expect(promiseCatchCounts['native-promise']).toBe(1)
  })
})
