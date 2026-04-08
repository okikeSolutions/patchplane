import { beforeEach, describe, expect, test } from 'bun:test'
import type { Id } from '../convex/_generated/dataModel'
import {
  findExecutionTargetByReference,
  findPolicyBundleByReference,
  selectSingleExecutionTarget,
} from '../convex/lib/configResolution'
import { buildPromptRequestScope } from '../convex/lib/requestCreation'

type FakeTableName = 'executionTargets' | 'policyBundles'

function createFakeDb(data: Record<FakeTableName, ReadonlyArray<Record<string, unknown>>>) {
  return {
    async get(table: FakeTableName, id: string) {
      return data[table].find((document) => document._id === id) ?? null
    },
    query(table: FakeTableName) {
      return {
        withIndex: (
          _indexName: string,
          build: (queryBuilder: {
            eq: (field: string, value: unknown) => unknown
          }) => unknown,
        ) => {
          const filters: Array<{ field: string; value: unknown }> = []
          const queryBuilder = {
            eq(field: string, value: unknown) {
              filters.push({ field, value })
              return queryBuilder
            },
          }

          build(queryBuilder)

          return {
            async collect() {
              return data[table].filter((document) =>
                filters.every(
                  (filter) => document[filter.field] === filter.value,
                ),
              )
            },
          }
        },
      }
    },
  }
}

const projectId = 'acme/repo'
const repositoryConnectionId = 'repo_1' as Id<'repositories'>

describe('config resolution', () => {
  beforeEach(() => {
    process.env.GITHUB_APP_ID = '1'
    process.env.GITHUB_APP_PRIVATE_KEY = 'test-private-key'
    process.env.GITHUB_WEBHOOK_SECRET = 'test-webhook-secret'
    process.env.PATCHPLANE_GITHUB_EXECUTION_TARGET_ID = 'github.issue_comment'
    process.env.PATCHPLANE_GITHUB_POLICY_BUNDLE_ID = 'default'
    process.env.PATCHPLANE_PI_COMMAND = 'pi-coding-agent'
    process.env.PATCHPLANE_RUNTIME_ENV_FORWARD_KEYS = 'OPENAI_API_KEY'
    process.env.PATCHPLANE_SANDBOX_TIMEOUT_MS = '300000'
    process.env.PATCHPLANE_DAYTONA_AUTO_STOP_MINUTES = '15'
    process.env.PATCHPLANE_DAYTONA_EPHEMERAL = 'true'
    process.env.PATCHPLANE_REQUIRED_REVIEWERS = 'quality'
    process.env.PATCHPLANE_MINIMUM_REVIEW_SCORE = '0.8'
  })

  test('resolves legacy config key references through the new config tables', async () => {
    const db = createFakeDb({
      executionTargets: [
        {
          _id: 'target_1',
          _creationTime: 1,
          projectId,
          key: 'github.issue_comment',
          repositoryConnectionId: undefined,
          sandboxProvider: 'daytona',
          runtimeProvider: 'pi-mono',
          defaultBaseBranch: undefined,
          enabled: true,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      policyBundles: [
        {
          _id: 'policy_1',
          _creationTime: 1,
          projectId,
          key: 'default',
          requiredReviewers: ['quality'],
          minimumScore: 0.8,
          enabled: true,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    })

    const executionTarget = await findExecutionTargetByReference(
      db as never,
      {
        projectId,
        reference: 'github.issue_comment',
        repositoryConnectionId,
      },
    )
    const policyBundle = await findPolicyBundleByReference(db as never, {
      projectId,
      reference: 'default',
    })

    expect(executionTarget?._id).toBe('target_1')
    expect(policyBundle?._id).toBe('policy_1')
  })

  test('does not fall back to a global target when a repo override is disabled', () => {
    expect(() =>
      selectSingleExecutionTarget(
        [
          {
            _id: 'target_default',
            _creationTime: 1,
            projectId,
            key: 'github.issue_comment',
            repositoryConnectionId: undefined,
            sandboxProvider: 'daytona',
            runtimeProvider: 'pi-mono',
            defaultBaseBranch: undefined,
            enabled: true,
            createdAt: 1,
            updatedAt: 1,
          },
          {
            _id: 'target_repo',
            _creationTime: 1,
            projectId,
            key: 'github.issue_comment',
            repositoryConnectionId,
            sandboxProvider: 'daytona',
            runtimeProvider: 'pi-mono',
            defaultBaseBranch: undefined,
            enabled: false,
            createdAt: 1,
            updatedAt: 1,
          },
        ] as never,
        {
          projectId,
          key: 'github.issue_comment',
          repositoryConnectionId,
        },
      ),
    ).toThrow('disabled')
  })

  test('reports disabled global execution targets as disabled instead of missing', async () => {
    const db = createFakeDb({
      executionTargets: [
        {
          _id: 'target_1',
          _creationTime: 1,
          projectId,
          key: 'repo.default',
          repositoryConnectionId: undefined,
          sandboxProvider: 'daytona',
          runtimeProvider: 'pi-mono',
          defaultBaseBranch: undefined,
          enabled: false,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      policyBundles: [],
    })

    await expect(
      findExecutionTargetByReference(db as never, {
        projectId,
        reference: 'repo.default',
      }),
    ).rejects.toThrow('disabled')
  })

  test('reports disabled policy bundles as disabled instead of missing', async () => {
    const db = createFakeDb({
      executionTargets: [],
      policyBundles: [
        {
          _id: 'policy_1',
          _creationTime: 1,
          projectId,
          key: 'strict',
          requiredReviewers: ['quality'],
          minimumScore: 0.9,
          enabled: false,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    })

    await expect(
      findPolicyBundleByReference(db as never, {
        projectId,
        reference: 'strict',
      }),
    ).rejects.toThrow('disabled')
  })

  test('applies execution-target base branch overrides when creating prompt scopes', () => {
    const scope = buildPromptRequestScope(
      {
        kind: 'prompt_request.create',
        projectId,
        executionTargetKey: 'github.issue_comment',
        policyBundleKey: 'default',
        createdByUserId: 'github:octocat',
        prompt: 'Fix the failing test',
        scope: {
          repoUrl: 'https://github.com/acme/repo.git',
          baseBranch: 'main',
          targetBranch: 'patchplane/comment-1',
          includePaths: ['src'],
          excludePaths: ['dist'],
          intent: 'github.issue_comment',
        },
        source: { kind: 'manual' },
      },
      { defaultBaseBranch: 'release/1.x' },
    )

    expect(scope.baseBranch).toBe('release/1.x')
    expect(scope.includePaths).toEqual(['src'])
    expect(scope.excludePaths).toEqual(['dist'])
  })
})
