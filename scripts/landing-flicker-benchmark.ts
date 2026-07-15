#!/usr/bin/env bun
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { PNG } from 'pngjs'
import {
  chromium,
  type Browser,
  type ConsoleMessage,
  type Page,
  type Response,
} from 'playwright'

interface Options {
  readonly build: boolean
  readonly check: boolean
  readonly frames: number
  readonly intervalMs: number
  readonly json: boolean
  readonly maxFirstCanvasMs: number
  readonly maxFrameChange: number
  readonly outDir: string
  readonly port: number
  readonly urlPath: string
  readonly viewportHeight: number
  readonly viewportWidth: number
}

interface FrameMetric {
  readonly index: number
  readonly capturedAtMs: number
  readonly canvasCount: number
  readonly canvasArea: number
  readonly meanLuma: number
  readonly meanRgbDistanceFromPrevious: number | null
}

interface Report {
  readonly url: string
  readonly viewport: {
    readonly width: number
    readonly height: number
  }
  readonly frames: readonly FrameMetric[]
  readonly timings: {
    readonly domContentLoadedMs: number | null
    readonly loadMs: number | null
    readonly firstCanvasMs: number | null
    readonly firstLargeVisualChangeMs: number | null
    readonly shaderResponseMs: number | null
  }
  readonly consoleMessages: readonly string[]
  readonly outputDirectory: string
}

function parseOptions(argv: readonly string[]): Options {
  let build = true
  let check = false
  let frames = 24
  let intervalMs = 100
  let json = false
  let maxFirstCanvasMs = 1_000
  let maxFrameChange = 50
  let outDir = 'artifacts/landing-flicker-benchmark'
  let port = 4173
  let urlPath = '/en'
  let viewportHeight = 720
  let viewportWidth = 1280

  for (const arg of argv) {
    if (arg === '--skip-build') {
      build = false
    } else if (arg === '--check') {
      check = true
    } else if (arg === '--json') {
      json = true
    } else if (arg.startsWith('--frames=')) {
      frames = Number(arg.slice('--frames='.length))
    } else if (arg.startsWith('--interval-ms=')) {
      intervalMs = Number(arg.slice('--interval-ms='.length))
    } else if (arg.startsWith('--max-first-canvas-ms=')) {
      maxFirstCanvasMs = Number(arg.slice('--max-first-canvas-ms='.length))
    } else if (arg.startsWith('--max-frame-change=')) {
      maxFrameChange = Number(arg.slice('--max-frame-change='.length))
    } else if (arg.startsWith('--out-dir=')) {
      outDir = arg.slice('--out-dir='.length)
    } else if (arg.startsWith('--port=')) {
      port = Number(arg.slice('--port='.length))
    } else if (arg.startsWith('--path=')) {
      urlPath = arg.slice('--path='.length)
    } else if (arg.startsWith('--viewport=')) {
      const [width, height] = arg
        .slice('--viewport='.length)
        .split('x')
        .map(Number)
      viewportWidth = width
      viewportHeight = height
    } else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`Unknown option: ${arg}`)
    }
  }

  for (const [name, value] of Object.entries({
    frames,
    intervalMs,
    maxFirstCanvasMs,
    maxFrameChange,
    port,
    viewportHeight,
    viewportWidth,
  })) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${name} must be a positive number`)
    }
  }

  return {
    build,
    check,
    frames,
    intervalMs,
    json,
    maxFirstCanvasMs,
    maxFrameChange,
    outDir,
    port,
    urlPath,
    viewportHeight,
    viewportWidth,
  }
}

function printHelp() {
  console.log(`Usage: bun scripts/landing-flicker-benchmark.ts [options]

Capture first-load frames for the landing page and report simple flicker metrics.

Options:
  --skip-build             Reuse the existing apps/client/dist output
  --check                  Fail when the visual regression budgets are exceeded
  --json                   Print machine-readable JSON
  --frames=N               Number of screenshots to sample (default: 24)
  --interval-ms=N          Delay between screenshots (default: 100)
  --max-first-canvas-ms=N  First-canvas budget used by --check (default: 1000)
  --max-frame-change=N     Mean RGB frame-change budget used by --check (default: 50)
  --out-dir=PATH           Directory for screenshots and report JSON
  --port=N                 Preview server port (default: 4173)
  --path=PATH              URL path to benchmark (default: /en)
  --viewport=WIDTHxHEIGHT  Browser viewport (default: 1280x720)
`)
}

function run(command: string, args: readonly string[], cwd: string) {
  const result = spawnSync(command, [...args], { cwd, stdio: 'inherit' })
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}`,
    )
  }
}

async function waitForPreview(url: string, preview: ChildProcess) {
  const startedAt = Date.now()
  let lastError = ''

  while (Date.now() - startedAt < 15_000) {
    if (preview.exitCode !== null) {
      throw new Error(`Preview server exited with code ${preview.exitCode}`)
    }

    try {
      const response = await fetch(url)
      if (response.ok || response.status < 500) {
        return
      }
      lastError = `HTTP ${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }

    await new Promise((complete) => setTimeout(complete, 250))
  }

  throw new Error(`Preview server did not become ready: ${lastError}`)
}

function loadEnvFile(path: string) {
  if (!existsSync(path)) return {}

  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'))
      .map((line) => {
        const separator = line.indexOf('=')
        if (separator === -1) return null
        const key = line.slice(0, separator).trim()
        const value = line
          .slice(separator + 1)
          .trim()
          .replace(/^['"]|['"]$/g, '')
        return [key, value] as const
      })
      .filter((entry): entry is readonly [string, string] => entry !== null),
  )
}

function startPreview(port: number) {
  return spawn(
    'bun',
    ['run', 'preview', '--host', '127.0.0.1', '--port', String(port)],
    {
      cwd: 'apps/client',
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
}

function stopPreview(preview: ChildProcess) {
  if (preview.exitCode === null) {
    preview.kill('SIGTERM')
  }
}

function meanLuma(image: PNG) {
  let sum = 0
  const pixels = image.width * image.height
  for (let index = 0; index < image.data.length; index += 4) {
    sum +=
      0.2126 * image.data[index] +
      0.7152 * image.data[index + 1] +
      0.0722 * image.data[index + 2]
  }
  return sum / pixels
}

function meanRgbDistance(current: PNG, previous: PNG | null) {
  if (
    previous === null ||
    previous.width !== current.width ||
    previous.height !== current.height
  ) {
    return null
  }

  let sum = 0
  const pixels = current.width * current.height
  for (let index = 0; index < current.data.length; index += 4) {
    const red = current.data[index] - previous.data[index]
    const green = current.data[index + 1] - previous.data[index + 1]
    const blue = current.data[index + 2] - previous.data[index + 2]
    sum += Math.sqrt(red * red + green * green + blue * blue)
  }
  return sum / pixels
}

async function pageMetrics(page: Page) {
  return page.evaluate(() => {
    const canvases = Array.from(document.querySelectorAll('canvas'))
    const navigation = performance.getEntriesByType('navigation').at(0)
    const navigationTiming =
      navigation !== undefined &&
      'domContentLoadedEventEnd' in navigation &&
      typeof navigation.domContentLoadedEventEnd === 'number' &&
      'loadEventEnd' in navigation &&
      typeof navigation.loadEventEnd === 'number'
        ? {
            domContentLoadedEventEnd: navigation.domContentLoadedEventEnd,
            loadEventEnd: navigation.loadEventEnd,
          }
        : null
    return {
      canvasCount: canvases.length,
      canvasArea: canvases.reduce((total, canvas) => {
        const rect = canvas.getBoundingClientRect()
        return total + Math.round(rect.width * rect.height)
      }, 0),
      navigation: navigationTiming,
    }
  })
}

async function benchmark(options: Options): Promise<Report> {
  const root = process.cwd()
  const outDir = resolve(root, options.outDir)
  const frameDir = join(outDir, 'frames')
  const url = `http://127.0.0.1:${options.port}${options.urlPath.startsWith('/') ? options.urlPath : `/${options.urlPath}`}`
  const envFile = loadEnvFile('.env.local')
  const convexUrl =
    process.env.VITE_CONVEX_URL ??
    envFile.VITE_CONVEX_URL ??
    process.env.CONVEX_URL ??
    envFile.CONVEX_URL
  if (convexUrl === undefined || convexUrl.trim().length === 0) {
    throw new Error(
      'VITE_CONVEX_URL or CONVEX_URL is required to build the landing preview',
    )
  }

  Object.assign(process.env, envFile, { VITE_CONVEX_URL: convexUrl })

  if (options.build) {
    run('bun', ['run', '--cwd', 'apps/client', 'build'], root)
  } else if (!existsSync('apps/client/dist')) {
    throw new Error('Missing apps/client/dist. Run without --skip-build first.')
  }

  rmSync(frameDir, { recursive: true, force: true })
  mkdirSync(frameDir, { recursive: true })

  const preview = startPreview(options.port)
  const previewOutput: string[] = []
  preview.stdout?.on('data', (chunk) => previewOutput.push(String(chunk)))
  preview.stderr?.on('data', (chunk) => previewOutput.push(String(chunk)))

  let browser: Browser | undefined
  try {
    await waitForPreview(url, preview)

    browser = await chromium.launch()
    const page = await browser.newPage({
      viewport: {
        width: options.viewportWidth,
        height: options.viewportHeight,
      },
    })
    const consoleMessages: string[] = []
    let shaderResponseMs: number | null = null
    let navigationStartedAt = 0

    page.on('console', (message: ConsoleMessage) => {
      if (message.type() === 'error' || message.type() === 'warning') {
        consoleMessages.push(`${message.type()}: ${message.text()}`)
      }
    })
    page.on('response', (response: Response) => {
      if (
        response.url().includes('shader') ||
        response.url().includes('routes-')
      ) {
        shaderResponseMs ??= Date.now() - navigationStartedAt
      }
    })

    navigationStartedAt = Date.now()
    await page.goto(url, { waitUntil: 'commit' })

    const frames: FrameMetric[] = []
    let previousImage: PNG | null = null
    let firstCanvasMs: number | null = null
    let firstLargeVisualChangeMs: number | null = null
    let navigationEntry: {
      readonly domContentLoadedEventEnd: number
      readonly loadEventEnd: number
    } | null = null

    for (let index = 0; index < options.frames; index += 1) {
      if (index > 0) {
        await page.waitForTimeout(options.intervalMs)
      }

      const capturedAtMs = Date.now() - navigationStartedAt
      const screenshot = await page.screenshot({ fullPage: false })
      const image = PNG.sync.read(screenshot)
      const metrics = await pageMetrics(page)
      navigationEntry ??= metrics.navigation
      const change = meanRgbDistance(image, previousImage)

      if (
        firstCanvasMs === null &&
        metrics.canvasCount > 0 &&
        metrics.canvasArea > 0
      ) {
        firstCanvasMs = capturedAtMs
      }
      if (firstLargeVisualChangeMs === null && change !== null && change > 8) {
        firstLargeVisualChangeMs = capturedAtMs
      }

      writeFileSync(
        join(frameDir, `${String(index).padStart(2, '0')}.png`),
        screenshot,
      )
      frames.push({
        index,
        capturedAtMs,
        canvasCount: metrics.canvasCount,
        canvasArea: metrics.canvasArea,
        meanLuma: meanLuma(image),
        meanRgbDistanceFromPrevious: change,
      })
      previousImage = image
    }

    const report: Report = {
      url,
      viewport: {
        width: options.viewportWidth,
        height: options.viewportHeight,
      },
      frames,
      timings: {
        domContentLoadedMs: navigationEntry?.domContentLoadedEventEnd ?? null,
        loadMs: navigationEntry?.loadEventEnd ?? null,
        firstCanvasMs,
        firstLargeVisualChangeMs,
        shaderResponseMs,
      },
      consoleMessages,
      outputDirectory: outDir,
    }

    writeFileSync(
      join(outDir, 'report.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    )
    return report
  } catch (error) {
    if (previewOutput.length > 0) {
      writeFileSync(join(outDir, 'preview.log'), previewOutput.join(''))
    }
    throw error
  } finally {
    await browser?.close()
    stopPreview(preview)
  }
}

function assertVisualBudgets(report: Report, options: Options) {
  const firstCanvasMs = report.timings.firstCanvasMs
  if (firstCanvasMs === null || firstCanvasMs > options.maxFirstCanvasMs) {
    throw new Error(
      `First canvas ${formatMs(firstCanvasMs)} exceeds ${options.maxFirstCanvasMs} ms`,
    )
  }

  const maxFrameChange = Math.max(
    0,
    ...report.frames.map((frame) => frame.meanRgbDistanceFromPrevious ?? 0),
  )
  if (maxFrameChange > options.maxFrameChange) {
    throw new Error(
      `Mean RGB frame change ${maxFrameChange.toFixed(2)} exceeds ${options.maxFrameChange}`,
    )
  }

  if (report.consoleMessages.some((message) => message.startsWith('error:'))) {
    throw new Error('Landing page emitted browser console errors')
  }
}

function formatMs(value: number | null) {
  return value === null ? 'n/a' : `${Math.round(value)} ms`
}

function printMarkdown(report: Report) {
  console.log('\n# Landing Flicker Benchmark\n')
  console.log(`URL: ${report.url}`)
  console.log(`Viewport: ${report.viewport.width}x${report.viewport.height}`)
  console.log(`Output: ${report.outputDirectory}`)
  console.log('\n| metric | value |')
  console.log('|---|---:|')
  console.log(
    `| DOMContentLoaded | ${formatMs(report.timings.domContentLoadedMs)} |`,
  )
  console.log(`| load | ${formatMs(report.timings.loadMs)} |`)
  console.log(
    `| first canvas observed | ${formatMs(report.timings.firstCanvasMs)} |`,
  )
  console.log(
    `| first large visual change | ${formatMs(report.timings.firstLargeVisualChangeMs)} |`,
  )
  console.log(
    `| shader/route response observed | ${formatMs(report.timings.shaderResponseMs)} |`,
  )

  console.log('\n| frame | t | canvas | canvas area | mean luma | change |')
  console.log('|---:|---:|---:|---:|---:|---:|')
  for (const frame of report.frames) {
    console.log(
      `| ${frame.index} | ${formatMs(frame.capturedAtMs)} | ${frame.canvasCount} | ${frame.canvasArea} | ${frame.meanLuma.toFixed(2)} | ${frame.meanRgbDistanceFromPrevious?.toFixed(2) ?? 'n/a'} |`,
    )
  }

  if (report.consoleMessages.length > 0) {
    console.log('\n## Console Messages\n')
    for (const message of report.consoleMessages) {
      console.log(`- ${message}`)
    }
  }
}

try {
  const options = parseOptions(process.argv.slice(2))
  const report = await benchmark(options)
  if (options.check) assertVisualBudgets(report, options)
  if (options.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    printMarkdown(report)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
