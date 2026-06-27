import { describe, expect, it } from 'vitest'
import { createPhysicalName } from './utils'

describe('createPhysicalName', () => {
  it('normalizes Cloudflare-safe physical names using a PatchPlane stage/id prefix', () => {
    expect(createPhysicalName({ stage: 'Dev Ugo', id: 'Evidence_Artifacts' })).toBe(
      'patchplane-dev-ugo-evidence-artifacts',
    )
  })

  it('accepts an explicit prefix like the Alchemy helper', () => {
    expect(createPhysicalName({ stage: 'ignored', id: 'ignored', prefix: 'PatchPlane PR#123' })).toBe(
      'patchplane-pr-123',
    )
  })

  it('uses fallback for empty names', () => {
    expect(createPhysicalName({ stage: '!!!', id: '???', prefix: '!!!', fallback: 'dev' })).toBe('dev')
  })

  it('truncates without leaving trailing delimiters', () => {
    expect(createPhysicalName({
      stage: 'dev',
      id: 'evidence-artifacts',
      maxLength: 20,
    })).toBe('patchplane-dev-evide')
  })
})
