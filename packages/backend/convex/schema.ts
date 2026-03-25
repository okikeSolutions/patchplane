import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'
import {
  githubInstallationValidator,
  githubPublicationRecordValidator,
  githubWebhookReconciliationStateValidator,
  issueBindingValidator,
  pullRequestBindingValidator,
  repositoryConnectionValidator,
  reviewRunValidator,
  runtimeEventValidator,
  runtimeSessionValidator,
  webhookDeliveryValidator,
  workflowRunValidator,
  workflowStatusValidator,
  promptRequestSourceValidator,
  promptScopeValidator,
} from './contracts'

export default defineSchema({
  githubInstallations: defineTable(githubInstallationValidator)
    .index('by_external_installation_id', ['externalInstallationId'])
    .index('by_account_login', ['accountLogin']),
  repositories: defineTable(repositoryConnectionValidator)
    .index('by_github_installation_id', ['githubInstallationId'])
    .index('by_external_repository_id', ['externalRepositoryId'])
    .index('by_full_name', ['fullName']),
  webhookDeliveries: defineTable(webhookDeliveryValidator)
    .index('by_delivery_id', ['deliveryId'])
    .index('by_received_at', ['receivedAt'])
    .index('by_event', ['event']),
  promptRequests: defineTable({
    projectId: v.string(),
    executionTargetId: v.string(),
    policyBundleId: v.string(),
    createdByUserId: v.string(),
    prompt: v.string(),
    scope: promptScopeValidator,
    source: promptRequestSourceValidator,
    status: workflowStatusValidator,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_created_at', ['createdAt'])
    .index('by_project', ['projectId']),
  workflowRuns: defineTable(workflowRunValidator)
    .index('by_prompt_request_id', ['promptRequestId'])
    .index('by_status_and_created_at', ['status', 'createdAt']),
  runtimeSessions: defineTable(runtimeSessionValidator)
    .index('by_workflow_run_id', ['workflowRunId'])
    .index('by_external_session_id', ['externalSessionId']),
  runtimeEvents: defineTable(runtimeEventValidator)
    .index('by_request', ['requestId'])
    .index('by_workflow_run_id', ['workflowRunId'])
    .index('by_workflow_run_id_created_at', ['workflowRunId', 'createdAt'])
    .index('by_runtime_session_id', ['runtimeSessionId']),
  reviewRuns: defineTable(reviewRunValidator).index('by_request', [
    'requestId',
  ]),
  issueBindings: defineTable(issueBindingValidator)
    .index('by_repository_connection_and_issue', [
      'repositoryConnectionId',
      'issueNumber',
    ])
    .index('by_prompt_request_id', ['promptRequestId']),
  pullRequestBindings: defineTable(pullRequestBindingValidator)
    .index('by_repository_connection_and_pr', [
      'repositoryConnectionId',
      'pullRequestNumber',
    ])
    .index('by_prompt_request_id', ['promptRequestId']),
  githubPublications: defineTable(githubPublicationRecordValidator)
    .index('by_publication_key', ['publicationKey'])
    .index('by_workflow_run_id', ['workflowRunId']),
  githubWebhookReconciliationStates: defineTable(
    githubWebhookReconciliationStateValidator,
  )
    .index('by_key', ['key'])
    .index('by_updated_at', ['updatedAt']),
})
