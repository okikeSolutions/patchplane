#!/usr/bin/env bun
import { mkdir, chmod } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { chromium, type BrowserContext, type Page } from 'playwright'

const ENABLE_FLAG = 'PATCHPLANE_LIVE_BROWSER_TEST'
const BASE_URL_ENV = 'PATCHPLANE_PUBLIC_APP_URL'
const WORKFLOW_RUN_ID_ENV = 'PATCHPLANE_SMOKE_WORKFLOW_RUN_ID'
const EXPECTED_DECISION_ENV = 'PATCHPLANE_SMOKE_EXPECTED_DECISION'
const PROFILE_DIRECTORY = '.patchplane/state/live-browser-acceptance'
const absoluteProfileDirectory = resolve(
  import.meta.dirname,
  '../../../../',
  PROFILE_DIRECTORY,
)

export type ExpectedDecisionStatus =
  | 'approved'
  | 'rejected'
  | 'changes-requested'

export interface LiveBrowserAcceptanceOptions {
  readonly enabled: boolean
  readonly baseUrl?: URL
  readonly workflowRunId?: string
  readonly expectedDecision?: ExpectedDecisionStatus
}

function isExpectedDecisionStatus(
  value: unknown,
): value is ExpectedDecisionStatus {
  return (
    value === 'approved' ||
    value === 'rejected' ||
    value === 'changes-requested'
  )
}

export function parseLiveBrowserAcceptanceOptions(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): LiveBrowserAcceptanceOptions {
  let baseUrlInput = env[BASE_URL_ENV]?.trim()
  const configuredWorkflowRunId = env[WORKFLOW_RUN_ID_ENV]?.trim()
  let workflowRunId =
    configuredWorkflowRunId === undefined ||
    configuredWorkflowRunId.length === 0
      ? undefined
      : configuredWorkflowRunId
  const configuredExpectedDecision = env[EXPECTED_DECISION_ENV]?.trim()
  let expectedDecisionInput =
    configuredExpectedDecision === undefined ||
    configuredExpectedDecision.length === 0
      ? undefined
      : configuredExpectedDecision

  for (const argument of argv) {
    if (argument.startsWith('--base-url=')) {
      if (baseUrlInput !== undefined && baseUrlInput.length > 0) {
        throw new Error('Base URL was provided more than once')
      }
      baseUrlInput = argument.slice('--base-url='.length).trim()
      continue
    }
    if (argument.startsWith('--workflow-run-id=')) {
      if (workflowRunId !== undefined && workflowRunId.length > 0) {
        throw new Error('Workflow run ID was provided more than once')
      }
      workflowRunId = argument.slice('--workflow-run-id='.length).trim()
      continue
    }
    if (argument.startsWith('--expected-decision=')) {
      if (
        expectedDecisionInput !== undefined &&
        expectedDecisionInput.length > 0
      ) {
        throw new Error('Expected decision was provided more than once')
      }
      expectedDecisionInput = argument
        .slice('--expected-decision='.length)
        .trim()
      continue
    }
    throw new Error(
      'Unsupported argument; only --base-url, --workflow-run-id, and --expected-decision are accepted',
    )
  }

  const enabled = env[ENABLE_FLAG] === 'true'
  if (!enabled) return { enabled }
  if (baseUrlInput === undefined || baseUrlInput.length === 0) {
    throw new Error(`${BASE_URL_ENV} or --base-url is required`)
  }

  const baseUrl = new URL(baseUrlInput)
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(baseUrl.hostname)
  if (
    baseUrl.protocol !== 'https:' &&
    !(baseUrl.protocol === 'http:' && loopback)
  ) {
    throw new Error('Base URL must use HTTPS except for loopback development')
  }
  if (
    baseUrl.username.length > 0 ||
    baseUrl.password.length > 0 ||
    baseUrl.search.length > 0 ||
    baseUrl.hash.length > 0
  ) {
    throw new Error('Base URL must not contain credentials, query, or fragment')
  }
  baseUrl.pathname = baseUrl.pathname.replace(/\/$/, '')

  if (
    workflowRunId !== undefined &&
    !/^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,126}[A-Za-z0-9])?$/.test(workflowRunId)
  ) {
    throw new Error('Workflow run ID has an invalid shape')
  }

  const expectedDecision = isExpectedDecisionStatus(expectedDecisionInput)
    ? expectedDecisionInput
    : undefined
  if (workflowRunId !== undefined && expectedDecision === undefined) {
    throw new Error(
      `${EXPECTED_DECISION_ENV} or --expected-decision must be approved, rejected, or changes-requested when a workflow run ID is provided`,
    )
  }
  if (workflowRunId === undefined && expectedDecisionInput !== undefined) {
    throw new Error('Expected decision requires a workflow run ID')
  }

  return {
    enabled,
    baseUrl,
    ...(workflowRunId === undefined || workflowRunId.length === 0
      ? {}
      : { workflowRunId, expectedDecision }),
  }
}

const browserEnvironmentAllowlist = new Set([
  'DBUS_SESSION_BUS_ADDRESS',
  'DISPLAY',
  'HOME',
  'LANG',
  'LC_ALL',
  'PATH',
  'SHELL',
  'TEMP',
  'TMP',
  'TMPDIR',
  'WAYLAND_DISPLAY',
  'XDG_RUNTIME_DIR',
])

export function browserProcessEnvironment(
  env: Readonly<Record<string, string | undefined>>,
) {
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] =>
        browserEnvironmentAllowlist.has(entry[0]) && entry[1] !== undefined,
    ),
  )
}

interface JsonState {
  readonly type: string
  readonly [key: string]: unknown
}

function emit(state: JsonState) {
  stdout.write(`${JSON.stringify(state)}\n`)
}

function safeLocation(page: Page) {
  const url = new URL(page.url())
  return { origin: url.origin, pathname: url.pathname }
}

function isAppLocation(candidate: URL, baseUrl: URL) {
  return candidate.origin === baseUrl.origin && candidate.pathname === '/app'
}

async function pause(
  terminal: ReturnType<typeof createInterface>,
  stage: string,
  instruction: string,
) {
  emit({ type: 'browser_acceptance_manual_pause', stage, instruction })
  await terminal.question('')
  emit({ type: 'browser_acceptance_manual_resumed', stage })
}

export function isWorkflowReadbackConfirmation(response: string) {
  return response.trim() === 'confirm'
}

interface WorkflowReadbackSummary {
  readonly workflowRunId: string
  readonly decisionStatus: ExpectedDecisionStatus
  readonly humanDecisionCount: number
  readonly publishedPublicationResultCount: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function assertWorkflowReadback(
  rawText: string,
  workflowRunId: string,
  expectedDecision: ExpectedDecisionStatus,
): WorkflowReadbackSummary {
  let raw: unknown
  try {
    raw = JSON.parse(rawText)
  } catch {
    throw new Error('Raw workflow readback is not valid JSON')
  }
  if (!isRecord(raw)) {
    throw new Error('Raw workflow readback is not an object')
  }

  const workflowRun = raw['workflowRun']
  if (!isRecord(workflowRun) || workflowRun['id'] !== workflowRunId) {
    throw new Error('Raw workflow readback has an unexpected workflow run ID')
  }

  const humanDecisions = raw['humanDecisions']
  if (!Array.isArray(humanDecisions) || humanDecisions.length === 0) {
    throw new Error('Raw workflow readback has no human decisions')
  }
  const normalizedHumanDecisions = humanDecisions.map((decision) => {
    if (
      !isRecord(decision) ||
      typeof decision['id'] !== 'string' ||
      decision['id'].length === 0 ||
      typeof decision['decidedAt'] !== 'number' ||
      !Number.isFinite(decision['decidedAt']) ||
      !isExpectedDecisionStatus(decision['status'])
    ) {
      throw new Error('Raw workflow readback has an invalid human decision')
    }
    return {
      id: decision['id'],
      decidedAt: decision['decidedAt'],
      status: decision['status'],
    }
  })
  const latestHumanDecision = normalizedHumanDecisions.reduce(
    (latest, decision) =>
      decision.decidedAt > latest.decidedAt ? decision : latest,
  )
  if (latestHumanDecision.status !== expectedDecision) {
    throw new Error('Latest human decision does not match expected status')
  }

  const publicationResults = raw['publicationResults']
  if (!Array.isArray(publicationResults)) {
    throw new Error('Raw workflow readback has invalid publication results')
  }
  const idempotencyKeyPrefix = `${latestHumanDecision.id}:`
  const correlatedPublicationResults = publicationResults.filter(
    (result) =>
      isRecord(result) &&
      typeof result['idempotencyKey'] === 'string' &&
      result['idempotencyKey'].startsWith(idempotencyKeyPrefix),
  )
  if (correlatedPublicationResults.length === 0) {
    throw new Error(
      'Raw workflow readback has no correlated publication results',
    )
  }
  if (
    correlatedPublicationResults.some(
      (result) =>
        result['status'] !== 'published' ||
        typeof result['externalId'] !== 'string' ||
        result['externalId'].trim().length === 0,
    )
  ) {
    throw new Error('Correlated publication results are not durably published')
  }

  return {
    workflowRunId,
    decisionStatus: latestHumanDecision.status,
    humanDecisionCount: normalizedHumanDecisions.length,
    publishedPublicationResultCount: correlatedPublicationResults.length,
  }
}

async function requireTypedConfirmation(
  terminal: ReturnType<typeof createInterface>,
  stage: string,
  instruction: string,
) {
  emit({
    type: 'browser_acceptance_manual_pause',
    stage,
    instruction,
    requiredResponse: 'confirm',
  })
  const response = await terminal.question('')
  if (!isWorkflowReadbackConfirmation(response)) {
    throw new Error('Workflow readback was not explicitly confirmed')
  }
  emit({ type: 'browser_acceptance_manual_resumed', stage })
}

async function assertAuthenticatedApp(page: Page, baseUrl: URL) {
  await page.waitForURL((candidate) => isAppLocation(candidate, baseUrl), {
    timeout: 15_000,
  })
  const connectGitHub = page.getByRole('link', {
    name: 'Connect GitHub',
    exact: true,
  })
  await connectGitHub.waitFor({ state: 'visible', timeout: 15_000 })
  if ((await connectGitHub.getAttribute('aria-disabled')) === 'true') {
    throw new Error('Connect GitHub requires an active WorkOS organization')
  }
  return connectGitHub
}

export async function runLiveBrowserAcceptance(
  options: LiveBrowserAcceptanceOptions,
) {
  if (!options.enabled) {
    emit({
      type: 'browser_acceptance_refused',
      reason: `${ENABLE_FLAG}=true is required`,
    })
    throw new Error('Live browser acceptance is disabled')
  }
  if (options.baseUrl === undefined) {
    throw new Error('Base URL is required')
  }
  if (
    options.workflowRunId !== undefined &&
    options.expectedDecision === undefined
  ) {
    throw new Error('Expected decision is required for workflow readback')
  }
  if (!stdin.isTTY || !stdout.isTTY) {
    emit({
      type: 'browser_acceptance_refused',
      reason:
        'An interactive terminal is required for manual trust-boundary pauses',
    })
    throw new Error('Interactive terminal required')
  }

  await mkdir(absoluteProfileDirectory, { recursive: true, mode: 0o700 })
  await chmod(absoluteProfileDirectory, 0o700)

  let stage = 'launch'
  emit({
    type: 'browser_acceptance_started',
    baseOrigin: options.baseUrl.origin,
    headed: true,
    profileDirectory: PROFILE_DIRECTORY,
  })

  const terminal = createInterface({ input: stdin, output: stdout })
  let context: BrowserContext | undefined

  try {
    context = await chromium.launchPersistentContext(absoluteProfileDirectory, {
      env: browserProcessEnvironment(process.env),
      headless: false,
      viewport: { width: 1440, height: 960 },
    })
    const page = context.pages()[0] ?? (await context.newPage())
    stage = 'open_app'
    await page.goto(new URL('/app', options.baseUrl).toString(), {
      waitUntil: 'domcontentloaded',
    })
    emit({ type: 'browser_acceptance_app_opened', ...safeLocation(page) })

    stage = 'authkit'
    let connectGitHub = page.getByRole('link', {
      name: 'Connect GitHub',
      exact: true,
    })
    if (!(await connectGitHub.isVisible())) {
      const signIn = page.locator('a[href^="/api/auth/sign-in"]')
      if (await signIn.isVisible()) {
        await signIn.click()
      }
      await pause(
        terminal,
        stage,
        'Complete the real WorkOS AuthKit sign-in and organization selection in the browser. Enter credentials only on the provider page. Press Enter here after the browser returns to /app.',
      )
    }

    connectGitHub = await assertAuthenticatedApp(page, options.baseUrl)
    emit({
      type: 'browser_acceptance_authkit_confirmed',
      ...safeLocation(page),
      connectGitHubEnabled: true,
    })

    let connectedRepositoryCount: number
    if (options.workflowRunId === undefined) {
      stage = 'connect_github'
      emit({
        type: 'browser_acceptance_connect_github_ready',
        instruction: 'The helper will open the real GitHub installation flow.',
      })
      await connectGitHub.click()
      await pause(
        terminal,
        stage,
        'On GitHub, choose the intended account and at least one maintainer-controlled test repository. Do not paste tokens or keys. Press Enter here only after GitHub redirects back to PatchPlane.',
      )

      stage = 'assert_github_callback'
      await page.waitForURL(
        (candidate) =>
          isAppLocation(candidate, options.baseUrl!) &&
          candidate.searchParams.get('github') === 'connected',
        { timeout: 15_000 },
      )
    }

    await page
      .getByRole('heading', { name: 'GitHub repositories', exact: true })
      .waitFor({ state: 'visible', timeout: 15_000 })
    const connectedRepositories = page.getByText('Connected', { exact: true })
    connectedRepositoryCount = await connectedRepositories.count()
    if (connectedRepositoryCount < 1) {
      throw new Error('No connected GitHub repository was rendered')
    }

    emit({
      type: 'browser_acceptance_github_confirmed',
      ...safeLocation(page),
      callbackState:
        options.workflowRunId === undefined ? 'connected' : 'existing',
      connectedRepositoryCount,
    })

    if (options.workflowRunId !== undefined) {
      stage = 'dashboard_verification_readback'
      const latestVerificationLink = page.locator(
        `a[data-latest-verification-workflow-run-id="${options.workflowRunId}"]`,
      )
      await latestVerificationLink.waitFor({
        state: 'visible',
        timeout: 15_000,
      })
      const expectedWorkflowPath = `/app/workflows/${encodeURIComponent(options.workflowRunId)}`
      if (
        (await latestVerificationLink.getAttribute('href')) !==
        expectedWorkflowPath
      ) {
        throw new Error(
          'Dashboard latest verification did not link to the expected workflow',
        )
      }
      if (
        (await latestVerificationLink.getAttribute(
          'data-latest-verification-status',
        )) !== options.expectedDecision
      ) {
        throw new Error(
          'Dashboard latest verification did not show the expected decision status',
        )
      }
      emit({
        type: 'browser_acceptance_dashboard_verification_asserted',
        workflowRunId: options.workflowRunId,
        workflowPath: expectedWorkflowPath,
        verificationStatus: options.expectedDecision,
      })
    }

    stage = 'human_confirmation'
    await pause(
      terminal,
      stage,
      'Confirm the listed repositories and workspace are the intended test targets. Press Enter to record acceptance, or close the helper to fail without acceptance.',
    )

    if (
      options.workflowRunId !== undefined &&
      options.expectedDecision !== undefined
    ) {
      stage = 'workflow_readback'
      const workflowPath = `/app/workflows/${encodeURIComponent(options.workflowRunId)}`
      await page.goto(new URL(workflowPath, options.baseUrl).toString(), {
        waitUntil: 'domcontentloaded',
      })
      await page.waitForURL(
        (candidate) =>
          candidate.origin === options.baseUrl!.origin &&
          candidate.pathname === workflowPath,
        { timeout: 15_000 },
      )
      await page
        .getByRole('heading', { name: /^Patch report:/ })
        .waitFor({ state: 'visible', timeout: 15_000 })
      const decisionLabel = page
        .locator('span', { hasText: /^Decision$/ })
        .locator('..')
        .getByText(options.expectedDecision, { exact: true })
      await decisionLabel.waitFor({ state: 'visible', timeout: 15_000 })
      emit({
        type: 'browser_acceptance_workflow_opened',
        workflowRunId: options.workflowRunId,
        expectedDecision: options.expectedDecision,
        ...safeLocation(page),
      })

      await page.getByRole('tab', { name: 'Raw', exact: true }).click()
      await page
        .getByRole('heading', { name: 'Raw report evidence', exact: true })
        .waitFor({ state: 'visible', timeout: 15_000 })
      const rawText = await page.locator('pre').innerText()
      const readback = assertWorkflowReadback(
        rawText,
        options.workflowRunId,
        options.expectedDecision,
      )
      emit({
        type: 'browser_acceptance_workflow_readback_asserted',
        workflowRunId: readback.workflowRunId,
        decisionStatus: readback.decisionStatus,
        humanDecisionCount: readback.humanDecisionCount,
        publishedPublicationResultCount:
          readback.publishedPublicationResultCount,
      })
      await requireTypedConfirmation(
        terminal,
        stage,
        'The visible decision and normalized Raw readback match the expected workflow decision and durable publications. Type exactly "confirm" to record human acceptance.',
      )
      emit({
        type: 'browser_acceptance_workflow_readback_confirmed',
        workflowRunId: readback.workflowRunId,
        decisionStatus: readback.decisionStatus,
        humanDecisionCount: readback.humanDecisionCount,
        publishedPublicationResultCount:
          readback.publishedPublicationResultCount,
      })
    }

    emit({
      type: 'browser_acceptance_complete',
      authKitApp: true,
      githubCallback: true,
      connectedRepositoryCount,
      ...(options.workflowRunId === undefined
        ? {}
        : { workflowReadback: true, workflowRunId: options.workflowRunId }),
      profileDirectory: PROFILE_DIRECTORY,
    })
  } catch {
    emit({
      type: 'browser_acceptance_failed',
      stage,
      reason:
        'The asserted browser state was not reached; inspect the headed browser without exporting credentials or session data.',
    })
    throw new Error(`Live browser acceptance failed during ${stage}`)
  } finally {
    terminal.close()
    await context?.close()
    emit({ type: 'browser_acceptance_browser_closed' })
  }
}

async function main() {
  try {
    const options = parseLiveBrowserAcceptanceOptions(
      process.argv.slice(2),
      process.env,
    )
    await runLiveBrowserAcceptance(options)
  } catch (cause) {
    emit({
      type: 'browser_acceptance_exit',
      status: 'failed',
      reason: cause instanceof Error ? cause.message : 'Unknown failure',
    })
    process.exitCode = 1
  }
}

if (import.meta.main) {
  await main()
}
