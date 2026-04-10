import { ConvexError } from 'convex/values'
import type { Doc, Id } from '../_generated/dataModel'
import type { DatabaseReader, MutationCtx } from '../_generated/server'
import { readBootstrapConfigDefaults } from './configDefaults'

interface ExecutionTargetLookup {
  readonly projectId: string
  readonly key: string
  readonly repositoryConnectionId?: Id<'repositories'>
}

interface PolicyBundleLookup {
  readonly projectId: string
  readonly key: string
}

interface ExecutionTargetReferenceLookup {
  readonly projectId: string
  readonly reference: string
  readonly repositoryConnectionId?: Id<'repositories'>
}

interface PolicyBundleReferenceLookup {
  readonly projectId: string
  readonly reference: string
}

function createConfigResolutionError(
  code:
    | 'CONFIG_NOT_FOUND'
    | 'CONFIG_DUPLICATE'
    | 'CONFIG_DISABLED'
    | 'CONFIG_BOOTSTRAP_FAILED',
  message: string,
  details: Record<string, unknown>,
) {
  return new ConvexError({
    code,
    message,
    ...details,
  })
}

async function listExecutionTargetsByKey(
  db: DatabaseReader,
  lookup: ExecutionTargetLookup,
) {
  return await db
    .query('executionTargets')
    .withIndex('by_project_and_key', (queryBuilder) =>
      queryBuilder.eq('projectId', lookup.projectId).eq('key', lookup.key),
    )
    .collect()
}

export async function findExactExecutionTargetByKey(
  db: DatabaseReader,
  lookup: ExecutionTargetLookup,
) {
  const targets = await listExecutionTargetsByKey(db, lookup)
  const exactMatches = targets.filter(
    (target) => target.repositoryConnectionId === lookup.repositoryConnectionId,
  )

  if (exactMatches.length > 1) {
    throw createConfigResolutionError(
      'CONFIG_DUPLICATE',
      `Multiple execution targets found for exact key "${lookup.key}" lookup.`,
      {
        projectId: lookup.projectId,
        key: lookup.key,
        repositoryConnectionId: lookup.repositoryConnectionId
          ? String(lookup.repositoryConnectionId)
          : null,
      },
    )
  }

  return exactMatches[0] ?? null
}

export function selectSingleExecutionTarget(
  targets: ReadonlyArray<Doc<'executionTargets'>>,
  lookup: ExecutionTargetLookup,
) {
  const repositoryScopedTargets = lookup.repositoryConnectionId
    ? targets.filter(
        (target) =>
          target.repositoryConnectionId === lookup.repositoryConnectionId,
      )
    : []
  const enabledRepositoryScopedTargets = repositoryScopedTargets.filter(
    (target) => target.enabled,
  )

  if (enabledRepositoryScopedTargets.length > 1) {
    throw createConfigResolutionError(
      'CONFIG_DUPLICATE',
      `Multiple enabled execution targets found for key "${lookup.key}" and repository "${String(lookup.repositoryConnectionId)}".`,
      {
        projectId: lookup.projectId,
        key: lookup.key,
        repositoryConnectionId: String(lookup.repositoryConnectionId),
      },
    )
  }

  if (enabledRepositoryScopedTargets.length === 1) {
    return enabledRepositoryScopedTargets[0]
  }

  if (repositoryScopedTargets.length > 0) {
    throw createConfigResolutionError(
      'CONFIG_DISABLED',
      `Execution target "${lookup.key}" is disabled for repository "${String(lookup.repositoryConnectionId)}".`,
      {
        projectId: lookup.projectId,
        key: lookup.key,
        repositoryConnectionId: String(lookup.repositoryConnectionId),
      },
    )
  }

  const defaultTargets = targets.filter(
    (target) => target.repositoryConnectionId === undefined,
  )
  const enabledDefaultTargets = defaultTargets.filter(
    (target) => target.enabled,
  )

  if (enabledDefaultTargets.length > 1) {
    throw createConfigResolutionError(
      'CONFIG_DUPLICATE',
      `Multiple enabled default execution targets found for key "${lookup.key}".`,
      {
        projectId: lookup.projectId,
        key: lookup.key,
      },
    )
  }

  if (enabledDefaultTargets.length === 1) {
    return enabledDefaultTargets[0]
  }

  if (defaultTargets.length > 0) {
    throw createConfigResolutionError(
      'CONFIG_DISABLED',
      `Execution target "${lookup.key}" exists but is disabled.`,
      {
        projectId: lookup.projectId,
        key: lookup.key,
      },
    )
  }

  return null
}

async function listPolicyBundlesByKey(
  db: DatabaseReader,
  lookup: PolicyBundleLookup,
) {
  return await db
    .query('policyBundles')
    .withIndex('by_project_and_key', (queryBuilder) =>
      queryBuilder.eq('projectId', lookup.projectId).eq('key', lookup.key),
    )
    .collect()
}

export async function findExactPolicyBundleByKey(
  db: DatabaseReader,
  lookup: PolicyBundleLookup,
) {
  const bundles = await listPolicyBundlesByKey(db, lookup)

  if (bundles.length > 1) {
    throw createConfigResolutionError(
      'CONFIG_DUPLICATE',
      `Multiple policy bundles found for exact key "${lookup.key}" lookup.`,
      {
        projectId: lookup.projectId,
        key: lookup.key,
      },
    )
  }

  return bundles[0] ?? null
}

function selectSinglePolicyBundle(
  bundles: ReadonlyArray<Doc<'policyBundles'>>,
  lookup: PolicyBundleLookup,
) {
  const enabledBundles = bundles.filter((bundle) => bundle.enabled)

  if (enabledBundles.length > 1) {
    throw createConfigResolutionError(
      'CONFIG_DUPLICATE',
      `Multiple enabled policy bundles found for key "${lookup.key}".`,
      {
        projectId: lookup.projectId,
        key: lookup.key,
      },
    )
  }

  if (enabledBundles.length === 1) {
    return enabledBundles[0]
  }

  if (bundles.length > 0) {
    throw createConfigResolutionError(
      'CONFIG_DISABLED',
      `Policy bundle "${lookup.key}" exists but is disabled.`,
      {
        projectId: lookup.projectId,
        key: lookup.key,
      },
    )
  }

  return null
}

async function findExecutionTargetById(
  db: DatabaseReader,
  lookup: ExecutionTargetReferenceLookup,
) {
  let target: Doc<'executionTargets'> | null

  try {
    target = await db.get(
      'executionTargets',
      lookup.reference as Id<'executionTargets'>,
    )
  } catch {
    return null
  }

  if (!target || target.projectId !== lookup.projectId) {
    return null
  }

  return target
}

async function findPolicyBundleById(
  db: DatabaseReader,
  lookup: PolicyBundleReferenceLookup,
) {
  let bundle: Doc<'policyBundles'> | null

  try {
    bundle = await db.get(
      'policyBundles',
      lookup.reference as Id<'policyBundles'>,
    )
  } catch {
    return null
  }

  if (!bundle || bundle.projectId !== lookup.projectId) {
    return null
  }

  return bundle
}

export async function findExecutionTargetByKey(
  db: DatabaseReader,
  lookup: ExecutionTargetLookup,
) {
  const targets = await listExecutionTargetsByKey(db, lookup)

  return selectSingleExecutionTarget(targets, lookup)
}

export async function findExecutionTargetByReference(
  db: DatabaseReader,
  lookup: ExecutionTargetReferenceLookup,
) {
  const targetById = await findExecutionTargetById(db, lookup)

  if (targetById) {
    return targetById
  }

  return findExecutionTargetByKey(db, {
    projectId: lookup.projectId,
    key: lookup.reference,
    repositoryConnectionId: lookup.repositoryConnectionId,
  })
}

export async function ensureExecutionTargetByKey(
  ctx: MutationCtx,
  lookup: ExecutionTargetLookup,
) {
  const existing = await findExecutionTargetByKey(ctx.db, lookup)

  if (existing) {
    return existing
  }

  const defaults = readBootstrapConfigDefaults()

  if (lookup.key !== defaults.executionTargetKey) {
    throw createConfigResolutionError(
      'CONFIG_NOT_FOUND',
      `No execution target found for key "${lookup.key}".`,
      {
        projectId: lookup.projectId,
        key: lookup.key,
        repositoryConnectionId: lookup.repositoryConnectionId
          ? String(lookup.repositoryConnectionId)
          : null,
      },
    )
  }

  const exactExisting = await findExactExecutionTargetByKey(ctx.db, {
    ...lookup,
    repositoryConnectionId: undefined,
  })

  if (exactExisting) {
    if (!exactExisting.enabled) {
      throw createConfigResolutionError(
        'CONFIG_DISABLED',
        `Default execution target "${lookup.key}" exists but is disabled.`,
        {
          projectId: lookup.projectId,
          key: lookup.key,
          executionTargetId: String(exactExisting._id),
        },
      )
    }

    return exactExisting
  }

  const now = Date.now()
  const executionTargetId = await ctx.db.insert('executionTargets', {
    projectId: lookup.projectId,
    key: lookup.key,
    repositoryConnectionId: undefined,
    sandboxProvider: defaults.sandboxProvider,
    runtimeProvider: defaults.runtimeProvider,
    defaultBaseBranch: undefined,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  })

  const executionTarget = await ctx.db.get(
    'executionTargets',
    executionTargetId,
  )

  if (!executionTarget) {
    throw createConfigResolutionError(
      'CONFIG_BOOTSTRAP_FAILED',
      `Failed to create bootstrap execution target "${lookup.key}".`,
      {
        projectId: lookup.projectId,
        key: lookup.key,
      },
    )
  }

  return executionTarget
}

export async function ensureExecutionTargetByReference(
  ctx: MutationCtx,
  lookup: ExecutionTargetReferenceLookup,
) {
  const targetById = await findExecutionTargetById(ctx.db, lookup)

  if (targetById) {
    return targetById
  }

  return ensureExecutionTargetByKey(ctx, {
    projectId: lookup.projectId,
    key: lookup.reference,
    repositoryConnectionId: lookup.repositoryConnectionId,
  })
}

export async function findPolicyBundleByKey(
  db: DatabaseReader,
  lookup: PolicyBundleLookup,
) {
  const bundles = await listPolicyBundlesByKey(db, lookup)

  return selectSinglePolicyBundle(bundles, lookup)
}

export async function findPolicyBundleByReference(
  db: DatabaseReader,
  lookup: PolicyBundleReferenceLookup,
) {
  const bundleById = await findPolicyBundleById(db, lookup)

  if (bundleById) {
    return bundleById
  }

  return findPolicyBundleByKey(db, {
    projectId: lookup.projectId,
    key: lookup.reference,
  })
}

export async function ensurePolicyBundleByKey(
  ctx: MutationCtx,
  lookup: PolicyBundleLookup,
) {
  const existing = await findPolicyBundleByKey(ctx.db, lookup)

  if (existing) {
    return existing
  }

  const defaults = readBootstrapConfigDefaults()

  if (lookup.key !== defaults.policyBundleKey) {
    throw createConfigResolutionError(
      'CONFIG_NOT_FOUND',
      `No policy bundle found for key "${lookup.key}".`,
      {
        projectId: lookup.projectId,
        key: lookup.key,
      },
    )
  }

  const exactExisting = await findExactPolicyBundleByKey(ctx.db, lookup)

  if (exactExisting) {
    if (!exactExisting.enabled) {
      throw createConfigResolutionError(
        'CONFIG_DISABLED',
        `Policy bundle "${lookup.key}" exists but is disabled.`,
        {
          projectId: lookup.projectId,
          key: lookup.key,
          policyBundleId: String(exactExisting._id),
        },
      )
    }

    return exactExisting
  }

  const now = Date.now()
  const policyBundleId = await ctx.db.insert('policyBundles', {
    projectId: lookup.projectId,
    key: lookup.key,
    requiredReviewers: [...defaults.requiredReviewers],
    minimumScore: defaults.minimumScore,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  })

  const policyBundle = await ctx.db.get('policyBundles', policyBundleId)

  if (!policyBundle) {
    throw createConfigResolutionError(
      'CONFIG_BOOTSTRAP_FAILED',
      `Failed to create bootstrap policy bundle "${lookup.key}".`,
      {
        projectId: lookup.projectId,
        key: lookup.key,
      },
    )
  }

  return policyBundle
}

export async function ensurePolicyBundleByReference(
  ctx: MutationCtx,
  lookup: PolicyBundleReferenceLookup,
) {
  const bundleById = await findPolicyBundleById(ctx.db, lookup)

  if (bundleById) {
    return bundleById
  }

  return ensurePolicyBundleByKey(ctx, {
    projectId: lookup.projectId,
    key: lookup.reference,
  })
}
