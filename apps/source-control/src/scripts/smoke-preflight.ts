export type SmokePreflightTarget = 'trust-loop' | 'convex-sandbox'
export type SmokePreflightMode = 'fresh' | 'post-decision'

export interface SmokePreflightCheck {
  readonly id: string
  readonly variables: readonly string[]
  readonly status: 'present' | 'missing' | 'invalid'
  readonly selectedVariable?: string
  readonly message?: string
}

export interface SmokePreflightSummary {
  readonly type: 'smoke_preflight_summary'
  readonly target: SmokePreflightTarget
  readonly mode: SmokePreflightMode
  readonly ok: boolean
  readonly webhookResolution:
    | 'configured'
    | 'cloudflare-lookup'
    | 'not-applicable'
  readonly provider?: string
  readonly checks: readonly SmokePreflightCheck[]
  readonly missingVariables: readonly string[]
  readonly invalidVariables: readonly string[]
}

type Environment = Readonly<Record<string, string | undefined>>
type Validator = (value: string) => string | undefined

function value(env: Environment, name: string): string | undefined {
  const candidate = env[name]?.trim()
  return candidate === undefined || candidate.length === 0
    ? undefined
    : candidate
}

const urlValidator: Validator = (candidate) => {
  try {
    const parsed = new URL(candidate)
    if (
      parsed.username.length > 0 ||
      parsed.password.length > 0 ||
      parsed.search.length > 0 ||
      parsed.hash.length > 0
    ) {
      return 'must not contain credentials, query, or fragment'
    }
    if (parsed.protocol === 'https:') return undefined
    const loopback = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)
    return parsed.protocol === 'http:' && loopback
      ? undefined
      : 'must use https except for a loopback development URL'
  } catch {
    return 'must be a valid URL'
  }
}

const repositoryValidator: Validator = (candidate) =>
  /^[^/\s]+\/[^/\s]+$/.test(candidate)
    ? undefined
    : 'must use owner/repository format'

const positiveIntegerValidator: Validator = (candidate) => {
  const parsed = Number(candidate)
  return Number.isSafeInteger(parsed) && parsed > 0
    ? undefined
    : 'must be a positive integer'
}

function required(
  env: Environment,
  id: string,
  variable: string,
  validator?: Validator,
): SmokePreflightCheck {
  const candidate = value(env, variable)
  if (candidate === undefined) {
    return { id, variables: [variable], status: 'missing' }
  }

  const message = validator?.(candidate)
  return message === undefined
    ? {
        id,
        variables: [variable],
        status: 'present',
        selectedVariable: variable,
      }
    : {
        id,
        variables: [variable],
        status: 'invalid',
        selectedVariable: variable,
        message,
      }
}

function oneOf(
  env: Environment,
  id: string,
  variables: readonly string[],
  validator?: Validator,
): SmokePreflightCheck {
  const selectedVariable = variables.find(
    (variable) => value(env, variable) !== undefined,
  )
  if (selectedVariable === undefined) {
    return { id, variables, status: 'missing' }
  }
  const selectedValue = value(env, selectedVariable)
  if (selectedValue === undefined) {
    return { id, variables, status: 'missing' }
  }

  const message = validator?.(selectedValue)
  return message === undefined
    ? { id, variables, status: 'present', selectedVariable }
    : { id, variables, status: 'invalid', selectedVariable, message }
}

function forbidden(
  env: Environment,
  id: string,
  variable: string,
): SmokePreflightCheck | undefined {
  return value(env, variable) === undefined
    ? undefined
    : {
        id,
        variables: [variable],
        status: 'invalid',
        selectedVariable: variable,
        message: 'must be unset for this smoke target',
      }
}

function optional(
  env: Environment,
  id: string,
  variable: string,
  validator: Validator,
): SmokePreflightCheck | undefined {
  return value(env, variable) === undefined
    ? undefined
    : required(env, id, variable, validator)
}

function trustLoopChecks(env: Environment, mode: SmokePreflightMode) {
  const checks: SmokePreflightCheck[] = [
    oneOf(env, 'convex-url', ['CONVEX_URL', 'VITE_CONVEX_URL'], urlValidator),
    required(
      env,
      'system-ingestion-secret',
      'PATCHPLANE_SYSTEM_INGESTION_SECRET',
    ),
    required(env, 'github-app-id', 'GITHUB_APP_ID'),
    required(env, 'github-private-key', 'GITHUB_PRIVATE_KEY'),
    required(env, 'github-webhook-secret', 'GITHUB_WEBHOOK_SECRET'),
  ]

  if (mode === 'post-decision') {
    checks.push(
      required(env, 'workflow-run', 'PATCHPLANE_SMOKE_WORKFLOW_RUN_ID'),
    )
    return checks
  }

  checks.push(
    required(
      env,
      'repository',
      'PATCHPLANE_SMOKE_REPOSITORY_FULL_NAME',
      repositoryValidator,
    ),
  )

  const pullRequest = optional(
    env,
    'pull-request',
    'PATCHPLANE_SMOKE_PULL_REQUEST_NUMBER',
    positiveIntegerValidator,
  )
  if (pullRequest) checks.push(pullRequest)

  if (value(env, 'PATCHPLANE_TRUST_LOOP_WEBHOOK_URL') !== undefined) {
    checks.push(
      required(
        env,
        'webhook-url',
        'PATCHPLANE_TRUST_LOOP_WEBHOOK_URL',
        urlValidator,
      ),
    )
  } else {
    checks.push(
      required(env, 'cloudflare-account', 'CLOUDFLARE_ACCOUNT_ID'),
      required(env, 'cloudflare-api-token', 'CLOUDFLARE_API_TOKEN'),
    )
  }

  const timeout = optional(
    env,
    'timeout',
    'PATCHPLANE_SMOKE_TIMEOUT_MS',
    positiveIntegerValidator,
  )
  if (timeout) checks.push(timeout)
  return checks
}

function convexSandboxChecks(env: Environment) {
  // This smoke deliberately enters through the deployed GitHub webhook so it
  // exercises production routing before Convex → Daytona/Pi orchestration.
  // Daytona, model, and R2 credentials belong to the deployed Worker and must
  // not be copied into the local smoke process.
  const checks = trustLoopChecks(env, 'fresh')
  for (const [id, variable] of [
    ['existing-workflow', 'PATCHPLANE_SMOKE_WORKFLOW_RUN_ID'],
    ['publication-replay', 'PATCHPLANE_SMOKE_REPLAY_PUBLICATION'],
    ['legacy-partial-mode', 'PATCHPLANE_SMOKE_REQUIRE_HUMAN_DECISION'],
  ] as const) {
    const check = forbidden(env, id, variable)
    if (check !== undefined) checks.push(check)
  }
  return checks
}

/** Validate local smoke inputs without performing network or provider work. */
export function inspectSmokePreflight(
  target: SmokePreflightTarget,
  env: Environment,
): SmokePreflightSummary {
  const workflowRunId = value(env, 'PATCHPLANE_SMOKE_WORKFLOW_RUN_ID')
  const mode: SmokePreflightMode =
    target === 'trust-loop' && workflowRunId !== undefined
      ? 'post-decision'
      : 'fresh'
  const configuredWebhook =
    value(env, 'PATCHPLANE_TRUST_LOOP_WEBHOOK_URL') !== undefined
  const checks =
    target === 'trust-loop'
      ? trustLoopChecks(env, mode)
      : convexSandboxChecks(env)
  const failed = checks.filter(({ status }) => status !== 'present')

  return {
    type: 'smoke_preflight_summary',
    target,
    mode,
    ok: failed.length === 0,
    webhookResolution:
      mode === 'post-decision'
        ? 'not-applicable'
        : configuredWebhook
          ? 'configured'
          : 'cloudflare-lookup',
    checks,
    missingVariables: failed
      .filter(({ status }) => status === 'missing')
      .flatMap(({ variables }) => variables),
    invalidVariables: failed
      .filter(({ status }) => status === 'invalid')
      .flatMap(({ selectedVariable }) =>
        selectedVariable === undefined ? [] : [selectedVariable],
      ),
  }
}

/** Serialize only variable names and statuses; environment values never enter the summary. */
export function formatSmokePreflightSummary(
  summary: SmokePreflightSummary,
): string {
  return JSON.stringify(summary)
}
