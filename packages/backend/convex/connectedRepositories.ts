import {
  paginationOptsValidator,
  paginationResultValidator,
  type UserIdentity,
} from 'convex/server'
import { ConvexError, v } from 'convex/values'
import { canonicalizeGitHubInstallationSyncProof } from '@patchplane/domain/github'
import { internal } from './_generated/api'
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from './_generated/server'

const maximumSynchronizedGitHubRepositories = 1_000

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

async function verifyGitHubInstallationSyncProof(input: {
  readonly issuedAt: number
  readonly signature: string
  readonly workspaceId: string
  readonly account: Parameters<
    typeof canonicalizeGitHubInstallationSyncProof
  >[0]['account']
  readonly repositories: Parameters<
    typeof canonicalizeGitHubInstallationSyncProof
  >[0]['repositories']
}) {
  const secret = process.env.PATCHPLANE_SYSTEM_INGESTION_SECRET
  const now = Date.now()
  if (
    secret === undefined ||
    secret.length === 0 ||
    !Number.isSafeInteger(input.issuedAt) ||
    Math.abs(now - input.issuedAt) > 5 * 60_000 ||
    !/^[0-9a-f]{64}$/.test(input.signature)
  ) {
    throw new ConvexError('GitHub installation sync proof is invalid')
  }
  const signature = Uint8Array.from(
    input.signature.match(/.{2}/g) ?? [],
    (byte) => Number.parseInt(byte, 16),
  )
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  const verified = await crypto.subtle.verify(
    'HMAC',
    key,
    signature,
    new TextEncoder().encode(canonicalizeGitHubInstallationSyncProof(input)),
  )
  if (!verified) {
    throw new ConvexError('GitHub installation sync proof is invalid')
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

const latestRepositoryVerificationReturn = v.object({
  workflowRunId: v.string(),
  workflowStatus: v.union(
    v.literal('queued'),
    v.literal('running'),
    v.literal('reviewed'),
    v.literal('failed'),
  ),
  verificationStatus: v.union(
    v.literal('queued'),
    v.literal('running'),
    v.literal('reviewed'),
    v.literal('approved'),
    v.literal('rejected'),
    v.literal('changes-requested'),
    v.literal('manual-review'),
    v.literal('failed'),
  ),
  pullRequestNumber: v.optional(v.number()),
  url: v.optional(v.string()),
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

function toConnectedRepositoryReturn(repository: {
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
}) {
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

    const now = Date.now()
    const expiredIntents = await ctx.db
      .query('githubConnectionIntents')
      .withIndex('by_expires_at', (q) => q.lt('expiresAt', now))
      .take(100)
    for (const intent of expiredIntents) {
      await ctx.db.delete('githubConnectionIntents', intent['_id'])
    }

    await ctx.db.insert('githubConnectionIntents', {
      state: args.state,
      workspaceId: args.workspaceId,
      actorId: `workos:${identity.subject}`,
      returnPathname: args.returnPathname,
      expiresAt: now + 10 * 60_000,
      createdAt: now,
    })

    return { state: args.state }
  },
})

export const stageGitHubConnectionInstallation = mutation({
  args: {
    state: v.string(),
    workspaceId: v.string(),
    installationId: v.string(),
    pkceVerifier: v.string(),
  },
  returns: v.null(),
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
    if (
      intent === null ||
      intent.workspaceId !== args.workspaceId ||
      intent.actorId !== `workos:${identity.subject}` ||
      intent.consumedAt !== undefined ||
      intent.expiresAt <= Date.now()
    ) {
      throw new ConvexError('GitHub connection state is invalid')
    }
    if (intent.installationId !== undefined) {
      throw new ConvexError('GitHub connection installation already staged')
    }
    if (
      !/^[1-9][0-9]{0,19}$/.test(args.installationId) ||
      !/^[A-Za-z0-9._~-]{43,128}$/.test(args.pkceVerifier)
    ) {
      throw new ConvexError('GitHub connection installation proof is invalid')
    }

    await ctx.db.patch('githubConnectionIntents', intent['_id'], {
      installationId: args.installationId,
      pkceVerifier: args.pkceVerifier,
    })
    return null
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
    installationId: v.string(),
    pkceVerifier: v.string(),
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

    if (
      intent.installationId === undefined ||
      intent.pkceVerifier === undefined
    ) {
      throw new ConvexError('GitHub connection installation is not staged')
    }

    await ctx.db.patch('githubConnectionIntents', intent['_id'], {
      consumedAt: Date.now(),
      pkceVerifier: undefined,
    })

    return {
      workspaceId: intent.workspaceId,
      actorId: intent.actorId,
      returnPathname: intent.returnPathname,
      installationId: intent.installationId,
      pkceVerifier: intent.pkceVerifier,
    }
  },
})

export const cleanupExpiredGitHubConnectionIntents = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const expiredIntents = await ctx.db
      .query('githubConnectionIntents')
      .withIndex('by_expires_at', (q) => q.lt('expiresAt', Date.now()))
      .take(100)
    for (const intent of expiredIntents) {
      await ctx.db.delete('githubConnectionIntents', intent['_id'])
    }
    if (expiredIntents.length === 100) {
      await ctx.scheduler.runAfter(
        0,
        internal.connectedRepositories.cleanupExpiredGitHubConnectionIntents,
        {},
      )
    }
    return expiredIntents.length
  },
})

export const upsertGitHubInstallationRepositories = mutation({
  args: {
    workspaceId: v.string(),
    proof: v.object({ issuedAt: v.number(), signature: v.string() }),
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
    if (args.repositories.length > maximumSynchronizedGitHubRepositories) {
      throw new ConvexError(
        'GitHub installation repository inventory exceeds the synchronization bound',
      )
    }
    await verifyGitHubInstallationSyncProof({
      ...args.proof,
      workspaceId: args.workspaceId,
      account: args.account,
      repositories: args.repositories,
    })

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
        throw new ConvexError(
          'GitHub installation is connected to another workspace',
        )
      }

      await ctx.db.patch(
        'connectedRepositoryAccounts',
        existingAccount['_id'],
        {
          accountExternalId: args.account.accountExternalId,
          accountLogin: args.account.accountLogin,
          accountType: args.account.accountType,
          status: 'active',
          updatedAt: now,
        },
      )
    }

    const synchronizedRepositoryExternalIds = new Set(
      args.repositories.map((repository) => repository.repositoryExternalId),
    )
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
          throw new ConvexError(
            'GitHub repository is connected to another workspace',
          )
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

    const activeInstallationRepositories = await ctx.db
      .query('connectedRepositories')
      .withIndex('by_provider_installation_status', (q) =>
        q
          .eq('provider', args.account.provider)
          .eq('installationId', args.account.installationId)
          .eq('status', 'active'),
      )
      .take(maximumSynchronizedGitHubRepositories + 1)
    if (
      activeInstallationRepositories.length >
      maximumSynchronizedGitHubRepositories
    ) {
      throw new ConvexError(
        'Active GitHub installation repository inventory exceeds the synchronization bound',
      )
    }
    for (const repository of activeInstallationRepositories) {
      if (
        repository.workspaceId === args.workspaceId &&
        !synchronizedRepositoryExternalIds.has(
          repository.repositoryExternalId,
        ) &&
        repository.status !== 'removed'
      ) {
        await ctx.db.patch('connectedRepositories', repository['_id'], {
          selected: false,
          status: 'removed',
          updatedAt: now,
        })
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
      .take(100)

    return repositories.map(toConnectedRepositoryReturn)
  },
})

export const listForWorkspaceWithLatestVerification = query({
  args: {
    workspaceId: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(
    v.object({
      repository: connectedRepositoryReturn,
      latestVerification: v.optional(latestRepositoryVerificationReturn),
    }),
  ),
  handler: async (ctx, args) => {
    const identity = await requireWorkOSIdentity(ctx)
    requireWorkOSWorkspace(identity, args.workspaceId)
    await requireMembershipPermission(
      ctx,
      identity,
      args.workspaceId,
      'workspace:view',
    )
    if (args.paginationOpts.numItems > 50) {
      throw new ConvexError('Repository page size must not exceed 50')
    }

    const repositories = await ctx.db
      .query('connectedRepositories')
      .withIndex('by_workspace', (q) => q.eq('workspaceId', args.workspaceId))
      .paginate(args.paginationOpts)

    const page = await Promise.all(
      repositories.page.map(async (repository) => {
        const indexedExternalRef = await ctx.db
          .query('externalWorkflowRefs')
          .withIndex(
            'by_workspace_id_and_provider_and_repository_external_id',
            (q) =>
              q
                .eq('workspaceId', args.workspaceId)
                .eq('provider', repository.provider)
                .eq('repositoryExternalId', repository.repositoryExternalId),
          )
          .order('desc')
          .first()
        // Transitional fallback for references written before workspaceId was
        // denormalized. It scans only the legacy index partition, remains
        // bounded, and verifies each workflow workspace before returning data.
        const legacyExternalRefs =
          indexedExternalRef === null
            ? await ctx.db
                .query('externalWorkflowRefs')
                .withIndex(
                  'by_workspace_id_and_provider_and_repository_external_id',
                  (q) =>
                    q
                      .eq('workspaceId', undefined)
                      .eq('provider', repository.provider)
                      .eq(
                        'repositoryExternalId',
                        repository.repositoryExternalId,
                      ),
                )
                .order('desc')
                .take(32)
            : []
        let externalRef = indexedExternalRef ?? undefined
        let workflowRun =
          externalRef === undefined
            ? null
            : await ctx.db.get('workflowRuns', externalRef.workflowRunId)
        if (externalRef === undefined) {
          for (const legacyExternalRef of legacyExternalRefs) {
            const legacyWorkflowRun = await ctx.db.get(
              'workflowRuns',
              legacyExternalRef.workflowRunId,
            )
            if (legacyWorkflowRun?.workspaceId === args.workspaceId) {
              externalRef = legacyExternalRef
              workflowRun = legacyWorkflowRun
              break
            }
          }
        }
        if (
          externalRef === undefined ||
          workflowRun === null ||
          workflowRun.workspaceId !== args.workspaceId
        ) {
          if (legacyExternalRefs.length === 32) {
            throw new ConvexError(
              'Legacy repository verification references require workspace backfill',
            )
          }
          return { repository: toConnectedRepositoryReturn(repository) }
        }

        const [humanDecision, policyDecision, reviewRun] = await Promise.all([
          ctx.db
            .query('humanDecisions')
            .withIndex('by_workflow_run', (q) =>
              q.eq('workflowRunId', workflowRun._id),
            )
            .order('desc')
            .first(),
          ctx.db
            .query('policyDecisions')
            .withIndex('by_workflow_run', (q) =>
              q.eq('workflowRunId', workflowRun._id),
            )
            .order('desc')
            .first(),
          ctx.db
            .query('reviewRuns')
            .withIndex('by_workflow_run', (q) =>
              q.eq('workflowRunId', workflowRun._id),
            )
            .order('desc')
            .first(),
        ])
        const coherentPolicyDecision =
          reviewRun !== null && policyDecision?.reviewRunId === reviewRun._id
            ? policyDecision
            : null
        const coherentHumanDecision =
          coherentPolicyDecision !== null &&
          humanDecision !== null &&
          humanDecision.reviewRunId === reviewRun?._id &&
          humanDecision.policyDecisionId === coherentPolicyDecision._id
            ? humanDecision
            : null
        const verificationStatus:
          | 'queued'
          | 'running'
          | 'reviewed'
          | 'approved'
          | 'rejected'
          | 'changes-requested'
          | 'manual-review'
          | 'failed' =
          workflowRun.status !== 'reviewed'
            ? workflowRun.status
            : (coherentHumanDecision?.status ??
              coherentPolicyDecision?.status ??
              'reviewed')
        const updatedAt =
          workflowRun.status !== 'reviewed'
            ? workflowRun.createdAt
            : (coherentHumanDecision?.decidedAt ??
              coherentPolicyDecision?.createdAt ??
              workflowRun.createdAt)

        return {
          repository: toConnectedRepositoryReturn(repository),
          latestVerification: {
            workflowRunId: workflowRun._id,
            workflowStatus: workflowRun.status,
            verificationStatus,
            ...(externalRef.pullRequestNumber === undefined
              ? {}
              : { pullRequestNumber: externalRef.pullRequestNumber }),
            ...(externalRef.url === undefined ? {} : { url: externalRef.url }),
            createdAt: workflowRun.createdAt,
            updatedAt,
          },
        }
      }),
    )

    return { ...repositories, page }
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
