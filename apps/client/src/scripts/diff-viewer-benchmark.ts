#!/usr/bin/env bun
import { resolve } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const budgets = {
  largeInitialRenderMs: 6_000,
  standardInitialRenderMs: 2_000,
  fileSwitchMs: 100,
} as const

type FixtureState = {
  readonly bytes: number
  readonly fileCount: number
  readonly paths: readonly string[]
  readonly readyAtMs: number
  readonly scenario: 'large' | 'standard'
}

type Report = {
  readonly budgets: typeof budgets
  readonly large: {
    readonly bytes: number
    readonly fileCount: number
    readonly initialRenderMs: number
  }
  readonly standard: {
    readonly bytes: number
    readonly fileCount: number
    readonly initialRenderMs: number
  }
  readonly fileSwitch: {
    readonly maximumMs: number
    readonly samplesMs: readonly number[]
  }
}

const repositoryRoot = resolve(import.meta.dirname, '../../../..')
const fixtureRoot = resolve(
  repositoryRoot,
  'apps/client/test/performance/diff-viewer',
)

async function fixtureState(page: Page): Promise<FixtureState> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await page.waitForFunction(
        () => document.documentElement.dataset.benchmarkReady === 'true',
        undefined,
        { timeout: budgets.largeInitialRenderMs * 2 },
      )
      break
    } catch (error) {
      const viteReloaded =
        error instanceof Error &&
        error.message.includes('Execution context was destroyed')
      if (!viteReloaded || attempt === 1) throw error
      await page.waitForLoadState('domcontentloaded')
    }
  }
  return page.evaluate<FixtureState>(() => {
    const state = window.patchplaneDiffFixture
    if (state?.readyAtMs === undefined) {
      throw new Error('Diff performance fixture did not publish ready state')
    }
    return {
      bytes: state.bytes,
      fileCount: state.fileCount,
      paths: state.paths,
      readyAtMs: state.readyAtMs,
      scenario: state.scenario,
    }
  })
}

async function loadScenario(
  browser: Browser,
  baseUrl: string,
  scenario: FixtureState['scenario'],
) {
  const context = await browser.newContext({
    viewport: { height: 900, width: 1440 },
  })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${baseUrl}/?scenario=${scenario}`, {
    waitUntil: 'domcontentloaded',
  })
  let state: FixtureState
  try {
    state = await fixtureState(page)
  } catch (error) {
    throw new Error(
      `${scenario} fixture did not become ready${
        errors.length === 0 ? '' : `:\n${errors.join('\n')}`
      }`,
      { cause: error },
    )
  }
  if (errors.length > 0) {
    throw new Error(
      `${scenario} fixture emitted browser errors:\n${errors.join('\n')}`,
    )
  }
  return { context, page, state }
}

async function measureFileSwitches(page: Page, paths: readonly string[]) {
  const targets = [paths.at(3), paths.at(8)].filter(
    (path): path is string => path !== undefined,
  )
  if (targets.length !== 2) {
    throw new Error('Standard fixture needs at least nine changed files')
  }

  const samples: number[] = []
  for (let index = 0; index < 12; index += 1) {
    const path = targets[index % targets.length]
    const startedAt = performance.now()
    const selected = await page.evaluate((nextPath) => {
      return window.patchplaneDiffSelect?.(nextPath) ?? false
    }, path)
    if (!selected) throw new Error(`Tree item was not mounted for ${path}`)
    await page
      .locator(`section[aria-label="Diff for ${path}"]`)
      .waitFor({ state: 'visible' })
    samples.push(performance.now() - startedAt)
  }
  return samples
}

function assertBudget(label: string, actual: number, budget: number) {
  if (actual > budget) {
    throw new Error(
      `${label} exceeded its ${String(budget)} ms budget: ${actual.toFixed(1)} ms`,
    )
  }
}

function printReport(report: Report) {
  console.log('# Diff viewer browser performance')
  console.log('')
  console.log('| interaction | fixture | measured | budget |')
  console.log('|---|---:|---:|---:|')
  console.log(
    `| Initial render | ${String(report.standard.fileCount)} files / ${String(report.standard.bytes)} bytes | ${report.standard.initialRenderMs.toFixed(1)} ms | ${String(report.budgets.standardInitialRenderMs)} ms |`,
  )
  console.log(
    `| File switching (maximum of ${String(report.fileSwitch.samplesMs.length)}) | standard fixture | ${report.fileSwitch.maximumMs.toFixed(1)} ms | ${String(report.budgets.fileSwitchMs)} ms |`,
  )
  console.log(
    `| Near-cap initial render | ${String(report.large.fileCount)} files / ${String(report.large.bytes)} bytes | ${report.large.initialRenderMs.toFixed(1)} ms | ${String(report.budgets.largeInitialRenderMs)} ms |`,
  )
}

let server: ViteDevServer | undefined
let browser: Browser | undefined
try {
  server = await createServer({
    configFile: false,
    plugins: [tailwindcss(), viteReact()],
    resolve: {
      alias: {
        '@': resolve(repositoryRoot, 'apps/client/src'),
      },
    },
    root: fixtureRoot,
    logLevel: 'error',
    server: {
      host: '127.0.0.1',
      port: 0,
      strictPort: false,
    },
  })
  await server.listen()
  const baseUrl = server.resolvedUrls?.local.at(0)?.replace(/\/$/, '')
  if (baseUrl === undefined) {
    throw new Error('Diff fixture server did not expose a loopback URL')
  }

  browser = await chromium.launch({ channel: 'chrome' })

  const warmup = await loadScenario(browser, baseUrl, 'standard')
  await warmup.context.close()

  const standard = await loadScenario(browser, baseUrl, 'standard')
  const switchSamples = await measureFileSwitches(
    standard.page,
    standard.state.paths,
  )
  await standard.context.close()

  const large = await loadScenario(browser, baseUrl, 'large')
  await large.context.close()

  const report: Report = {
    budgets,
    large: {
      bytes: large.state.bytes,
      fileCount: large.state.fileCount,
      initialRenderMs: large.state.readyAtMs,
    },
    standard: {
      bytes: standard.state.bytes,
      fileCount: standard.state.fileCount,
      initialRenderMs: standard.state.readyAtMs,
    },
    fileSwitch: {
      maximumMs: Math.max(...switchSamples),
      samplesMs: switchSamples,
    },
  }

  printReport(report)
  assertBudget(
    'Standard initial render',
    report.standard.initialRenderMs,
    budgets.standardInitialRenderMs,
  )
  assertBudget(
    'File switching',
    report.fileSwitch.maximumMs,
    budgets.fileSwitchMs,
  )
  assertBudget(
    'Near-cap initial render',
    report.large.initialRenderMs,
    budgets.largeInitialRenderMs,
  )
} finally {
  await browser?.close()
  await server?.close()
}
