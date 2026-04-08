import { defineSchema, defineTable } from 'convex/server'
import {
  executionTargetValidator,
  githubInstallationValidator,
  githubPublicationRecordValidator,
  githubWebhookReconciliationStateValidator,
  issueBindingValidator,
  mergeDecisionValidator,
  pendingApprovalValidator,
  pendingInputValidator,
  policyBundleValidator,
  promptRequestValidator,
  pullRequestBindingValidator,
  repositoryConnectionValidator,
  reviewRunValidator,
  runtimeEventValidator,
  runtimeProviderEventValidator,
  runtimeSessionValidator,
  webhookDeliveryValidator,
  workflowRunValidator,
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
  executionTargets: defineTable(executionTargetValidator)
    .index('by_project', ['projectId'])
    .index('by_project_and_key', ['projectId', 'key'])
    .index('by_repository_connection_and_key', [
      'repositoryConnectionId',
      'key',
    ]),
  policyBundles: defineTable(policyBundleValidator)
    .index('by_project', ['projectId'])
    .index('by_project_and_key', ['projectId', 'key']),
  promptRequests: defineTable(promptRequestValidator)
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
  runtimeProviderEvents: defineTable(runtimeProviderEventValidator)
    .index('by_request', ['requestId'])
    .index('by_workflow_run_id', ['workflowRunId'])
    .index('by_workflow_run_id_created_at', ['workflowRunId', 'createdAt'])
    .index('by_runtime_session_id', ['runtimeSessionId']),
  reviewRuns: defineTable(reviewRunValidator)
    .index('by_request', ['requestId'])
    .index('by_workflow_run_id', ['workflowRunId']),
  pendingApprovals: defineTable(pendingApprovalValidator)
    .index('by_prompt_request_id', ['promptRequestId'])
    .index('by_workflow_run_id', ['workflowRunId'])
    .index('by_status_and_created_at', ['status', 'createdAt']),
  pendingInputs: defineTable(pendingInputValidator)
    .index('by_prompt_request_id', ['promptRequestId'])
    .index('by_workflow_run_id', ['workflowRunId'])
    .index('by_status_and_created_at', ['status', 'createdAt']),
  mergeDecisions: defineTable(mergeDecisionValidator)
    .index('by_workflow_run_id', ['workflowRunId'])
    .index('by_status', ['status']),
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
