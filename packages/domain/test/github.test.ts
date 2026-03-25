import { describe, expect, test } from 'bun:test'
import { Schema } from 'effect'
import {
  GitHubInstallationScopeSchema,
  GitHubPublicationRecordSchema,
  GitHubWebhookDeliveryAttemptSchema,
  GitHubWebhookEnvelopeSchema,
} from '../src/index'

const decodeGitHubInstallationScope = Schema.decodeUnknownSync(
  GitHubInstallationScopeSchema,
)
const decodeGitHubWebhookEnvelope = Schema.decodeUnknownSync(
  GitHubWebhookEnvelopeSchema,
)
const decodeGitHubPublicationRecord = Schema.decodeUnknownSync(
  GitHubPublicationRecordSchema,
)
const decodeGitHubWebhookDeliveryAttempt = Schema.decodeUnknownSync(
  GitHubWebhookDeliveryAttemptSchema,
)

describe('github domain', () => {
  test('decodes authoritative installation scope snapshots', () => {
    const scope = decodeGitHubInstallationScope({
      externalInstallationId: 101,
      accountLogin: 'acme',
      accountType: 'Organization',
      targetType: 'Organization',
      repositorySelection: 'selected',
      permissions: {
        issues: 'read',
        metadata: 'read',
      },
      repositories: [
        {
          externalRepositoryId: 202,
          externalNodeId: 'R_kgDOG123',
          fullName: 'acme/repo',
          owner: 'acme',
          name: 'repo',
          defaultBranch: 'main',
          isPrivate: true,
          isArchived: false,
          isDisabled: false,
        },
      ],
      syncedAt: 1_710_000_000_000,
    })

    expect(scope.repositories).toHaveLength(1)
    expect(scope.permissions.issues).toBe('read')
  })

  test('decodes webhook envelopes with optional GitHub signatures', () => {
    const envelope = decodeGitHubWebhookEnvelope({
      deliveryId: 'delivery_1',
      event: 'issue_comment',
      action: 'created',
      externalInstallationId: 101,
      externalRepositoryId: 202,
      repositoryNodeId: 'R_kgDOG123',
      repositoryFullName: 'acme/repo',
      signature256: 'sha256=abc123',
      payload: '{"action":"created"}',
      receivedAt: 1_710_000_000_000,
    })

    expect(envelope.signature256).toBe('sha256=abc123')
    expect(envelope.event).toBe('issue_comment')
  })

  test('decodes publication records and enforces publication statuses', () => {
    const publication = decodeGitHubPublicationRecord({
      id: 'publication_1',
      workflowRunId: 'run_1',
      repositoryConnectionId: 'repo_1',
      publicationKey: 'issue-comment:run_1',
      kind: 'issue_comment',
      status: 'pending',
      requestBody: '{"body":"Working on it"}',
      createdAt: 1_710_000_000_000,
      updatedAt: 1_710_000_000_000,
    })

    expect(publication.status).toBe('pending')

    expect(() =>
      decodeGitHubPublicationRecord({
        id: 'publication_2',
        workflowRunId: 'run_1',
        repositoryConnectionId: 'repo_1',
        publicationKey: 'issue-comment:run_1',
        kind: 'issue_comment',
        status: 'queued',
        requestBody: '{"body":"Working on it"}',
        createdAt: 1_710_000_000_000,
        updatedAt: 1_710_000_000_000,
      }),
    ).toThrow()
  })

  test('decodes webhook delivery attempts used for redelivery reconciliation', () => {
    const attempt = decodeGitHubWebhookDeliveryAttempt({
      attemptId: 777,
      guid: 'guid_1',
      status: 'FAILED',
      deliveredAt: '2026-03-25T10:00:00.000Z',
      redelivery: true,
    })

    expect(attempt.attemptId).toBe(777)
    expect(attempt.redelivery).toBe(true)
  })
})
