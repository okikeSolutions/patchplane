import { execFileSync } from 'node:child_process'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Schema } from 'effect'
import * as ts from 'typescript'
import {
  ArchitectureFileSystemLayer,
  fileText,
  pathExists,
  relativeToRepo,
  repoRoot,
  sourceFilesUnder,
} from './architecture-files'

const RuntimeBridgeEntry = Schema.Struct({
  id: Schema.String,
  file: Schema.String,
  owner: Schema.String,
  kind: Schema.String,
  expectedCalls: Schema.Number,
  expectedAsyncFunctions: Schema.Number,
  status: Schema.Literal('approved'),
  evidence: Schema.NullOr(Schema.String),
})

const AsyncOrchestrationEntry = Schema.Struct({
  id: Schema.String,
  file: Schema.String,
  owner: Schema.String,
  expectedFunctions: Schema.Number,
  status: Schema.Literal('migration'),
})

const NativeDeadlineEntry = Schema.Struct({
  id: Schema.String,
  file: Schema.String,
  owner: Schema.String,
  expectedPrimitives: Schema.Number,
  expectedAsyncFunctions: Schema.Number,
  evidence: Schema.NullOr(Schema.String),
})

const PatternMatchingSwitchDebtEntry = Schema.Struct({
  id: Schema.String,
  file: Schema.String,
  owner: Schema.String,
  expectedSwitches: Schema.Number,
  expectedFingerprints: Schema.Array(Schema.String),
  status: Schema.Literal('migration'),
})

const EffectBoundaryRegistry = Schema.Struct({
  version: Schema.Literal(1),
  runtimeBridges: Schema.Array(RuntimeBridgeEntry),
  asyncOrchestrationExceptions: Schema.Array(AsyncOrchestrationEntry),
  nativeDeadlineExceptions: Schema.Array(NativeDeadlineEntry),
  patternMatchingSwitchDebt: Schema.Array(PatternMatchingSwitchDebtEntry),
})

const runtimeExecutionNames = new Set([
  'runPromise',
  'runPromiseExit',
  'runSync',
  'runSyncExit',
])

function productionModule(file: string) {
  return (
    !file.endsWith('.test.ts') &&
    !file.endsWith('.test.tsx') &&
    !file.endsWith('.spec.ts') &&
    !file.endsWith('.spec.tsx') &&
    !file.endsWith('.d.ts') &&
    !file.includes('/test/') &&
    !file.includes('/_generated/') &&
    !file.includes('/scripts/') &&
    !file.endsWith('/live-rpc-smoke.ts')
  )
}

function parsedSource(file: string, source: string) {
  return ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
}

function nativePromiseOrchestration(file: string, source: string) {
  const sourceFile = parsedSource(file, source)
  const calls: string[] = []
  const visit = (node: ts.Node) => {
    if (
      ts.isAwaitExpression(node) ||
      (ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'Promise')
    ) {
      calls.push(node.getText(sourceFile))
    }
    if (ts.isCallExpression(node)) {
      const expression = node.expression
      if (
        ts.isPropertyAccessExpression(expression) ||
        ts.isPropertyAccessChain(expression)
      ) {
        if (
          ['then', 'catch', 'finally'].includes(expression.name.text) ||
          (ts.isIdentifier(expression.expression) &&
            expression.expression.text === 'Promise')
        ) {
          calls.push(expression.getText(sourceFile))
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return calls
}

function runtimeExecutionCalls(file: string, source: string) {
  const sourceFile = parsedSource(file, source)
  const calls: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression
      const name =
        ts.isPropertyAccessExpression(expression) ||
        ts.isPropertyAccessChain(expression)
          ? expression.name.text
          : ts.isIdentifier(expression)
            ? expression.text
            : undefined
      if (name !== undefined && runtimeExecutionNames.has(name)) {
        const location = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(),
        )
        calls.push(`${file}:${location.line + 1}:${name}`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return calls
}

function asyncOrchestrationFunctions(file: string, source: string) {
  const sourceFile = parsedSource(file, source)
  const calls: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isFunctionLike(node)) {
      const isAsync = node.modifiers?.some(
        ({ kind }) => kind === ts.SyntaxKind.AsyncKeyword,
      )
      const property = node.parent
      const object = ts.isPropertyAssignment(property)
        ? property.parent
        : undefined
      const call = object?.parent
      const tryPromiseThunk =
        ts.isPropertyAssignment(property) &&
        property.name.getText(sourceFile) === 'try' &&
        ts.isObjectLiteralExpression(object) &&
        ts.isCallExpression(call) &&
        call.arguments[0] === object &&
        call.expression.getText(sourceFile).endsWith('.tryPromise')
      if (isAsync && !tryPromiseThunk) {
        const location = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(),
        )
        calls.push(`${file}:${location.line + 1}:async`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return calls
}

function switchStatementFingerprints(file: string, source: string) {
  const sourceFile = parsedSource(file, source)
  const fingerprints: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isSwitchStatement(node)) {
      let ancestor: ts.Node | undefined = node.parent
      let owner = 'module'
      while (ancestor !== undefined) {
        if (ts.isFunctionDeclaration(ancestor) && ancestor.name !== undefined) {
          owner = ancestor.name.text
          break
        }
        if (ts.isVariableDeclaration(ancestor)) {
          owner = ancestor.name.getText(sourceFile)
          break
        }
        ancestor = ancestor.parent
      }
      fingerprints.push(`${owner}:${node.expression.getText(sourceFile)}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return fingerprints
}

function nativeDeadlinePrimitives(file: string, source: string) {
  const sourceFile = parsedSource(file, source)
  const calls: string[] = []
  const record = (node: ts.Node, name: string) => {
    const location = sourceFile.getLineAndCharacterOfPosition(node.getStart())
    calls.push(`${file}:${location.line + 1}:${name}`)
  }
  const visit = (node: ts.Node) => {
    if (
      ts.isNewExpression(node) &&
      ((ts.isIdentifier(node.expression) &&
        node.expression.text === 'Promise') ||
        (ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          node.expression.expression.text === 'globalThis' &&
          node.expression.name.text === 'Promise'))
    )
      record(node, 'new Promise')
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      (node.expression.text === 'setTimeout' ||
        node.expression.text === 'setInterval')
    )
      record(node, node.expression.text)
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'globalThis' &&
      (node.expression.name.text === 'setTimeout' ||
        node.expression.name.text === 'setInterval')
    )
      record(node, `globalThis.${node.expression.name.text}`)
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'Promise' &&
      node.expression.name.text === 'race'
    )
      record(node, 'Promise.race')
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'AbortSignal' &&
      node.expression.name.text === 'timeout'
    )
      record(node, 'AbortSignal.timeout')
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isPropertyAccessExpression(node.expression.expression) &&
      ts.isIdentifier(node.expression.expression.expression) &&
      node.expression.expression.expression.text === 'globalThis' &&
      ((node.expression.expression.name.text === 'Promise' &&
        node.expression.name.text === 'race') ||
        (node.expression.expression.name.text === 'AbortSignal' &&
          node.expression.name.text === 'timeout'))
    )
      record(
        node,
        `globalThis.${node.expression.expression.name.text}.${node.expression.name.text}`,
      )
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return calls
}

const loadRegistry = Effect.fnUntraced(function* () {
  const text = yield* fileText('config/effect-boundaries.json')
  const input = yield* Effect.try(() => JSON.parse(text) as unknown)
  return yield* Schema.decodeUnknownEffect(EffectBoundaryRegistry)(input)
})

const productionFiles = Effect.fnUntraced(function* () {
  const files = [
    ...(yield* sourceFilesUnder('packages')),
    ...(yield* sourceFilesUnder('apps/client')),
    ...(yield* sourceFilesUnder('apps/source-control')),
    ...(yield* sourceFilesUnder('apps/infra')),
  ]
  const modules: Array<{ readonly file: string; readonly source: string }> = []
  for (const absolute of files) {
    const file = yield* relativeToRepo(absolute)
    if (!productionModule(file)) continue
    modules.push({ file, source: yield* fileText(file) })
  }
  modules.push({
    file: 'alchemy.run.ts',
    source: yield* fileText('alchemy.run.ts'),
  })
  return modules
})

describe('Effect-native boundaries', () => {
  it.effect(
    'registers every runtime execution call exactly and approves bridge owners',
    () =>
      Effect.gen(function* () {
        const registry = yield* loadRegistry()
        const modules = yield* productionFiles()
        const actual = new Map<string, string[]>()
        for (const { file, source } of modules) {
          const calls = runtimeExecutionCalls(file, source)
          if (calls.length > 0) actual.set(file, calls)
        }

        const registered = new Map(
          registry.runtimeBridges.map((entry) => [entry.file, entry] as const),
        )
        expect(
          [...actual.keys()].filter((file) => !registered.has(file)),
        ).toEqual([])
        expect(
          [...registered.keys()].filter((file) => !actual.has(file)),
        ).toEqual([])

        for (const [file, calls] of actual) {
          expect(
            calls.length,
            `${file} runtime calls changed; update the implementation and registry together:\n${calls.join('\n')}`,
          ).toBe(registered.get(file)?.expectedCalls)
        }
      }).pipe(Effect.provide(ArchitectureFileSystemLayer)),
  )

  it.effect('keeps Effect orchestration and pattern-matching debt empty', () =>
    Effect.gen(function* () {
      const registry = yield* loadRegistry()
      expect(
        registry.runtimeBridges.filter(({ status }) => status !== 'approved'),
      ).toEqual([])
      expect(registry.asyncOrchestrationExceptions).toEqual([])
      expect(registry.patternMatchingSwitchDebt).toEqual([])
      for (const entry of [
        ...registry.runtimeBridges,
        ...registry.asyncOrchestrationExceptions,
        ...registry.nativeDeadlineExceptions,
      ]) {
        const calls = asyncOrchestrationFunctions(
          entry.file,
          yield* fileText(entry.file),
        )
        expect(
          calls.length,
          `${entry.file} async functions changed; update implementation and registry together:\n${calls.join('\n')}`,
        ).toBe(
          'expectedFunctions' in entry
            ? entry.expectedFunctions
            : entry.expectedAsyncFunctions,
        )
      }
    }).pipe(Effect.provide(ArchitectureFileSystemLayer)),
  )

  it.effect(
    'confines native Promise deadlines to exact registered production files',
    () =>
      Effect.gen(function* () {
        const registry = yield* loadRegistry()
        const registered = new Set(
          registry.nativeDeadlineExceptions.map(({ file }) => file),
        )
        const actual = new Map<string, string[]>()
        for (const { file, source } of yield* productionFiles()) {
          const calls = nativeDeadlinePrimitives(file, source)
          if (calls.length > 0) actual.set(file, calls)
        }
        expect(
          [...actual.keys()].filter((file) => !registered.has(file)),
        ).toEqual([])
        expect([...registered].filter((file) => !actual.has(file))).toEqual([])
        for (const entry of registry.nativeDeadlineExceptions) {
          const primitives = actual.get(entry.file) ?? []
          expect(
            primitives.length,
            `${entry.file} native deadline primitives changed; update implementation and registry together:\n${primitives.join('\n')}`,
          ).toBe(entry.expectedPrimitives)
        }
      }).pipe(Effect.provide(ArchitectureFileSystemLayer)),
  )

  it.effect(
    'ratchets every production switch statement toward effect/Match',
    () =>
      Effect.gen(function* () {
        const registry = yield* loadRegistry()
        const registered = new Map(
          registry.patternMatchingSwitchDebt.map((entry) => [
            entry.file,
            entry.expectedFingerprints,
          ]),
        )
        const actual = new Map<string, ReadonlyArray<string>>()
        for (const { file, source } of yield* productionFiles()) {
          const fingerprints = switchStatementFingerprints(file, source)
          if (fingerprints.length > 0) actual.set(file, fingerprints)
        }
        expect(
          [...actual.keys()].filter((file) => !registered.has(file)),
        ).toEqual([])
        expect(
          [...registered.keys()].filter((file) => !actual.has(file)),
        ).toEqual([])
        for (const entry of registry.patternMatchingSwitchDebt) {
          expect(entry.expectedFingerprints).toHaveLength(
            entry.expectedSwitches,
          )
          expect(
            actual.get(entry.file),
            `${entry.file} switch debt changed`,
          ).toEqual(entry.expectedFingerprints)
        }
      }).pipe(Effect.provide(ArchitectureFileSystemLayer)),
  )

  it.effect('keeps registry IDs unique and evidence references honest', () =>
    Effect.gen(function* () {
      const registry = yield* loadRegistry()
      const root = yield* repoRoot()
      const trackedFiles = yield* Effect.try(
        () =>
          new Set(
            execFileSync('git', ['ls-files', '-z'], {
              cwd: root,
              encoding: 'utf8',
            }).split('\0'),
          ),
      )
      const entries = [
        ...registry.runtimeBridges,
        ...registry.asyncOrchestrationExceptions,
        ...registry.nativeDeadlineExceptions,
        ...registry.patternMatchingSwitchDebt,
      ]
      expect(new Set(entries.map(({ id }) => id)).size).toBe(entries.length)
      for (const entry of entries) {
        expect(yield* pathExists(entry.file), entry.file).toBe(true)
        expect(
          trackedFiles.has(entry.file),
          `${entry.file} must be tracked`,
        ).toBe(true)
        if ('evidence' in entry && entry.evidence !== null) {
          expect(yield* pathExists(entry.evidence), entry.evidence).toBe(true)
          expect(
            trackedFiles.has(entry.evidence),
            `${entry.evidence} must be tracked`,
          ).toBe(true)
        }
      }
      for (const entry of registry.runtimeBridges) {
        if (entry.status === 'approved') {
          expect(
            entry.evidence,
            `${entry.id} needs behavioral evidence`,
          ).not.toBeNull()
        }
      }
    }).pipe(Effect.provide(ArchitectureFileSystemLayer)),
  )

  it.effect('keeps the normative document synchronized with the registry', () =>
    Effect.gen(function* () {
      const registry = yield* loadRegistry()
      const document = yield* fileText('docs/effect-boundaries.md')
      const documentedBoundaries = document.split('\n').flatMap((line) => {
        const cells = line
          .split('|')
          .map((cell) => cell.trim().replace(/^`|`$/g, ''))
        return cells.length >= 3 ? [[cells[1], cells[2]]] : []
      })
      for (const entry of [
        ...registry.runtimeBridges,
        ...registry.asyncOrchestrationExceptions,
        ...registry.nativeDeadlineExceptions,
        ...registry.patternMatchingSwitchDebt,
      ]) {
        expect(documentedBoundaries).toContainEqual([entry.id, entry.file])
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
        expect(
          asyncOrchestrationFunctions(
            'apps/source-control/src/worker.ts',
            sourceControlWorker,
          ),
        ).toEqual([])

        const webhookEntry = yield* fileText(
          'apps/source-control/src/webhook-worker.ts',
        )
        expect(
          runtimeExecutionCalls('webhook-worker.ts', webhookEntry),
        ).toHaveLength(1)
        expect(
          asyncOrchestrationFunctions(
            'apps/source-control/src/webhook-worker.ts',
            webhookEntry,
          ),
        ).toEqual([])
        const webhookWorker = (yield* Effect.all([
          fileText('apps/source-control/src/webhook-worker.ts'),
          ...(yield* sourceFilesUnder(
            'apps/source-control/src/webhook-worker',
          )).map(fileText),
        ])).join('\n')
        expect(
          nativeDeadlinePrimitives(
            'apps/source-control/src/webhook-worker',
            webhookWorker,
          ),
        ).toEqual([])
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
            if (
              asyncOrchestrationFunctions(file, source).length > 0 ||
              nativePromiseOrchestration(file, source).length > 0
            ) {
              violations.push(file)
            }
          }
        }
        expect(violations).toEqual([])
      }).pipe(Effect.provide(ArchitectureFileSystemLayer)),
  )

  it.effect('keeps Alchemy provisioning natively Effect-based', () =>
    Effect.gen(function* () {
      const source = yield* fileText('alchemy.run.ts')
      const sourceFile = parsedSource('alchemy.run.ts', source)
      const effectModules = sourceFile.statements.flatMap((statement) =>
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text === 'effect/Effect'
          ? [statement.moduleSpecifier.text]
          : [],
      )
      const stackPrograms: ts.Expression[] = []
      const visit = (node: ts.Node) => {
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          node.expression.expression.text === 'Alchemy' &&
          node.expression.name.text === 'Stack'
        ) {
          const program = node.arguments[2]
          if (program !== undefined) stackPrograms.push(program)
        }
        ts.forEachChild(node, visit)
      }
      visit(sourceFile)
      expect(effectModules).toEqual(['effect/Effect'])
      expect(stackPrograms).toHaveLength(1)
      expect(
        stackPrograms.every(
          (program) =>
            ts.isCallExpression(program) &&
            ts.isPropertyAccessExpression(program.expression) &&
            ts.isIdentifier(program.expression.expression) &&
            program.expression.expression.text === 'Effect' &&
            program.expression.name.text === 'gen',
        ),
      ).toBe(true)
      expect(asyncOrchestrationFunctions('alchemy.run.ts', source)).toEqual([])
      expect(nativePromiseOrchestration('alchemy.run.ts', source)).toEqual([])
    }).pipe(Effect.provide(ArchitectureFileSystemLayer)),
  )
})
