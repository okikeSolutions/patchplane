import { describe, expect, it } from '@effect/vitest'
import { Option, Schema } from 'effect'
import {
  ActorId,
  WorkspaceId,
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
})
