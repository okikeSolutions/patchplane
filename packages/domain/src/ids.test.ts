import { describe, expect, it } from '@effect/vitest'
import { Option, Schema } from 'effect'
import {
  ActorId,
  PromptRequestId,
  WorkflowRunId,
  WorkspaceId,
  makePromptRequestId,
  makeWorkflowRunId,
  makeWorkOSActorId,
  makeWorkOSWorkspaceId,
} from './ids'

describe('domain ids', () => {
  it('rejects empty provider actor ids', () => {
    expect(Option.isNone(Schema.decodeUnknownOption(ActorId)('workos:'))).toBe(
      true,
    )
    expect(() => makeWorkOSActorId('')).toThrow()
  })

  it('rejects empty provider workspace ids', () => {
    expect(
      Option.isNone(Schema.decodeUnknownOption(WorkspaceId)('workos:')),
    ).toBe(true)
    expect(() => makeWorkOSWorkspaceId('')).toThrow()
  })

  it('rejects empty durable ids before applying their brands', () => {
    expect(Option.isNone(Schema.decodeUnknownOption(PromptRequestId)(''))).toBe(
      true,
    )
    expect(Option.isNone(Schema.decodeUnknownOption(WorkflowRunId)(''))).toBe(
      true,
    )
    expect(() => makePromptRequestId('')).toThrow()
    expect(() => makeWorkflowRunId('')).toThrow()
  })
})
