import { Config, Effect, Redacted, Schema } from 'effect'

export const piProviderApiKeyEnvNames: Readonly<Record<string, string>> = {
  'anthropic': 'ANTHROPIC_API_KEY',
  'ant-ling': 'ANT_LING_API_KEY',
  'openai': 'OPENAI_API_KEY',
  'azure-openai-responses': 'AZURE_OPENAI_API_KEY',
  'nvidia': 'NVIDIA_API_KEY',
  'deepseek': 'DEEPSEEK_API_KEY',
  'google': 'GEMINI_API_KEY',
  'google-vertex': 'GOOGLE_CLOUD_API_KEY',
  'groq': 'GROQ_API_KEY',
  'cerebras': 'CEREBRAS_API_KEY',
  'xai': 'XAI_API_KEY',
  'openrouter': 'OPENROUTER_API_KEY',
  'vercel-ai-gateway': 'AI_GATEWAY_API_KEY',
  'zai': 'ZAI_API_KEY',
  'zai-coding-cn': 'ZAI_CODING_CN_API_KEY',
  'mistral': 'MISTRAL_API_KEY',
  'minimax': 'MINIMAX_API_KEY',
  'minimax-cn': 'MINIMAX_CN_API_KEY',
  'moonshotai': 'MOONSHOT_API_KEY',
  'moonshotai-cn': 'MOONSHOT_API_KEY',
  'huggingface': 'HF_TOKEN',
  'fireworks': 'FIREWORKS_API_KEY',
  'together': 'TOGETHER_API_KEY',
  'opencode': 'OPENCODE_API_KEY',
  'opencode-go': 'OPENCODE_API_KEY',
  'kimi-coding': 'KIMI_API_KEY',
  'cloudflare-workers-ai': 'CLOUDFLARE_API_KEY',
  'cloudflare-ai-gateway': 'CLOUDFLARE_API_KEY',
  'xiaomi': 'XIAOMI_API_KEY',
  'xiaomi-token-plan-cn': 'XIAOMI_TOKEN_PLAN_CN_API_KEY',
  'xiaomi-token-plan-ams': 'XIAOMI_TOKEN_PLAN_AMS_API_KEY',
  'xiaomi-token-plan-sgp': 'XIAOMI_TOKEN_PLAN_SGP_API_KEY',
  'github-copilot': 'COPILOT_GITHUB_TOKEN',
}

class PiProviderConfigError extends Schema.Error<PiProviderConfigError>(
  'PiProviderConfigError',
)({
  provider: Schema.String,
  message: Schema.String,
}) {}

export function piProviderApiKeyEnvName(provider: string) {
  return piProviderApiKeyEnvNames[provider]
}

const cloudflareGatewayId = Config.schema(
  Schema.NonEmptyString,
  'CLOUDFLARE_GATEWAY_ID',
).pipe(
  Config.orElse(() => Config.schema(
    Schema.NonEmptyString,
    'PATCHPLANE_AI_GATEWAY_ID',
  )),
)

export const piRuntimeEnvironment = Effect.fnUntraced(function*(input: {
  readonly provider: string
}) {
    const apiKeyEnvName = piProviderApiKeyEnvName(input.provider)
    if (apiKeyEnvName === undefined) {
      return yield* new PiProviderConfigError({
        provider: input.provider,
        message: `Unsupported Pi provider: ${input.provider}`,
      })
    }
    const apiKey = yield* Config.redacted(apiKeyEnvName)

    if (input.provider === 'cloudflare-ai-gateway') {
      const cloudflareConfig = yield* Config.all({
        accountId: Config.schema(
          Schema.NonEmptyString,
          'CLOUDFLARE_ACCOUNT_ID',
        ),
        gatewayId: cloudflareGatewayId,
      })
      return {
        CLOUDFLARE_API_KEY: Redacted.value(apiKey),
        CLOUDFLARE_ACCOUNT_ID: cloudflareConfig.accountId,
        CLOUDFLARE_GATEWAY_ID: cloudflareConfig.gatewayId,
      }
    }

    return { [apiKeyEnvName]: Redacted.value(apiKey) }
  })
