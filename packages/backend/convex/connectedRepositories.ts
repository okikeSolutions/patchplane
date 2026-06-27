import type { UserIdentity } from 'convex/server'
import { ConvexError, v } from 'convex/values'
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server'

function workOSOrganizationId(identity: UserIdentity) {
  const value =
    identity.organizationId ??
    identity.orgId ??
    identity.organization_id ??
    identity.org_id

  return typeof value === 'string' && value.length > 0 ? value : null
}

function requireSystemIngestionSecret(secret: string) {
  const expected = process.env.PATCHPLANE_SYSTEM_INGESTION_SECRET

  if (expected === undefined || expected.length === 0 || secret !== expected) {
    throw new ConvexError('System ingestion secret required')
  }
}

async function requireWorkOSIdentity(ctx: {
  auth: { getUserIdentity(): Promise<UserIdentity | null> }
}) {
  const identity = await ctx.auth.getUserIdentity()

  if (identity === null) {
    throw new ConvexError('Authentication required')
  }

  return identity
}

function requireWorkOSWorkspace(identity: UserIdentity, workspaceId: string) {
  const organizationId = workOSOrganizationId(identity)

  if (organizationId === null) {
    throw new ConvexError('Active WorkOS organization required')
  }

  if (workspaceId !== `workos:${organizationId}`) {
    throw new ConvexError('Workspace mismatch')
  }
}

function workspaceOrganizationId(workspaceId: string) {
  return workspaceId.startsWith('workos:')
    ? workspaceId.slice('workos:'.length)
    : null
}

async function requireMembershipPermission(
  ctx: QueryCtx | MutationCtx,
  identity: UserIdentity,
  workspaceId: string,
  permission: string,
) {
  const organizationId = workspaceOrganizationId(workspaceId)

  if (organizationId === null) {
    throw new ConvexError('WorkOS workspace required')
  }

  const memberships = await ctx.db
    .query('memberships')
    .withIndex('by_auth_and_org', (q) =>
      q.eq('authId', identity.subject).eq('organizationId', organizationId),
    )
    .collect()
  const activeMemberships = memberships.filter(
    (membership) => membership.status === 'active',
  )
  const membershipWithPermission = activeMemberships.find((membership) =>
    membership.permissions.includes(permission),
  )

  if (membershipWithPermission === undefined) {
    throw new ConvexError('Permission required')
  }
}

const connectionStatus = v.union(
  v.literal('active'),
  v.literal('suspended'),
  v.literal('removed'),
  v.literal('reconnect_required'),
)

const connectedRepositoryReturn = v.object({
  id: v.string(),
  provider: v.string(),
  workspaceId: v.string(),
  installationId: v.string(),
  repositoryExternalId: v.string(),
  repositoryOwner: v.string(),
  repositoryName: v.string(),
  repositoryFullName: v.string(),
  private: v.boolean(),
  selected: v.boolean(),
  permissionsJson: v.optional(v.string()),
  status: connectionStatus,
  connectedByActorId: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
})

const connectedAccountInput = v.object({
  provider: v.literal('github'),
  installationId: v.string(),
  accountExternalId: v.string(),
  accountLogin: v.string(),
  accountType: v.optional(v.string()),
})

const connectedRepositoryInput = v.object({
  provider: v.literal('github'),
  installationId: v.string(),
  repositoryExternalId: v.string(),
  repositoryOwner: v.string(),
  repositoryName: v.string(),
  repositoryFullName: v.string(),
  private: v.boolean(),
  selected: v.boolean(),
  permissionsJson: v.optional(v.string()),
})

function toConnectedRepositoryReturn(
  repository: {
    readonly _id: string
    readonly provider: string
    readonly workspaceId: string
    readonly installationId: string
    readonly repositoryExternalId: string
    readonly repositoryOwner: string
    readonly repositoryName: string
    readonly repositoryFullName: string
    readonly private: boolean
    readonly selected: boolean
    readonly permissionsJson?: string
    readonly status: 'active' | 'suspended' | 'removed' | 'reconnect_required'
    readonly connectedByActorId: string
    readonly createdAt: number
    readonly updatedAt: number
  },
) {
  return {
    id: repository['_id'],
    provider: repository.provider,
    workspaceId: repository.workspaceId,
    installationId: repository.installationId,
    repositoryExternalId: repository.repositoryExternalId,
    repositoryOwner: repository.repositoryOwner,
    repositoryName: repository.repositoryName,
    repositoryFullName: repository.repositoryFullName,
    private: repository.private,
    selected: repository.selected,
    permissionsJson: repository.permissionsJson,
    status: repository.status,
    connectedByActorId: repository.connectedByActorId,
    createdAt: repository.createdAt,
    updatedAt: repository.updatedAt,
  }
}

export const createGitHubConnectionIntent = mutation({
  args: {
    state: v.string(),
    workspaceId: v.string(),
    returnPathname: v.optional(v.string()),
    expiresAt: v.number(),
  },
  returns: v.object({ state: v.string() }),
  handler: async (ctx, args) => {
    const identity = await requireWorkOSIdentity(ctx)
    requireWorkOSWorkspace(identity, args.workspaceId)
    await requireMembershipPermission(
      ctx,
      identity,
      args.workspaceId,
      'repo:connect',
    )

    await ctx.db.insert('githubConnectionIntents', {
      state: args.state,
      workspaceId: args.workspaceId,
      actorId: `workos:${identity.subject}`,
      returnPathname: args.returnPathname,
      expiresAt: args.expiresAt,
      createdAt: Date.now(),
    })

    return { state: args.state }
  },
})

export const consumeGitHubConnectionIntent = mutation({
  args: {
    state: v.string(),
    workspaceId: v.string(),
  },
  returns: v.object({
    workspaceId: v.string(),
    actorId: v.string(),
    returnPathname: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const identity = await requireWorkOSIdentity(ctx)
    requireWorkOSWorkspace(identity, args.workspaceId)
    await requireMembershipPermission(
      ctx,
      identity,
      args.workspaceId,
      'repo:connect',
    )

    const intent = await ctx.db
      .query('githubConnectionIntents')
      .withIndex('by_state', (q) => q.eq('state', args.state))
      .unique()

    if (intent === null) {
      throw new ConvexError('GitHub connection state not found')
    }

    if (intent.workspaceId !== args.workspaceId) {
      throw new ConvexError('GitHub connection state workspace mismatch')
    }

    if (intent.actorId !== `workos:${identity.subject}`) {
      throw new ConvexError('GitHub connection state actor mismatch')
    }

    if (intent.consumedAt !== undefined) {
      throw new ConvexError('GitHub connection state already consumed')
    }

    if (intent.expiresAt <= Date.now()) {
      throw new ConvexError('GitHub connection state expired')
    }

    await ctx.db.patch('githubConnectionIntents', intent['_id'], {
      consumedAt: Date.now(),
    })

    return {
      workspaceId: intent.workspaceId,
      actorId: intent.actorId,
      returnPathname: intent.returnPathname,
    }
  },
})

export const upsertGitHubInstallationRepositories = mutation({
  args: {
    workspaceId: v.string(),
    account: connectedAccountInput,
    repositories: v.array(connectedRepositoryInput),
  },
  returns: v.array(connectedRepositoryReturn),
  handler: async (ctx, args) => {
    const identity = await requireWorkOSIdentity(ctx)
    requireWorkOSWorkspace(identity, args.workspaceId)
    await requireMembershipPermission(
      ctx,
      identity,
      args.workspaceId,
      'repo:connect',
    )

    const now = Date.now()
    const connectedByActorId = `workos:${identity.subject}`
    const existingAccount = await ctx.db
      .query('connectedRepositoryAccounts')
      .withIndex('by_provider_installation', (q) =>
        q
          .eq('provider', args.account.provider)
          .eq('installationId', args.account.installationId),
      )
      .unique()

    if (existingAccount === null) {
      await ctx.db.insert('connectedRepositoryAccounts', {
        ...args.account,
        workspaceId: args.workspaceId,
        status: 'active',
        connectedByActorId,
        createdAt: now,
        updatedAt: now,
      })
    } else {
      if (existingAccount.workspaceId !== args.workspaceId) {
        throw new ConvexError('GitHub installation is connected to another workspace')
      }

      await ctx.db.patch('connectedRepositoryAccounts', existingAccount['_id'], {
        accountExternalId: args.account.accountExternalId,
        accountLogin: args.account.accountLogin,
        accountType: args.account.accountType,
        status: 'active',
        updatedAt: now,
      })
    }

    const upsertedIds = []
    for (const repository of args.repositories) {
      const existingRepository = await ctx.db
        .query('connectedRepositories')
        .withIndex('by_provider_repository', (q) =>
          q
            .eq('provider', repository.provider)
            .eq('repositoryExternalId', repository.repositoryExternalId),
        )
        .unique()

      if (existingRepository === null) {
        const id = await ctx.db.insert('connectedRepositories', {
          ...repository,
          workspaceId: args.workspaceId,
          status: 'active',
          connectedByActorId,
          createdAt: now,
          updatedAt: now,
        })
        upsertedIds.push(id)
      } else {
        if (existingRepository.workspaceId !== args.workspaceId) {
          throw new ConvexError('GitHub repository is connected to another workspace')
        }

        await ctx.db.patch('connectedRepositories', existingRepository['_id'], {
          installationId: repository.installationId,
          repositoryOwner: repository.repositoryOwner,
          repositoryName: repository.repositoryName,
          repositoryFullName: repository.repositoryFullName,
          private: repository.private,
          selected: repository.selected,
          permissionsJson: repository.permissionsJson,
          status: 'active',
          updatedAt: now,
        })
        upsertedIds.push(existingRepository['_id'])
      }
    }

    const repositories = await Promise.all(
      upsertedIds.map((id) => ctx.db.get('connectedRepositories', id)),
    )

    return repositories.flatMap((repository) =>
      repository === null ? [] : [toConnectedRepositoryReturn(repository)],
    )
  },
})

export const listForWorkspace = query({
  args: { workspaceId: v.string() },
  returns: v.array(connectedRepositoryReturn),
  handler: async (ctx, args) => {
    const identity = await requireWorkOSIdentity(ctx)
    requireWorkOSWorkspace(identity, args.workspaceId)
    await requireMembershipPermission(
      ctx,
      identity,
      args.workspaceId,
      'workspace:view',
    )

    const repositories = await ctx.db
      .query('connectedRepositories')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', args.workspaceId))
      .collect()

    return repositories.map(toConnectedRepositoryReturn)
  },
})

export const lookupGitHubWebhookRoute = query({
  args: {
    systemSecret: v.string(),
    installationId: v.string(),
    repositoryExternalId: v.string(),
  },
  returns: v.union(
    v.object({
      workspaceId: v.string(),
      repositoryFullName: v.string(),
      status: connectionStatus,
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    requireSystemIngestionSecret(args.systemSecret)

    const repository = await ctx.db
      .query('connectedRepositories')
      .withIndex('by_provider_repository', (q) =>
        q
          .eq('provider', 'github')
          .eq('repositoryExternalId', args.repositoryExternalId),
      )
      .unique()

    if (
      repository === null ||
      repository.installationId !== args.installationId ||
      !repository.selected ||
      repository.status !== 'active'
    ) {
      return null
    }

    return {
      workspaceId: repository.workspaceId,
      repositoryFullName: repository.repositoryFullName,
      status: repository.status,
    }
  },
})
