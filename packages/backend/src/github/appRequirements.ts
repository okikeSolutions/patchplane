export const githubAppCurrentRepositoryPermissions = {
  metadata: 'read',
  issues: 'read',
} as const

export const githubAppCurrentWebhookSubscriptions = ['issue_comment'] as const

export const githubAppFutureRepositoryPermissions = {
  issues: 'write',
  checks: 'write',
  pull_requests: 'write',
} as const

export const githubAppFutureWebhookSubscriptions = [] as const

export const githubAppRequirements = {
  current: {
    repositoryPermissions: githubAppCurrentRepositoryPermissions,
    webhookSubscriptions: githubAppCurrentWebhookSubscriptions,
  },
  future: {
    repositoryPermissions: githubAppFutureRepositoryPermissions,
    webhookSubscriptions: githubAppFutureWebhookSubscriptions,
  },
} as const
