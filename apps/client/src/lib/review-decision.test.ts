import { assert, describe, it } from '@effect/vitest'
import { makeHumanDecisionId, makeWorkflowRunId } from '@patchplane/domain/ids'
import { decisionPublicationRequest } from './review-decision'

describe('decision publication request', () => {
  it('sends only durable identifiers to the source-control trust boundary', () => {
    assert.deepStrictEqual(
      decisionPublicationRequest({
        traceId: 'trace-1',
        workflowRunId: makeWorkflowRunId('workflow-1'),
        humanDecisionId: makeHumanDecisionId('decision-1'),
      }),
      {
        traceId: 'trace-1',
        workflowRunId: 'workflow-1',
        humanDecisionId: 'decision-1',
      },
    )
  })
})
