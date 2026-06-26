import { Config } from 'effect'

export const PI_DEFAULT_PROVIDER = 'openai'
export const PI_DEFAULT_MODEL = 'gpt-5.5'
export const PI_DEFAULT_THINKING = 'low'
export const PI_DEFAULT_SYSTEM_PROMPT =
  'You are PatchPlane runtime. Be concise and focus on actionable repository change-control findings.'

/** In-process Pi runtime defaults; provider secrets are supplied through provider-native env vars. */
export const PiAgentConfig = Config.succeed({
  provider: PI_DEFAULT_PROVIDER,
  model: PI_DEFAULT_MODEL,
  thinking: PI_DEFAULT_THINKING,
  systemPrompt: PI_DEFAULT_SYSTEM_PROMPT,
})

export type PiAgentConfig = typeof PiAgentConfig extends Config.Config<infer A>
  ? A
  : never
