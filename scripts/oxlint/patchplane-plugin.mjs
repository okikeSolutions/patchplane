import { readFileSync } from 'node:fs'

const EFFECT_MODULES = new Set(['effect', 'effect/Effect'])
const RUNTIME_EXECUTION_NAMES = new Set([
  'runPromise',
  'runPromiseExit',
  'runSync',
  'runSyncExit',
])
const PROMISE_STATIC_METHODS = new Set([
  'all',
  'allSettled',
  'any',
  'race',
  'reject',
  'resolve',
  'withResolvers',
])
const PROMISE_CHAIN_METHODS = new Set(['then', 'catch', 'finally'])

const registry = JSON.parse(
  readFileSync(
    new URL('../../config/effect-boundaries.json', import.meta.url),
    'utf8',
  ),
)

function buildLimits(kind) {
  const limits = new Map()
  for (const entry of registry.exceptions ?? []) {
    if (entry.kind !== kind) continue
    limits.set(entry.file, (limits.get(entry.file) ?? 0) + entry.expectedCount)
  }
  return limits
}

const runtimeEntryLimits = buildLimits('runtime-entry')
const tryPromiseLimits = buildLimits('try-promise')
const asyncBoundaryLimits = buildLimits('async-boundary')
const nativePromiseLimits = buildLimits('native-promise')

function normalizedFilename(context) {
  return context.filename.replaceAll('\\', '/')
}

function isGovernedFile(context) {
  const filename = normalizedFilename(context)
  if (/\.(?:spec|test)\.[cm]?[jt]sx?$/.test(filename)) return false
  if (filename.includes('/scripts/')) return false
  return (
    filename.includes('/packages/') ||
    filename.includes('/apps/') ||
    filename.includes('/tests/fixtures/')
  )
}

function matchingRegistryLimit(context, limits) {
  const filename = normalizedFilename(context)
  for (const [file, count] of limits.entries()) {
    if (filename === file || filename.endsWith(`/${file}`)) return count
  }
  return 0
}

function variableForIdentifier(identifier, context) {
  for (
    let scope = context.sourceCode.getScope(identifier);
    scope !== null;
    scope = scope.upper
  ) {
    const variable = scope.set.get(identifier.name)
    if (variable !== undefined) return variable
  }
  return undefined
}

function isUnshadowedGlobal(identifier, context) {
  const variable = variableForIdentifier(identifier, context)
  return variable === undefined || variable.defs.length === 0
}

function importedIdentifierName(node) {
  return node.type === 'Identifier' ? node.name : node.value
}

function effectBindings() {
  const namespaces = new Set()
  const named = new Map()

  return {
    importDeclaration(node) {
      if (!EFFECT_MODULES.has(node.source.value)) return
      for (const specifier of node.specifiers) {
        if (specifier.type === 'ImportNamespaceSpecifier') {
          namespaces.add(specifier.local.name)
          continue
        }
        if (specifier.type !== 'ImportSpecifier') continue
        const imported = importedIdentifierName(specifier.imported)
        if (node.source.value === 'effect' && imported === 'Effect') {
          namespaces.add(specifier.local.name)
        } else if (node.source.value === 'effect/Effect') {
          named.set(specifier.local.name, imported)
        }
      }
    },
    memberName(node) {
      if (node.type !== 'MemberExpression' || node.optional) return undefined
      if (
        node.object.type !== 'Identifier' ||
        !namespaces.has(node.object.name)
      )
        return undefined
      if (!node.computed && node.property.type === 'Identifier')
        return node.property.name
      if (
        node.computed &&
        node.property.type === 'Literal' &&
        typeof node.property.value === 'string'
      ) {
        return node.property.value
      }
      return undefined
    },
    callName(node) {
      if (node.type !== 'CallExpression') return undefined
      if (node.callee.type === 'Identifier') return named.get(node.callee.name)
      return this.memberName(node.callee)
    },
  }
}

function meta(messageIds, description = 'Enforce Patchplane V2 Effect rules') {
  return {
    type: 'problem',
    docs: { description },
    schema: [],
    messages: messageIds,
  }
}

function isTryPromiseThunk(node, bindings) {
  const property = node.parent
  if (
    property?.type !== 'Property' ||
    property.value !== node ||
    property.computed ||
    property.key.type !== 'Identifier' ||
    property.key.name !== 'try'
  ) {
    return false
  }
  const object = property.parent
  const call = object?.parent
  return (
    object?.type === 'ObjectExpression' &&
    call?.type === 'CallExpression' &&
    call.arguments[0] === object &&
    bindings.callName(call) === 'tryPromise'
  )
}

function runtimeExecutionName(node, bindings) {
  const effectName = bindings.callName(node)
  if (effectName !== undefined && RUNTIME_EXECUTION_NAMES.has(effectName)) {
    return effectName
  }
  if (
    node.callee.type === 'MemberExpression' &&
    !node.callee.optional &&
    !node.callee.computed &&
    node.callee.property.type === 'Identifier' &&
    RUNTIME_EXECUTION_NAMES.has(node.callee.property.name)
  ) {
    return node.callee.property.name
  }
  return undefined
}

const noUnregisteredPromiseBoundary = {
  meta: meta({
    effectPromise:
      'Effect.promise has no typed failure channel. Register an explicit try-promise boundary or use native Effect.',
    untypedTryPromise:
      'Effect.tryPromise must use the { try, catch } form with an explicit Patchplane-owned error mapper.',
    unregisteredTryPromise:
      'Effect.tryPromise requires a registered try-promise exception in config/effect-boundaries.json.',
    unregisteredRuntime:
      'Effect runtime execution requires a registered runtime-entry exception in config/effect-boundaries.json.',
    unregisteredAsync:
      'Async functions require a registered async-boundary exception in config/effect-boundaries.json.',
    unregisteredNativePromise:
      'Native Promise construction, combinators, and chains require a registered native-promise exception in config/effect-boundaries.json.',
  }),
  create(context) {
    if (!isGovernedFile(context)) return {}
    const bindings = effectBindings()
    const limits = {
      runtime: matchingRegistryLimit(context, runtimeEntryLimits),
      tryPromise: matchingRegistryLimit(context, tryPromiseLimits),
      async: matchingRegistryLimit(context, asyncBoundaryLimits),
      nativePromise: matchingRegistryLimit(context, nativePromiseLimits),
    }
    const counts = { runtime: 0, tryPromise: 0, async: 0, nativePromise: 0 }

    const inspectFunction = (node) => {
      if (!node.async || isTryPromiseThunk(node, bindings)) return
      counts.async += 1
      if (counts.async > limits.async) {
        context.report({ node, messageId: 'unregisteredAsync' })
      }
    }

    return {
      ImportDeclaration: (node) => bindings.importDeclaration(node),
      ArrowFunctionExpression: inspectFunction,
      FunctionDeclaration: inspectFunction,
      FunctionExpression: inspectFunction,
      NewExpression(node) {
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'Promise' &&
          isUnshadowedGlobal(node.callee, context)
        ) {
          counts.nativePromise += 1
          if (counts.nativePromise > limits.nativePromise) {
            context.report({ node, messageId: 'unregisteredNativePromise' })
          }
        }
      },
      CallExpression(node) {
        const effectName = bindings.callName(node)
        if (effectName === 'promise') {
          context.report({ node: node.callee, messageId: 'effectPromise' })
          return
        }
        if (effectName === 'tryPromise') {
          const options = node.arguments[0]
          const hasCatch =
            options?.type === 'ObjectExpression' &&
            options.properties.some(
              (property) =>
                property.type === 'Property' &&
                !property.computed &&
                property.key.type === 'Identifier' &&
                property.key.name === 'catch',
            )
          if (!hasCatch) {
            context.report({
              node: node.callee,
              messageId: 'untypedTryPromise',
            })
            return
          }
          counts.tryPromise += 1
          if (counts.tryPromise > limits.tryPromise) {
            context.report({
              node: node.callee,
              messageId: 'unregisteredTryPromise',
            })
          }
          return
        }

        if (runtimeExecutionName(node, bindings) !== undefined) {
          counts.runtime += 1
          if (counts.runtime > limits.runtime) {
            context.report({
              node: node.callee,
              messageId: 'unregisteredRuntime',
            })
          }
          return
        }

        if (
          node.callee.type === 'MemberExpression' &&
          !node.callee.optional &&
          !node.callee.computed &&
          node.callee.property.type === 'Identifier'
        ) {
          const prop = node.callee.property.name
          const isPromiseStatic =
            node.callee.object.type === 'Identifier' &&
            node.callee.object.name === 'Promise' &&
            isUnshadowedGlobal(node.callee.object, context) &&
            PROMISE_STATIC_METHODS.has(prop)
          const isPromiseChain = PROMISE_CHAIN_METHODS.has(prop)
          if (isPromiseStatic || isPromiseChain) {
            counts.nativePromise += 1
            if (counts.nativePromise > limits.nativePromise) {
              context.report({
                node: node.callee,
                messageId: 'unregisteredNativePromise',
              })
            }
          }
        }
      },
    }
  },
}

const noDetachedEffectFork = {
  meta: meta({
    detached:
      'Detached Effect fibers escape structured concurrency. Use a scoped fiber instead.',
  }),
  create(context) {
    if (!isGovernedFile(context)) return {}
    const bindings = effectBindings()
    return {
      ImportDeclaration: (node) => bindings.importDeclaration(node),
      MemberExpression(node) {
        const name = bindings.memberName(node)
        if (name === 'forkDetach' || name === 'forkDaemon') {
          context.report({ node, messageId: 'detached' })
        }
      },
      CallExpression(node) {
        if (node.callee.type !== 'Identifier') return
        const name = bindings.callName(node)
        if (name === 'forkDetach' || name === 'forkDaemon') {
          context.report({ node: node.callee, messageId: 'detached' })
        }
      },
    }
  },
}

const noUntracedEffectServiceMethod = {
  meta: meta({
    unnamed:
      'Inline Effect service methods need a stable operation boundary. Wrap the method in Effect.fn("Service.method").',
  }),
  create(context) {
    if (!isGovernedFile(context)) return {}
    const bindings = effectBindings()
    const isWrapped = (node) => {
      if (node.type === 'CallExpression') {
        let callee = node.callee
        while (callee.type === 'CallExpression') {
          if (bindings.callName(callee) === 'fn') return true
          callee = callee.callee
        }
        return bindings.callName(node) === 'fn'
      }
      return (
        node.type !== 'ArrowFunctionExpression' &&
        node.type !== 'FunctionExpression'
      )
    }

    return {
      ImportDeclaration: (node) => bindings.importDeclaration(node),
      CallExpression(node) {
        if (
          node.callee.type !== 'MemberExpression' ||
          node.callee.computed ||
          node.callee.property.type !== 'Identifier' ||
          node.callee.property.name !== 'of'
        ) {
          return
        }
        const value = node.arguments[0]
        if (value?.type !== 'ObjectExpression') return
        for (const property of value.properties) {
          if (property.type !== 'Property' || property.computed) continue
          if (!isWrapped(property.value)) {
            context.report({ node: property.value, messageId: 'unnamed' })
          }
        }
      },
    }
  },
}

function nearestFunction(ancestors) {
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const node = ancestors[index]
    if (
      node.type === 'ArrowFunctionExpression' ||
      node.type === 'FunctionExpression' ||
      node.type === 'FunctionDeclaration'
    ) {
      return node
    }
  }
  return undefined
}

const noThrowInEffectSync = {
  meta: meta({
    thrown:
      'Throwing inside Effect.sync creates a defect. Use Effect.try or Effect.fail instead.',
  }),
  create(context) {
    if (!isGovernedFile(context)) return {}
    const bindings = effectBindings()
    return {
      ImportDeclaration: (node) => bindings.importDeclaration(node),
      ThrowStatement(node) {
        const callback = nearestFunction(context.sourceCode.getAncestors(node))
        const parent = callback?.parent
        if (
          parent?.type === 'CallExpression' &&
          parent.arguments.includes(callback) &&
          bindings.callName(parent) === 'sync'
        ) {
          context.report({ node, messageId: 'thrown' })
        }
      },
    }
  },
}

const preferEffectPatternMatching = {
  meta: meta({
    switch:
      'Use effect/Match with Match.exhaustive or Match.orElse instead of switch.',
  }),
  create(context) {
    if (!isGovernedFile(context)) return {}
    return {
      SwitchStatement(node) {
        context.report({ node, messageId: 'switch' })
      },
    }
  },
}

export const rules = {
  'no-unregistered-promise-boundary': noUnregisteredPromiseBoundary,
  'no-detached-effect-fork': noDetachedEffectFork,
  'no-untraced-effect-service-method': noUntracedEffectServiceMethod,
  'no-throw-in-effect-sync': noThrowInEffectSync,
  'prefer-effect-pattern-matching': preferEffectPatternMatching,
}

export default {
  meta: { name: 'patchplane' },
  rules,
}
