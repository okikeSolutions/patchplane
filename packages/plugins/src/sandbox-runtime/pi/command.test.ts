import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { buildPiRpcCommandSpec, renderShellCommand } from './command'

describe('Pi sandbox command specs', () => {
  it.effect('builds an isolated Pi RPC command spec', () =>
    Effect.sync(() => {
      const spec = buildPiRpcCommandSpec({
        provider: 'openai',
        model: 'gpt-5.5',
        version: '0.79.6',
        thinking: 'low',
      })
      const command = renderShellCommand(spec)

      expect(spec.args).toContain('--mode')
      expect(spec.args).toContain('rpc')
      expect(spec.args).toContain('--no-session')
      expect(spec.args).toContain('--no-approve')
      expect(command).toContain('@earendil-works/pi-coding-agent@0.79.6')
      expect(command).toContain("'--provider' 'openai'")
      expect(command).toContain("'--model' 'gpt-5.5'")
    }))
})
