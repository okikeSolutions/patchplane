#!/usr/bin/env bun
import { spawnSync } from 'node:child_process'
import { existsSync, rmSync, statSync, readdirSync, readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join, relative } from 'node:path'

interface Options {
  readonly check: boolean
  readonly json: boolean
  readonly skipBuild: boolean
  readonly top: number
  readonly serverBudgetMiB: number
  readonly clientBudgetMiB: number
  readonly clientJsGzipBudgetKiB: number
  readonly clientLargestJsBudgetMiB: number
}

interface FileSize {
  readonly path: string
  readonly bytes: number
}

interface BundleStats {
  readonly totalBytes: number
  readonly jsGzipBytes: number
  readonly largestJsBytes: number
  readonly top: readonly FileSize[]
}

interface Report {
  readonly server: BundleStats
  readonly client: BundleStats
}

function parseOptions(argv: readonly string[]): Options {
  let check = false
  let json = false
  let skipBuild = false
  let top = 10
  let serverBudgetMiB = 7.5
  let clientBudgetMiB = 3
  let clientJsGzipBudgetKiB = 750
  let clientLargestJsBudgetMiB = 1.2

  for (const arg of argv) {
    if (arg === '--check') {
      check = true
    } else if (arg === '--json') {
      json = true
    } else if (arg === '--skip-build') {
      skipBuild = true
    } else if (arg.startsWith('--top=')) {
      top = Number(arg.slice('--top='.length))
    } else if (arg.startsWith('--server-budget-mib=')) {
      serverBudgetMiB = Number(arg.slice('--server-budget-mib='.length))
    } else if (arg.startsWith('--client-budget-mib=')) {
      clientBudgetMiB = Number(arg.slice('--client-budget-mib='.length))
    } else if (arg.startsWith('--client-js-gzip-budget-kib=')) {
      clientJsGzipBudgetKiB = Number(arg.slice('--client-js-gzip-budget-kib='.length))
    } else if (arg.startsWith('--client-largest-js-budget-mib=')) {
      clientLargestJsBudgetMiB = Number(arg.slice('--client-largest-js-budget-mib='.length))
    } else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`Unknown option: ${arg}`)
    }
  }

  for (const [name, value] of Object.entries({
    top,
    serverBudgetMiB,
    clientBudgetMiB,
    clientJsGzipBudgetKiB,
    clientLargestJsBudgetMiB,
  })) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${name} must be a positive number`)
    }
  }

  return {
    check,
    json,
    skipBuild,
    top,
    serverBudgetMiB,
    clientBudgetMiB,
    clientJsGzipBudgetKiB,
    clientLargestJsBudgetMiB,
  }
}

function printHelp() {
  console.log(`Usage: bun scripts/bundle-size-client.ts [options]

Build and summarize the Cloudflare/Alchemy Vite output for apps/client.

Options:
  --check                    Fail if bundle budgets are exceeded
  --json                     Print machine-readable JSON
  --skip-build               Measure existing apps/client/dist output
  --top=N                    Number of largest files to show (default: 10)
  --server-budget-mib=N      Server total budget for --check (default: 7.5)
  --client-budget-mib=N      Client total budget for --check (default: 3)
  --client-js-gzip-budget-kib=N
                             Client JavaScript gzip budget (default: 750)
  --client-largest-js-budget-mib=N
                             Largest client JavaScript chunk budget (default: 1.2)
`)
}

function run(command: string, args: readonly string[], cwd: string) {
  const result = spawnSync(command, [...args], { cwd, stdio: 'inherit' })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}`)
  }
}

function buildClientDist() {
  const root = process.cwd()
  const clientDir = join(root, 'apps/client')
  const distDir = join(clientDir, 'dist')

  rmSync(distDir, { recursive: true, force: true })
  run('bun', ['run', 'i18n:compile'], clientDir)
  run(
    'bun',
    [
      '-e',
      "import * as Effect from 'effect/Effect'; import { viteBuild } from '../../node_modules/alchemy/src/Cloudflare/Workers/Vite.ts'; await Effect.runPromise(viteBuild('.', {}, { compatibilityFlags: ['nodejs_compat'] }));",
    ],
    clientDir,
  )
}

function walkFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    throw new Error(`Missing bundle output directory: ${directory}`)
  }

  const files: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...walkFiles(path))
    } else if (entry.isFile()) {
      files.push(path)
    }
  }
  return files
}

function measureDirectory(directory: string, top: number): BundleStats {
  const files = walkFiles(directory)
  const sizes = files
    .map((path) => ({ path, bytes: statSync(path).size }))
    .sort((a, b) => b.bytes - a.bytes)

  const totalBytes = sizes.reduce((sum, file) => sum + file.bytes, 0)
  const jsFiles = sizes.filter((file) => file.path.endsWith('.js'))
  const jsGzipBytes = jsFiles.reduce(
    (sum, file) => sum + gzipSync(readFileSync(file.path)).byteLength,
    0,
  )

  return {
    totalBytes,
    jsGzipBytes,
    largestJsBytes: jsFiles[0]?.bytes ?? 0,
    top: sizes.slice(0, top).map((file) => ({
      path: relative(process.cwd(), file.path),
      bytes: file.bytes,
    })),
  }
}

function measure(top: number): Report {
  return {
    server: measureDirectory('apps/client/dist/server', top),
    client: measureDirectory('apps/client/dist/client', top),
  }
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(2)} MiB`
  }
  return `${(bytes / 1024).toFixed(0)} KiB`
}

function printMarkdown(report: Report, options: Options) {
  console.log('\n# apps/client Cloudflare bundle size\n')
  console.log('| target | total | JS gzip | budget |')
  console.log('|---|---:|---:|---:|')
  console.log(`| server | ${formatBytes(report.server.totalBytes)} | ${formatBytes(report.server.jsGzipBytes)} | ${options.serverBudgetMiB} MiB |`)
  console.log(`| client | ${formatBytes(report.client.totalBytes)} | ${formatBytes(report.client.jsGzipBytes)} | ${options.clientBudgetMiB} MiB |`)

  console.log('\n## Client JavaScript budgets\n')
  console.log('| metric | current | budget |')
  console.log('|---|---:|---:|')
  console.log(`| all JS gzip | ${formatBytes(report.client.jsGzipBytes)} | ${options.clientJsGzipBudgetKiB} KiB |`)
  console.log(`| largest raw JS chunk | ${formatBytes(report.client.largestJsBytes)} | ${options.clientLargestJsBudgetMiB} MiB |`)

  for (const [name, stats] of Object.entries(report)) {
    console.log(`\n## Top ${options.top} ${name} files\n`)
    console.log('| file | size |')
    console.log('|---|---:|')
    for (const file of stats.top) {
      console.log(`| \`${file.path}\` | ${formatBytes(file.bytes)} |`)
    }
  }
}

function checkBudgets(report: Report, options: Options) {
  const serverBudget = options.serverBudgetMiB * 1024 * 1024
  const clientBudget = options.clientBudgetMiB * 1024 * 1024
  const clientJsGzipBudget = options.clientJsGzipBudgetKiB * 1024
  const clientLargestJsBudget = options.clientLargestJsBudgetMiB * 1024 * 1024
  const failures: string[] = []

  if (report.server.totalBytes > serverBudget) {
    failures.push(`server total ${formatBytes(report.server.totalBytes)} exceeds ${options.serverBudgetMiB} MiB`)
  }
  if (report.client.totalBytes > clientBudget) {
    failures.push(`client total ${formatBytes(report.client.totalBytes)} exceeds ${options.clientBudgetMiB} MiB`)
  }
  if (report.client.jsGzipBytes > clientJsGzipBudget) {
    failures.push(`client JS gzip ${formatBytes(report.client.jsGzipBytes)} exceeds ${options.clientJsGzipBudgetKiB} KiB`)
  }
  if (report.client.largestJsBytes > clientLargestJsBudget) {
    failures.push(`largest client JS chunk ${formatBytes(report.client.largestJsBytes)} exceeds ${options.clientLargestJsBudgetMiB} MiB`)
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`Bundle budget failed: ${failure}`)
    }
    process.exitCode = 1
  }
}

try {
  const options = parseOptions(process.argv.slice(2))
  if (!options.skipBuild) {
    buildClientDist()
  }
  const report = measure(options.top)

  if (options.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    printMarkdown(report, options)
  }

  if (options.check) {
    checkBudgets(report, options)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
