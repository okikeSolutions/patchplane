const EFFECT_MODULES = new Set(['effect', 'effect/Effect'])
const EFFECT_CALLBACK_CONSTRUCTORS = new Set(['gen', 'promise', 'suspend', 'sync'])

function normalizedFilename(context) {
  return context.filename.replaceAll('\\', '/')
}

function isTestOrScript(context) {
  const filename = normalizedFilename(context)
  return /\.(?:spec|test)\.[cm]?[jt]sx?$/.test(filename) ||
    filename.includes('/scripts/') ||
    filename.includes('/smoke/') ||
    /\/(?:live|smoke)-[^/]+\.[cm]?[jt]s$/.test(filename)
}

function variableForIdentifier(identifier, context) {
  for (let scope = context.sourceCode.getScope(identifier); scope !== null; scope = scope.upper) {
    const variable = scope.set.get(identifier.name)
    if (variable !== undefined) return variable
  }
  return undefined
}

function isUnshadowedGlobal(identifier, context) {
  const variable = variableForIdentifier(identifier, context)
  return variable === undefined || variable.defs.length === 0
}

function effectBindings() {
  const namespaces = new Set()
  const named = new Map()

  return {
    namespaces,
    named,
    importDeclaration(node) {
      if (!EFFECT_MODULES.has(node.source.value)) return

      for (const specifier of node.specifiers) {
        if (specifier.type === 'ImportNamespaceSpecifier') {
          namespaces.add(specifier.local.name)
          continue
        }
        if (specifier.type !== 'ImportSpecifier') continue

        const imported = specifier.imported.type === 'Identifier'
          ? specifier.imported.name
          : specifier.imported.value

        if (node.source.value === 'effect' && imported === 'Effect') {
          namespaces.add(specifier.local.name)
        } else if (node.source.value === 'effect/Effect') {
          named.set(specifier.local.name, imported)
        }
      }
    },
    memberName(node) {
      if (node.type !== 'MemberExpression' || node.optional) return undefined
      if (node.object.type !== 'Identifier' || !namespaces.has(node.object.name)) return undefined
      if (!node.computed && node.property.type === 'Identifier') return node.property.name
      if (node.computed && node.property.type === 'Literal' && typeof node.property.value === 'string') {
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

function meta(messageIds, description = 'Enforce Patchplane Effect-native safety boundaries') {
  return {
    type: 'problem',
    docs: {
      description,
    },
    schema: [],
    messages: messageIds,
  }
}

const noDetachedEffectFork = {
  meta: meta({
    detached: 'Detached Effect fibers escape structured concurrency. Use a scoped fiber or an explicit entrypoint-level daemon.',
  }),
  create(context) {
    if (isTestOrScript(context)) return {}
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
        const name = bindings.named.get(node.callee.name)
        if (name === 'forkDetach' || name === 'forkDaemon') {
          context.report({ node: node.callee, messageId: 'detached' })
        }
      },
    }
  },
}

const noEffectPromise = {
  meta: meta({
    promise: 'Effect.promise has no typed error channel. Use Effect.tryPromise with a Patchplane-owned error mapping.',
  }),
  create(context) {
    if (isTestOrScript(context)) return {}
    const bindings = effectBindings()

    return {
      ImportDeclaration: (node) => bindings.importDeclaration(node),
      CallExpression(node) {
        if (bindings.callName(node) === 'promise') {
          context.report({ node: node.callee, messageId: 'promise' })
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

function effectCallbackName(functionNode, bindings) {
  const parent = functionNode?.parent
  if (parent?.type !== 'CallExpression' || !parent.arguments.includes(functionNode)) return undefined
  return bindings.callName(parent)
}

const noThrowInEffectSync = {
  meta: meta({
    thrown: 'Throwing inside Effect.sync creates a defect. Model expected failure with Effect.fail/try or use Effect.die explicitly.',
  }),
  create(context) {
    if (isTestOrScript(context)) return {}
    const bindings = effectBindings()

    return {
      ImportDeclaration: (node) => bindings.importDeclaration(node),
      ThrowStatement(node) {
        const callback = nearestFunction(context.sourceCode.getAncestors(node))
        if (effectCallbackName(callback, bindings) === 'sync') {
          context.report({ node, messageId: 'thrown' })
        }
      },
    }
  },
}

function insideTryStatement(node, callback) {
  for (let current = node.parent; current !== undefined && current !== callback; current = current.parent) {
    if (current.type === 'TryStatement' && current.block.range[0] <= node.range[0] && node.range[1] <= current.block.range[1]) {
      return true
    }
  }
  return false
}

const guardJsonParseInEffect = {
  meta: meta({
    parse: 'JSON.parse can throw inside this Effect constructor. Decode with Schema or map the failure through Effect.try.',
  }),
  create(context) {
    if (isTestOrScript(context)) return {}
    const bindings = effectBindings()

    return {
      ImportDeclaration: (node) => bindings.importDeclaration(node),
      CallExpression(node) {
        if (
          node.callee.type !== 'MemberExpression' ||
          node.callee.computed ||
          node.callee.object.type !== 'Identifier' ||
          node.callee.object.name !== 'JSON' ||
          node.callee.property.type !== 'Identifier' ||
          node.callee.property.name !== 'parse' ||
          !isUnshadowedGlobal(node.callee.object, context)
        ) return

        const callback = nearestFunction(context.sourceCode.getAncestors(node))
        const constructor = effectCallbackName(callback, bindings)
        if (!EFFECT_CALLBACK_CONSTRUCTORS.has(constructor) || constructor === 'try') return
        if (insideTryStatement(node, callback)) return

        context.report({ node: node.callee, messageId: 'parse' })
      },
    }
  },
}

const noRunSyncOutsideEntrypoint = {
  meta: meta({
    runSync: 'Do not execute Effect synchronously from a reusable module. Return the Effect and run it at a composition entrypoint.',
  }),
  create(context) {
    if (isTestOrScript(context)) return {}
    const filename = normalizedFilename(context)
    if (
      /\/(?:main|runtime|alchemy\.run)\.[cm]?[jt]sx?$/.test(filename) ||
      filename.includes('/apps/infra/')
    ) return {}

    const bindings = effectBindings()
    return {
      ImportDeclaration: (node) => bindings.importDeclaration(node),
      CallExpression(node) {
        const name = bindings.callName(node)
        if (name === 'runSync' || name === 'runSyncExit') {
          context.report({ node: node.callee, messageId: 'runSync' })
        }
      },
    }
  },
}

function isEffectGovernedPath(context) {
  const filename = normalizedFilename(context)
  return filename.includes('/packages/core/src/') ||
    filename.includes('/packages/plugins/src/') ||
    filename.includes('/packages/cli/src/') ||
    filename.includes('/apps/client/src/effect/') ||
    filename.includes('/apps/client/src/lib/') ||
    filename.includes('/apps/client/src/routes/api/') ||
    filename.includes('/apps/source-control/src/github/')
}

function isProcessEnvMember(node, context) {
  if (node.type !== 'MemberExpression' || node.object.type !== 'Identifier') return false
  const property = !node.computed && node.property.type === 'Identifier'
    ? node.property.name
    : node.computed && node.property.type === 'Literal'
      ? node.property.value
      : undefined

  return node.object.name === 'process' &&
    property === 'env' &&
    isUnshadowedGlobal(node.object, context)
}

function ambientEnvAccess(node, context) {
  if (node.type !== 'MemberExpression') return undefined

  if (isProcessEnvMember(node, context)) {
    const parentUsesAsObject = node.parent?.type === 'MemberExpression' && node.parent.object === node
    return parentUsesAsObject ? undefined : '<all>'
  }

  if (!isProcessEnvMember(node.object, context)) return undefined

  if (!node.computed && node.property.type === 'Identifier') return node.property.name
  if (node.computed && node.property.type === 'Literal' && typeof node.property.value === 'string') {
    return node.property.value
  }
  return '<dynamic>'
}

const noAmbientEnvInEffectCode = {
  meta: meta({
    ambient: 'Read configuration through Effect Config instead of ambient process.env (found: {{names}}).',
  }),
  create(context) {
    if (isTestOrScript(context) || !isEffectGovernedPath(context)) return {}
    if (normalizedFilename(context).endsWith('/packages/cli/src/services/env-file.ts')) return {}

    const accesses = []
    return {
      MemberExpression(node) {
        const name = ambientEnvAccess(node, context)
        if (name !== undefined && name !== 'NODE_ENV' && name !== 'INIT_CWD') {
          accesses.push({ name, node })
        }
      },
      'Program:exit'() {
        if (accesses.length === 0) return
        const names = [...new Set(accesses.map(({ name }) => name))].toSorted((left, right) => left.localeCompare(right)).join(', ')
        context.report({ node: accesses[0].node, messageId: 'ambient', data: { names } })
      },
    }
  },
}

function reactBindings() {
  const namespaces = new Set()
  const namedEffects = new Set()
  const namedStates = new Set()

  return {
    importDeclaration(node) {
      if (node.source.value !== 'react') return
      for (const specifier of node.specifiers) {
        if (specifier.type === 'ImportNamespaceSpecifier') {
          namespaces.add(specifier.local.name)
          continue
        }
        if (specifier.type !== 'ImportSpecifier') continue
        const imported = specifier.imported.type === 'Identifier'
          ? specifier.imported.name
          : specifier.imported.value
        if (imported === 'useEffect') namedEffects.add(specifier.local.name)
        if (imported === 'useState') namedStates.add(specifier.local.name)
      }
    },
    hookName(node) {
      if (node.type === 'Identifier') {
        if (namedEffects.has(node.name)) return 'useEffect'
        if (namedStates.has(node.name)) return 'useState'
        return undefined
      }
      if (
        node.type === 'MemberExpression' &&
        !node.optional &&
        node.object.type === 'Identifier' &&
        namespaces.has(node.object.name)
      ) {
        if (!node.computed && node.property.type === 'Identifier') return node.property.name
        if (node.computed && node.property.type === 'Literal') return node.property.value
      }
      return undefined
    },
  }
}

function effectCallForCallback(functionNode, bindings) {
  const parent = functionNode?.parent
  if (
    parent?.type === 'CallExpression' &&
    parent.arguments[0] === functionNode &&
    bindings.hookName(parent.callee) === 'useEffect'
  ) return parent
  return undefined
}

function effectCallbackForNode(node, context, bindings) {
  const callback = nearestFunction(context.sourceCode.getAncestors(node))
  const effectCall = effectCallForCallback(callback, bindings)
  return effectCall === undefined ? undefined : { callback, effectCall }
}

function enclosingEffectForNode(node, context, bindings) {
  const ancestors = context.sourceCode.getAncestors(node)
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const callback = ancestors[index]
    if (
      callback.type !== 'ArrowFunctionExpression' &&
      callback.type !== 'FunctionExpression' &&
      callback.type !== 'FunctionDeclaration'
    ) continue
    const effectCall = effectCallForCallback(callback, bindings)
    if (effectCall !== undefined) return { callback, effectCall }
  }
  return undefined
}

const noSynchronousSetStateInEffect = {
  meta: meta({
    synchronous: 'Do not synchronously set React state in an Effect. Derive during render, reset with a key, or update state in the event/subscription callback that caused the change.',
  }, 'Prevent derived, reset, and event-driven state updates in React Effects'),
  create(context) {
    const bindings = reactBindings()
    const setters = new Set()
    const reportedEffects = new Set()

    return {
      ImportDeclaration: (node) => bindings.importDeclaration(node),
      VariableDeclarator(node) {
        if (
          node.id.type !== 'ArrayPattern' ||
          node.id.elements[1]?.type !== 'Identifier' ||
          node.init?.type !== 'CallExpression' ||
          bindings.hookName(node.init.callee) !== 'useState'
        ) return
        const setter = variableForIdentifier(node.id.elements[1], context)
        if (setter !== undefined) setters.add(setter)
      },
      CallExpression(node) {
        if (
          node.callee.type !== 'Identifier' ||
          !setters.has(variableForIdentifier(node.callee, context))
        ) return
        const effect = effectCallbackForNode(node, context, bindings)
        if (effect === undefined || reportedEffects.has(effect.effectCall)) return
        reportedEffects.add(effect.effectCall)
        context.report({ node: effect.effectCall.callee, messageId: 'synchronous' })
      },
    }
  },
}

function isEffectResource(node, context) {
  if (node.callee.type === 'Identifier') {
    return ['setInterval', 'setTimeout', 'requestAnimationFrame'].includes(node.callee.name) &&
      isUnshadowedGlobal(node.callee, context)
  }
  if (node.callee.type !== 'MemberExpression' || node.callee.optional) return false
  const name = !node.callee.computed && node.callee.property.type === 'Identifier'
    ? node.callee.property.name
    : node.callee.computed && node.callee.property.type === 'Literal'
      ? node.callee.property.value
      : undefined
  return [
    'addEventListener',
    'observe',
    'on',
    'requestAnimationFrame',
    'setInterval',
    'setTimeout',
    'subscribe',
  ].includes(name)
}

function isCleanupExpression(node) {
  return node?.type === 'ArrowFunctionExpression' ||
    node?.type === 'FunctionExpression' ||
    node?.type === 'Identifier'
}

function effectReturnsCleanup(callback) {
  if (callback.body.type !== 'BlockStatement') return isCleanupExpression(callback.body)
  return callback.body.body.some((statement) =>
    statement.type === 'ReturnStatement' && isCleanupExpression(statement.argument)
  )
}

const requireEffectCleanup = {
  meta: meta({
    cleanup: 'This Effect creates a subscription, timer, observer, or animation frame but does not return cleanup.',
  }, 'Require cleanup for external resources created by React Effects'),
  create(context) {
    const bindings = reactBindings()
    const resources = new Map()

    return {
      ImportDeclaration: (node) => bindings.importDeclaration(node),
      CallExpression(node) {
        if (!isEffectResource(node, context)) return
        const effect = effectCallbackForNode(node, context, bindings)
        if (effect !== undefined && !resources.has(effect.effectCall)) {
          resources.set(effect.effectCall, { callback: effect.callback, node })
        }
      },
      'CallExpression:exit'(node) {
        const resource = resources.get(node)
        if (resource !== undefined && !effectReturnsCleanup(resource.callback)) {
          context.report({ node: resource.node.callee, messageId: 'cleanup' })
        }
      },
    }
  },
}

const noFetchInEffect = {
  meta: meta({
    fetch: 'Do not fetch data from a React Effect. Use route loaders, query hooks, or an event handler for interaction-driven requests.',
  }, 'Keep data fetching out of React Effects'),
  create(context) {
    const bindings = reactBindings()
    return {
      ImportDeclaration: (node) => bindings.importDeclaration(node),
      CallExpression(node) {
        if (
          node.callee.type !== 'Identifier' ||
          node.callee.name !== 'fetch' ||
          !isUnshadowedGlobal(node.callee, context)
        ) return
        if (enclosingEffectForNode(node, context, bindings) !== undefined) {
          context.report({ node: node.callee, messageId: 'fetch' })
        }
      },
    }
  },
}

export const rules = {
  'no-detached-effect-fork': noDetachedEffectFork,
  'no-effect-promise': noEffectPromise,
  'no-throw-in-effect-sync': noThrowInEffectSync,
  'guard-json-parse-in-effect': guardJsonParseInEffect,
  'no-run-sync-outside-entrypoint': noRunSyncOutsideEntrypoint,
  'no-ambient-env-in-effect-code': noAmbientEnvInEffectCode,
  'no-synchronous-set-state-in-effect': noSynchronousSetStateInEffect,
  'require-effect-cleanup': requireEffectCleanup,
  'no-fetch-in-effect': noFetchInEffect,
}

export default {
  meta: { name: 'patchplane' },
  rules,
}
