import { Config } from 'effect'

export const PI_DEFAULT_PROVIDER = 'openai'
export const PI_DEFAULT_MODEL = 'gpt-5.5'
export const PI_DEFAULT_SYSTEM_PROMPT =
  'You are PatchPlane runtime. Be concise and focus on actionable repository change-control findings.'

export const PiAgentConfig = Config.succeed({
  provider: PI_DEFAULT_PROVIDER,
  model: PI_DEFAULT_MODEL,
  systemPrompt: PI_DEFAULT_SYSTEM_PROMPT,
})

export type PiAgentConfig = typeof PiAgentConfig extends Config.Config<infer A>
  ? A
  : never
