import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Schema } from 'effect'
import {
  isProductionSourceFile,
  listSourceFiles,
  parseAst,
  readRepoFile,
  REPO_ROOT,
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

function collectEffectNamespaces(program: AstNode): ReadonlySet<string> {
  const namespaces = new Set<string>()
  const body = Array.isArray(program.body) ? program.body : []
  for (const statement of body) {
    if (!isAstNode(statement) || statement.type !== 'ImportDeclaration')
      continue
    if (!isAstNode(statement.source)) continue
    const source = statement.source.value
    if (source !== 'effect' && source !== 'effect/Effect') continue
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
        namespaces.add(localName)
      } else if (
        source === 'effect' &&
        specifier.type === 'ImportSpecifier' &&
        isAstNode(specifier.imported) &&
        specifier.imported.name === 'Effect'
      ) {
        namespaces.add(localName)
      }
    }
  }
  return namespaces
}

export function scanBoundaryUsages(
  file: string,
  source: string,
): BoundaryUsageCounts {
  const { program } = parseAst(file, source)
  const root: unknown = program
  const effectNamespaces = isAstNode(root)
    ? collectEffectNamespaces(root)
    : new Set<string>()
  const counts = {
    'runtime-entry': 0,
    'try-promise': 0,
    'async-boundary': 0,
    'native-promise': 0,
    effectPromiseCalls: 0,
  }

  const visit = (node: AstNode, parent: AstNode | undefined) => {
    if (
      (node.type === 'FunctionDeclaration' ||
        node.type === 'FunctionExpression' ||
        node.type === 'ArrowFunctionExpression') &&
      node.async === true
    ) {
      const isTryProperty =
        parent?.type === 'Property' &&
        isAstNode(parent.key) &&
        parent.key.type === 'Identifier' &&
        parent.key.name === 'try'
      if (!isTryProperty) {
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
      if (
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

        if (isEffectNamespace && prop === 'promise') {
          counts.effectPromiseCalls += 1
        } else if (isEffectNamespace && prop === 'tryPromise') {
          counts['try-promise'] += 1
        } else if (RUNTIME_NAMES.has(prop)) {
          counts['runtime-entry'] += 1
        } else if (objName === 'Promise' && PROMISE_STATICS.has(prop)) {
          counts['native-promise'] += 1
        } else if (!isEffectNamespace && PROMISE_CHAINS.has(prop)) {
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
          if (isAstNode(item)) visit(item, node)
        }
      } else if (isAstNode(value)) {
        visit(value, node)
      }
    }
  }

  if (isAstNode(root)) {
    visit(root, undefined)
  }
  return counts
}

export function validateRegistryAgainstFiles(
  registry: V2EffectBoundaryRegistry,
  actualByFile: ReadonlyMap<string, BoundaryUsageCounts>,
): ReadonlyArray<string> {
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

    if (!existsSync(resolve(REPO_ROOT, entry.file))) {
      errors.push(`Stale exception ${entry.id}: missing file ${entry.file}`)
    }
    if (!existsSync(resolve(REPO_ROOT, entry.evidence))) {
      errors.push(
        `Exception ${entry.id} missing evidence test file: ${entry.evidence}`,
      )
    }

    const key = `${entry.file}::${entry.kind}`
    expectedByKey.set(key, (expectedByKey.get(key) ?? 0) + entry.expectedCount)
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
}

describe('V2 Effect boundary registry', () => {
  it.effect(
    'matches config/effect-boundaries.json exactly with zero unregistered or stale allowances',
    () =>
      Effect.gen(function* () {
        const registry = yield* Schema.decodeEffect(
          V2EffectBoundaryRegistryJson,
        )(readRepoFile('config/effect-boundaries.json'))

        const productionFiles = [
          ...listSourceFiles('packages'),
          ...listSourceFiles('apps'),
        ].filter(isProductionSourceFile)

        const actualByFile = new Map<string, BoundaryUsageCounts>()
        for (const file of productionFiles) {
          actualByFile.set(file, scanBoundaryUsages(file, readRepoFile(file)))
        }

        expect(validateRegistryAgainstFiles(registry, actualByFile)).toEqual([])
      }),
  )

  it('rejects stale or unused Promise exception allowances', () => {
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

    const errors = validateRegistryAgainstFiles(staleRegistry, actual)
    expect(errors).toEqual([
      'packages/core/src/index.ts: stale try-promise allowance (found 0, registered 1)',
    ])
  })

  it('allows Effect.catch and aliased Effect namespace catch while flagging promise.catch', () => {
    const effectCatchCounts = scanBoundaryUsages(
      'sample-effect.ts',
      `
        import { Effect as E } from 'effect'
        import * as Fx from 'effect/Effect'
        export const a = E.succeed(1).pipe(E.catch(() => E.succeed(2)))
        export const b = Fx.succeed(1).pipe(Fx.catch(() => Fx.succeed(2)))
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
